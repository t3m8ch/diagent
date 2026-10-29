#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { check, type Diagnostic } from "./check.js";
import { renderSvg, type Theme } from "./render.js";
import { schema } from "./schema.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readFile: (path: string) => string;
  writeFile?: (path: string, data: string | Uint8Array) => void;
}

const USAGE = `Usage:
  diagent schema                  print the JSON Schema of a diagram
  diagent check [--json] <file>   validate a *.cd.yaml diagram
  diagent render <file> -o <out.svg|out.png> [--theme light|dark]
                                  draw a diagram (the layout section is ignored for now)
`;

/** Runs the CLI and returns the process exit code. */
export function main(argv: string[], io: Io): number {
  const [command, ...rest] = argv;
  if (command === "schema" && rest.length === 0) {
    io.stdout(JSON.stringify(schema, null, 2) + "\n");
    return 0;
  }
  if (command === "check") {
    const json = rest.includes("--json");
    const files = rest.filter((a) => a !== "--json");
    if (files.length !== 1 || files[0]!.startsWith("-")) {
      io.stderr(USAGE);
      return 2;
    }
    const file = files[0]!;
    let text: string;
    try {
      text = io.readFile(file);
    } catch (e) {
      io.stderr(`diagent: cannot read ${file}: ${(e as Error).message}\n`);
      return 2;
    }
    const diagnostics = check(text);
    const ok = !diagnostics.some((d) => d.severity === "error");
    io.stdout(json ? formatJson(file, ok, diagnostics) : formatText(file, ok, diagnostics));
    return ok ? 0 : 1;
  }
  io.stderr(USAGE);
  return 2;
}

/** Like `main`, but also runs the asynchronous commands (`render`). */
export async function runCli(argv: string[], io: Io): Promise<number> {
  if (argv[0] !== "render") return main(argv, io);
  return render(argv.slice(1), io);
}

async function render(args: string[], io: Io): Promise<number> {
  let out: string | undefined;
  let theme: string = "light";
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-o" || a === "--output") out = args[++i];
    else if (a === "--theme") theme = args[++i] ?? "";
    else if (a.startsWith("-")) files.push(a); // unknown flag: usage error below
    else files.push(a);
  }
  const ext = out?.toLowerCase().match(/\.(svg|png)$/)?.[1];
  if (files.length !== 1 || files[0]!.startsWith("-") || !out || !ext || (theme !== "light" && theme !== "dark")) {
    io.stderr(USAGE);
    return 2;
  }
  const file = files[0]!;
  let text: string;
  try {
    text = io.readFile(file);
  } catch (e) {
    io.stderr(`diagent: cannot read ${file}: ${(e as Error).message}\n`);
    return 2;
  }
  const diagnostics = check(text);
  const ok = !diagnostics.some((d) => d.severity === "error");
  if (!ok) {
    io.stdout(formatText(file, ok, diagnostics));
    return 1;
  }
  for (const d of diagnostics) io.stderr(`${file}:${d.line}:${d.column} ${d.severity}${d.path ? ` ${d.path}` : ""}: ${d.message}\n`);
  const svg = await renderSvg(text, { theme: theme as Theme });
  const write = io.writeFile ?? (() => { throw new Error("no writeFile"); });
  if (ext === "svg") write(out, svg);
  else write(out, (await import("./png.js")).svgToPng(svg));
  return 0;
}

function formatJson(file: string, ok: boolean, diagnostics: Diagnostic[]): string {
  return JSON.stringify({ file, ok, diagnostics }, null, 2) + "\n";
}

function formatText(file: string, ok: boolean, diagnostics: Diagnostic[]): string {
  const lines = diagnostics.map(
    (d) => `${file}:${d.line}:${d.column} ${d.severity}${d.path ? ` ${d.path}` : ""}: ${d.message}`,
  );
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  lines.push(ok ? `${file}: ok (${warnings} warnings)` : `${file}: ${errors} errors, ${warnings} warnings`);
  return lines.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2), {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    readFile: (p) => readFileSync(p, "utf8"),
    writeFile: (p, d) => writeFileSync(p, d),
  });
}
