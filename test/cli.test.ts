import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

function run(argv: string[], files: Record<string, string> = {}) {
  let stdout = "";
  let stderr = "";
  const code = main(argv, {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    readFile: (p) => {
      const text = files[p];
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
  });
  return { code, stdout, stderr };
}

const bad = "classes:\n  A:\n    colour: red\n";

describe("diagent check", () => {
  it("exits 0 for a valid diagram", () => {
    const r = run(["check", "a.cd.yaml"], { "a.cd.yaml": "classes:\n  A: {}\n" });
    expect(r).toMatchObject({ code: 0, stdout: "a.cd.yaml: ok (0 warnings)\n" });
  });

  it("prints path, line, column and message and exits 1 on errors", () => {
    const r = run(["check", "a.cd.yaml"], { "a.cd.yaml": bad });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      'a.cd.yaml:3:5 error classes.A.colour: unknown key "colour"; allowed keys:',
    );
  });

  it("prints machine-readable output with --json", () => {
    const r = run(["check", "--json", "a.cd.yaml"], { "a.cd.yaml": bad });
    expect(r.code).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({
      file: "a.cd.yaml",
      ok: false,
      diagnostics: [{ severity: "error", path: "classes.A.colour", line: 3, column: 5 }],
    });
  });

  it("exits 0 when there are only warnings", () => {
    const text = "classes:\n  A: {}\nlayout:\n  classes:\n    B: { x: 0, y: 0 }\n";
    const r = run(["check", "a.cd.yaml"], { "a.cd.yaml": text });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("warning layout.classes.B");
  });

  it("exits 2 for a missing file or bad usage", () => {
    expect(run(["check", "nope.cd.yaml"]).code).toBe(2);
    expect(run(["check"]).code).toBe(2);
    expect(run([]).code).toBe(2);
  });
});

describe("diagent schema", () => {
  it("prints a JSON Schema", () => {
    const r = run(["schema"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ type: "object", required: ["classes"] });
  });
});

describe("executable", () => {
  it("runs through the bin entry point", () => {
    const r = spawnSync("pnpm", ["exec", "tsx", "src/cli.ts", "check", "examples/kolobok.cd.yaml"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ok");
  });

  it("runs through a symlink, as global installs and npx call it", () => {
    const dir = mkdtempSync(join(tmpdir(), "diagent-bin-"));
    const link = join(dir, "diagent.ts");
    symlinkSync(resolve("src/cli.ts"), link);
    const r = spawnSync("pnpm", ["exec", "tsx", link, "check", "examples/kolobok.cd.yaml"], {
      encoding: "utf8",
    });
    rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ok");
  });
});
