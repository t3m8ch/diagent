import { describe, expect, it } from "vitest";
import { applyActions } from "../src/save.js";

const model = `# Модель диаграммы
classes:
  A: {}   # первый
  B:
    attributes:
      - { name: x, type: int }
relations:
  generalization:
    - { child: B, parent: A }   # B наследует A
`;

describe("applyActions (file text, actions -> file text)", () => {
  it("fileLayout a class and changes nothing but layout, comments included", () => {
    const out = applyActions(model, [{ type: "pinClass", name: "A", x: 40, y: 20 }]);
    expect(out.startsWith(model.trimEnd())).toBe(true);
    expect(out).toContain("layout:");
    expect(out).toMatch(/A: \{ x: 40, y: 20 \}/);
  });

  it("is a no-op for an unpin of an unpinned class", () => {
    expect(applyActions(model, [{ type: "unpinClass", name: "A" }])).toBe(model);
  });

  it("unpins and removes an empty layout section", () => {
    const pinned = applyActions(model, [{ type: "pinClass", name: "A", x: 0, y: 0 }]);
    expect(applyActions(pinned, [{ type: "unpinClass", name: "A" }]).trimEnd()).toBe(model.trimEnd());
  });

  it("drops orphaned layout entries when saving", () => {
    const text =
      model +
      "layout:\n  classes:\n    Gone: { x: 1, y: 1 }\n    B: { x: 5, y: 5 }\n  relations:\n    'dependency:A-B': { bends: [[1, 2]] }\n";
    const out = applyActions(text, [{ type: "pinClass", name: "A", x: 10, y: 10 }]);
    expect(out).not.toContain("Gone");
    expect(out).not.toContain("dependency:A-B");
    expect(out).toContain("B: { x: 5, y: 5 }");
  });

  it("sets and clears bends of a relation", () => {
    const key = "generalization:B-A";
    const a = applyActions(model, [{ type: "setBends", key, bends: [[10, 20], [30, 20]] }]);
    expect(a).toContain("bends:");
    expect(applyActions(a, [{ type: "setBends", key, bends: null }]).trimEnd()).toBe(model.trimEnd());
  });

  it("ignores actions about names that are not in the model", () => {
    expect(applyActions(model, [{ type: "pinClass", name: "Nope", x: 1, y: 1 }])).toBe(model);
  });

  it("throws on a file whose YAML cannot be parsed", () => {
    expect(() => applyActions("classes: [", [{ type: "unpinClass", name: "A" }])).toThrow();
  });
});
