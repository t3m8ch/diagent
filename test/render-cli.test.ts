import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

async function run(argv: string[], files: Record<string, string> = {}) {
  let stdout = "";
  let stderr = "";
  const written: Record<string, string | Uint8Array> = {};
  const code = await runCli(argv, {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    readFile: (p) => {
      const text = files[p];
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    writeFile: (p, d) => {
      written[p] = d;
    },
  });
  return { code, stdout, stderr, written };
}

const ok = "classes:\n  A: {}\n  B: {}\nrelations:\n  generalization:\n    - { child: B, parent: A }\n";

describe("diagent render", () => {
  it("writes an SVG for -o *.svg", async () => {
    const r = await run(["render", "a.cd.yaml", "-o", "a.svg"], { "a.cd.yaml": ok });
    expect(r.code).toBe(0);
    expect(String(r.written["a.svg"])).toMatch(/^<svg /);
  });

  it("writes a PNG for -o *.png", async () => {
    const r = await run(["render", "a.cd.yaml", "-o", "a.png"], { "a.cd.yaml": ok });
    expect(r.code).toBe(0);
    const png = r.written["a.png"] as Uint8Array;
    expect(Array.from(png.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
  });

  it("applies --theme dark", async () => {
    const r = await run(["render", "a.cd.yaml", "-o", "a.svg", "--theme", "dark"], { "a.cd.yaml": ok });
    expect(String(r.written["a.svg"])).toContain('fill="#000000"/>');
  });

  it("prints the same errors as check for an invalid file and writes nothing", async () => {
    const bad = "classes:\n  A:\n    colour: red\n";
    const checked = await run(["check", "a.cd.yaml"], { "a.cd.yaml": bad });
    const r = await run(["render", "a.cd.yaml", "-o", "a.svg"], { "a.cd.yaml": bad });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe(checked.stdout);
    expect(r.written).toEqual({});
  });

  it("rejects a missing or unknown output extension and a bad theme", async () => {
    expect((await run(["render", "a.cd.yaml"], { "a.cd.yaml": ok })).code).toBe(2);
    expect((await run(["render", "a.cd.yaml", "-o", "a.pdf"], { "a.cd.yaml": ok })).code).toBe(2);
    expect((await run(["render", "a.cd.yaml", "-o", "a.svg", "--theme", "red"], { "a.cd.yaml": ok })).code).toBe(2);
  });
});
