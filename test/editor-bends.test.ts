import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bendAt, relationAt, filePoints, insertIndex } from "../src/bends.js";
import { History } from "../src/history.js";
import { inverseOf } from "../src/save.js";
import { parseActions } from "../src/edit.js";
import { applyActions } from "../src/save.js";
import { layoutText } from "../src/render.js";

const kolobok = readFileSync(new URL("../examples/kolobok.cd.yaml", import.meta.url), "utf8");
const pos = (l: Awaited<ReturnType<typeof layoutText>>) => Object.fromEntries(l.classes.map((c) => [c.name, { x: c.x, y: c.y }]));

describe("da-7 acceptance", () => {
  it("bends placed in the editor are on the route after render", async () => {
    const auto = await layoutText(kolobok);
    const key = auto.relations.find((e) => e.kind === "generalization")!.key;
    // Two bends in file order, off the automatic route and on the 10 px grid.
    const bends: [number, number][] = [[-120, 40], [-120, 300]];
    const saved = applyActions(kolobok, [{ type: "setBends", key, bends }]);
    const relation = (await layoutText(saved)).relations.find((e) => e.key === key)!;
    const pts = filePoints(relation);
    let from = 0;
    for (const [x, y] of bends) {
      const i = pts.findIndex((p, j) => j >= from && p.x === x && p.y === y);
      expect(i, `bend ${x},${y} on the route`).toBeGreaterThanOrEqual(0);
      from = i;
    }
    for (let i = 0; i + 1 < relation.points.length; i++) {
      const a = relation.points[i]!;
      const b = relation.points[i + 1]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it("after Pin all, adding a class moves none of the old ones", async () => {
    const auto = await layoutText(kolobok);
    const all = Object.fromEntries(auto.classes.map((c) => [c.name, { x: c.x, y: c.y }]));
    const pinned = applyActions(kolobok, [{ type: "pinAll", classes: all }]);
    const before = pos(await layoutText(pinned));
    expect(before).toEqual(all);
    const bigger = pinned.replace("classes:\n", "classes:\n  Новичок:\n    attributes:\n      - { name: поле }\n");
    const after = await layoutText(bigger);
    expect(after.classes.some((c) => c.name === "Новичок")).toBe(true);
    for (const [n, p] of Object.entries(before)) expect(pos(after)[n]).toEqual(p);
  });
});

const model = "classes:\n  A: {}\n  B: {}\n  C: {}\nrelations:\n  generalization:\n    - { child: B, parent: A }\n";

describe("pinAll / unpinAll in the save pipeline", () => {
  it("fileLayout listed classes, skips unknown names, keeps the rest of the file", () => {
    const out = applyActions(model, [{ type: "pinAll", classes: { A: { x: 0, y: 0 }, B: { x: 10, y: 20 }, Nope: { x: 1, y: 1 } } }]);
    expect(out.startsWith(model.trimEnd())).toBe(true);
    expect(out).toContain("A: { x: 0, y: 0 }");
    expect(out).toContain("B: { x: 10, y: 20 }");
    expect(out).not.toContain("Nope");
  });

  it("unpinAll clears classes but keeps bends; removes the section when nothing is left", () => {
    const key = "generalization:B-A";
    const text = applyActions(model, [
      { type: "pinAll", classes: { A: { x: 0, y: 0 } } },
      { type: "setBends", key, bends: [[30, 40]] },
    ]);
    const cleared = applyActions(text, [{ type: "unpinAll" }]);
    expect(cleared).not.toContain("x: 0");
    expect(cleared).toMatch(/bends: \[ ?\[ ?30, 40 ?\] ?\]/);
    expect(applyActions(cleared, [{ type: "setBends", key, bends: null }]).trimEnd()).toBe(model.trimEnd());
  });

  it("history restores previous fileLayout for pinAll and unpinAll", () => {
    const fileLayout = { classes: { A: { x: 1, y: 2 } }, relations: {} };
    expect(inverseOf([{ type: "pinAll", classes: { A: { x: 9, y: 9 }, B: { x: 0, y: 0 } } }], fileLayout)).toEqual([
      { type: "pinClass", name: "A", x: 1, y: 2 },
      { type: "unpinClass", name: "B" },
    ]);
    expect(inverseOf([{ type: "unpinAll" }], fileLayout)).toEqual([{ type: "pinClass", name: "A", x: 1, y: 2 }]);
    const h = new History();
    h.push({ redo: [{ type: "unpinAll" }], undo: inverseOf([{ type: "unpinAll" }], fileLayout) });
    expect(h.undo()).toEqual([{ type: "pinClass", name: "A", x: 1, y: 2 }]);
  });

  it("the server validates the new actions", () => {
    expect(parseActions({ actions: [{ type: "unpinAll" }] })).toEqual([{ type: "unpinAll" }]);
    expect(parseActions({ actions: [{ type: "pinAll", classes: { A: { x: 1.4, y: 2 } } }] })).toEqual([
      { type: "pinAll", classes: { A: { x: 1, y: 2 } } },
    ]);
    expect(parseActions({ actions: [{ type: "pinAll", classes: { A: { x: "a", y: 2 } } }] })).toBeUndefined();
    expect(parseActions({ actions: [{ type: "pinAll", classes: [] }] })).toBeUndefined();
  });
});

describe("bend geometry", () => {
  const relation: any = {
    key: "k",
    reversed: true,
    // runs ends[1] -> ends[0]; in file order it is (100,0) -> (100,100) -> (0,100)
    points: [{ x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }],
  };
  it("finds the relation near a point and a handle near a point", () => {
    expect(relationAt([relation], { x: 50, y: 103 })).toBe(relation);
    expect(relationAt([relation], { x: 50, y: 60 })).toBeUndefined();
    expect(bendAt([[10, 10], [50, 50]], { x: 52, y: 49 })).toBe(1);
    expect(bendAt([[10, 10]], { x: 80, y: 80 })).toBe(-1);
  });
  it("inserts a bend in file order, also on a reversed relation", () => {
    expect(insertIndex(relation, [], { x: 50, y: 100 })).toBe(0);
    expect(insertIndex(relation, [[100, 50]], { x: 50, y: 100 })).toBe(1);
    expect(insertIndex(relation, [[100, 50]], { x: 100, y: 20 })).toBe(0);
  });
});
