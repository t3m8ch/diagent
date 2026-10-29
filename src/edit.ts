/**
 * `diagent edit`: a local HTTP server around one diagram file (Node only).
 *
 *   GET  /              the editor page            GET /client.js   the browser bundle
 *   GET  /api/file      {text, ok, diagnostics}    GET /api/events  SSE: `file` event on every change
 *   POST /api/actions   {actions: LayoutAction[]}  re-reads the file, applies, writes, returns state
 *
 * The server never keeps the model: every save re-reads the file, so edits made by someone
 * else between two user actions are not lost.
 */
import { existsSync, readFileSync, renameSync, watch, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, type Diagnostic } from "./check.js";
import { applyActions, type LayoutAction } from "./save.js";

export interface FileState {
  text: string;
  ok: boolean;
  diagnostics: Diagnostic[];
}

export interface Editor {
  url: string;
  close(): Promise<void>;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>diagent editor</title>
<style>
:root { color-scheme: light dark; --bg: #fff; --fg: #000; --muted: #666; --err: #b00020; --accent: #1a73e8; }
@media (prefers-color-scheme: dark) { :root { --bg: #000; --fg: #fff; --muted: #999; --err: #ff6b6b; --accent: #8ab4f8; } }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font: 13px system-ui, sans-serif; }
#bar { position: fixed; top: 0; left: 0; right: 0; padding: 6px 12px; display: flex; gap: 16px; align-items: center;
  border-bottom: 1px solid var(--muted); background: var(--bg); z-index: 2; }
#bar .hint { color: var(--muted); }
#bar button { font: inherit; }
#status { margin-left: auto; color: var(--muted); }
#errors { display: none; margin: 0; padding: 8px 12px; color: var(--err); font-family: ui-monospace, monospace; white-space: pre-wrap;
  border-bottom: 1px solid var(--err); }
#stage { padding: 48px 12px 12px; overflow: auto; }
#stage.invalid { opacity: 0.6; }
svg { display: block; }
.pin { cursor: grab; }
</style>
</head>
<body>
<div id="bar"><b>diagent</b><span id="file"></span><span class="hint" title="Click a line to select it, click it again (or drag) to add a bend, drag a bend to move it, double-click a bend to remove it. Ctrl+Z / Ctrl+Shift+Z: undo / redo.">Drag to pin · double-click to unpin · click a line to add bends</span><button id="reset-bends" disabled>Reset bends</button><button id="pin-all">Pin all</button><button id="unpin-all">Unpin all</button><span id="status"></span></div>
<pre id="errors"></pre>
<div id="stage"></div>
<script src="/client.js"></script>
</body>
</html>
`;

class BodyTooLarge extends Error {}

const here = dirname(fileURLToPath(import.meta.url));

/** The browser bundle: `client.js` next to this module when built, otherwise bundled on the fly (tsx / vitest). */
async function clientBundle(): Promise<string> {
  const built = join(here, "client.js");
  if (existsSync(built)) return readFileSync(built, "utf8");
  const { build } = await import("esbuild");
  const r = await build({
    entryPoints: [join(here, "editor", "client.ts")],
    bundle: true,
    format: "iife",
    write: false,
    platform: "browser",
  });
  return r.outputFiles[0]!.text;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validates untrusted JSON into actions; undefined if anything is off. */
export function parseActions(body: unknown): LayoutAction[] | undefined {
  const list = (body as any)?.actions;
  if (!Array.isArray(list)) return undefined;
  const out: LayoutAction[] = [];
  for (const a of list) {
    if (a?.type === "pinClass" && typeof a.name === "string" && isNum(a.x) && isNum(a.y))
      out.push({ type: "pinClass", name: a.name, x: Math.round(a.x), y: Math.round(a.y) });
    else if (a?.type === "unpinClass" && typeof a.name === "string") out.push({ type: "unpinClass", name: a.name });
    else if (a?.type === "unpinAll") out.push({ type: "unpinAll" });
    else if (
      a?.type === "pinAll" &&
      a.classes && typeof a.classes === "object" && !Array.isArray(a.classes) &&
      Object.values(a.classes).every((p: any) => isNum(p?.x) && isNum(p?.y))
    )
      out.push({
        type: "pinAll",
        classes: Object.fromEntries(Object.entries<any>(a.classes).map(([n, p]) => [n, { x: Math.round(p.x), y: Math.round(p.y) }])),
      });
    else if (
      a?.type === "setBends" &&
      typeof a.key === "string" &&
      (a.bends === null ||
        (Array.isArray(a.bends) && a.bends.every((b: unknown) => Array.isArray(b) && b.length === 2 && isNum(b[0]) && isNum(b[1]))))
    )
      out.push({ type: "setBends", key: a.key, bends: a.bends === null ? null : a.bends.map((b: number[]) => [Math.round(b[0]!), Math.round(b[1]!)]) });
    else return undefined;
  }
  return out;
}

function stateOf(text: string): FileState {
  const diagnostics = check(text);
  return { text, ok: !diagnostics.some((d) => d.severity === "error"), diagnostics };
}

export async function startEditor(opts: { file: string; port?: number; host?: string }): Promise<Editor> {
  const { file } = opts;
  const host = opts.host ?? "127.0.0.1";
  const bundle = await clientBundle();
  const clients = new Set<ServerResponse>();
  let lastSent = readFileSync(file, "utf8");

  const broadcast = (state: FileState) => {
    lastSent = state.text;
    const data = `event: file\ndata: ${JSON.stringify(state)}\n\n`;
    for (const c of clients) c.write(data);
  };

  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(dirname(file), (_event, name) => {
    if (name && name !== basename(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        return; // mid-replace by an editor; the next event brings the file back
      }
      if (text !== lastSent) broadcast(stateOf(text));
    }, 50);
  });
  const keepAlive = setInterval(() => {
    for (const c of clients) c.write(": keep-alive\n\n");
  }, 20000);
  keepAlive.unref();

  const send = (res: ServerResponse, status: number, type: string, body: string) => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  const json = (res: ServerResponse, status: number, value: unknown) =>
    send(res, status, "application/json; charset=utf-8", JSON.stringify(value));

  const MAX_BODY = 1_000_000;
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let s = "";
      let size = 0;
      req.setEncoding("utf8");
      req.on("data", (c: string) => {
        size += c.length;
        if (size > MAX_BODY) {
          s = ""; // stop accumulating; the rest of the upload is discarded
          req.removeAllListeners("data");
          req.resume();
          reject(new BodyTooLarge());
        } else s += c;
      });
      req.on("end", () => resolve(s));
      req.on("error", reject);
    });

  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];
      if (req.method === "GET" && path === "/") return send(res, 200, "text/html; charset=utf-8", PAGE);
      if (req.method === "GET" && path === "/client.js") return send(res, 200, "text/javascript; charset=utf-8", bundle);
      if (req.method === "GET" && path === "/api/file") return json(res, 200, { ...stateOf(readFileSync(file, "utf8")), name: basename(file) });
      if (req.method === "GET" && path === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        clients.add(res);
        req.on("close", () => clients.delete(res));
        res.write(`event: file\ndata: ${JSON.stringify(stateOf(readFileSync(file, "utf8")))}\n\n`);
        return;
      }
      if (req.method === "POST" && path === "/api/actions") {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch (e) {
          if (e instanceof BodyTooLarge) {
            res.setHeader("connection", "close");
            return json(res, 413, { error: "body too large" });
          }
          return json(res, 400, { error: "invalid JSON" });
        }
        const actions = parseActions(body);
        if (!actions) return json(res, 400, { error: "invalid actions" });
        const current = readFileSync(file, "utf8"); // re-read: the file may have changed under us
        if (!stateOf(current).ok) return json(res, 409, { error: "the file is invalid, not saving", ...stateOf(current) });
        const next = applyActions(current, actions);
        if (next !== current) {
          const tmp = `${file}.${process.pid}.tmp`;
          writeFileSync(tmp, next);
          renameSync(tmp, file);
        }
        const state = stateOf(next);
        broadcast(state);
        return json(res, 200, state);
      }
      send(res, 404, "text/plain", "not found");
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, resolve);
  });
  const addr = server.address() as { port: number };
  return {
    url: `http://${host}:${addr.port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        clearTimeout(timer);
        clearInterval(keepAlive);
        watcher.close();
        for (const c of clients) c.end();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
