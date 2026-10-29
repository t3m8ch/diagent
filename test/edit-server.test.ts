import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startEditor, type Editor } from "../src/edit.js";

const model = `# comment
classes:
  A: {}
  B: {}
relations:
  generalization:
    - { child: B, parent: A }
`;

let editor: Editor | undefined;
afterEach(async () => {
  await editor?.close();
  editor = undefined;
});

async function open(text: string) {
  const dir = mkdtempSync(join(tmpdir(), "diagent-edit-"));
  const file = join(dir, "t.cd.yaml");
  writeFileSync(file, text);
  editor = await startEditor({ file, port: 0 });
  return { file, url: editor.url };
}

const post = (url: string, actions: unknown[]) =>
  fetch(url + "api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actions }) });

describe("diagent edit server", () => {
  it("serves the page, the client bundle and the file state", async () => {
    const { url } = await open(model);
    const page = await fetch(url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("/client.js");
    expect(html).toContain("Drag to pin · double-click to unpin");
    const js = await fetch(url + "client.js");
    expect(js.status).toBe(200);
    expect((await js.text()).length).toBeGreaterThan(1000);
    const state = await (await fetch(url + "api/file")).json();
    expect(state).toMatchObject({ text: model, ok: true });
  });

  it("saves an action: only layout changes, the model comment stays", async () => {
    const { url, file } = await open(model);
    const r = await post(url, [{ type: "pinClass", name: "A", x: 30, y: 40 }]);
    expect(r.status).toBe(200);
    const saved = readFileSync(file, "utf8");
    expect(saved.startsWith(model)).toBe(true);
    expect(saved).toContain("A: { x: 30, y: 40 }");
  });

  it("keeps an external model edit made between two user actions", async () => {
    const { url, file } = await open(model);
    await post(url, [{ type: "pinClass", name: "A", x: 10, y: 10 }]);
    writeFileSync(file, readFileSync(file, "utf8").replace("  B: {}\n", "  B: {}\n  C: {}\n"));
    await post(url, [{ type: "pinClass", name: "B", x: 90, y: 10 }]);
    const saved = readFileSync(file, "utf8");
    expect(saved).toContain("  C: {}");
    expect(saved).toContain("A: { x: 10, y: 10 }");
    expect(saved).toContain("B: { x: 90, y: 10 }");
  });

  it("pushes external edits over SSE, and diagnostics when the file turns invalid", async () => {
    const { url, file } = await open(model);
    const res = await fetch(url + "api/events");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const next = async (pred: (b: string) => boolean) => {
      while (!pred(buf)) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buf += dec.decode(value);
      }
    };
    await next((b) => b.includes("event: file")); // initial state
    writeFileSync(file, model + "  C: {}\n"); // invalid: relations item after list? makes bad YAML structure
    await next((b) => b.includes('"ok":false'));
    writeFileSync(file, model.replace("  B: {}\n", "  B: {}\n  C: {}\n"));
    await next((b) => b.includes("  C: {}") && b.lastIndexOf('"ok":true') > b.lastIndexOf('"ok":false'));
    await reader.cancel();
  });

  it("refuses to save into an invalid file", async () => {
    const { url, file } = await open(model);
    writeFileSync(file, "classes: [");
    const r = await post(url, [{ type: "unpinClass", name: "A" }]);
    expect(r.status).toBe(409);
    expect(readFileSync(file, "utf8")).toBe("classes: [");
  });

  it("rejects malformed action bodies", async () => {
    const { url } = await open(model);
    const r = await fetch(url + "api/actions", { method: "POST", body: "nope" });
    expect(r.status).toBe(400);
  });

  it("rejects a body over 1 MB with 413 and keeps the server working", async () => {
    const { url } = await open(model);
    const r = await fetch(url + "api/actions", { method: "POST", body: "x".repeat(3_000_000) });
    expect(r.status).toBe(413);
    expect((await fetch(url + "api/file")).status).toBe(200);
  });
});
