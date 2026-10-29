import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

describe("schema/diagent.schema.json", () => {
  it("equals the output of `diagent schema` (rebuild with `pnpm build` if not)", () => {
    let stdout = "";
    main(["schema"], { stdout: (t) => (stdout += t), stderr: () => {}, readFile: () => "" });
    const file = readFileSync(new URL("../schema/diagent.schema.json", import.meta.url), "utf8");
    expect(file).toBe(stdout);
  });
});
