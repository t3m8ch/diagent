import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("diagent edit (CLI)", () => {
  it("starts a server with --no-open and prints its URL", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "diagent-cli-")), "a.cd.yaml");
    writeFileSync(file, "classes:\n  A: {}\n");
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "edit", file, "--no-open"], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let out = "";
        child.stdout.on("data", (d) => {
          out += d;
          const m = out.match(/http:\/\/127\.0\.0\.1:\d+\//);
          if (m) resolve(m[0]);
        });
        child.on("exit", () => reject(new Error("exited early")));
        setTimeout(() => reject(new Error("timeout")), 15000);
      });
      expect((await fetch(url + "api/file")).status).toBe(200);
    } finally {
      child.kill();
    }
  }, 20000);

  it("exits 2 on a missing file", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "edit", "/nonexistent.cd.yaml", "--no-open"]);
    const code = await new Promise((r) => child.on("exit", r));
    expect(code).toBe(2);
  }, 20000);
});
