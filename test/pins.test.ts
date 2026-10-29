import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutDiagram, parsePins, type DiagramLayout } from "../src/layout.js";
import { parseModel } from "../src/model.js";
import { rectsOverlap, segHitsBox } from "../src/route.js";
import { layoutText, renderSvg } from "../src/render.js";
import { labelProblems } from "./label-clearance.js";

const kolobok = readFileSync(new URL("../examples/kolobok.cd.yaml", import.meta.url), "utf8");

const pos = (l: DiagramLayout) => Object.fromEntries(l.classes.map((c) => [c.name, { x: c.x, y: c.y }]));
const noOverlap = (l: DiagramLayout) => {
  for (const a of l.classes)
    for (const b of l.classes)
      if (a.name < b.name)
        expect(
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height,
          `${a.name} overlaps ${b.name}`,
        ).toBe(false);
};
const withLayout = (extra: string) => `${kolobok}\nlayout:\n${extra}`;

const PINNED = `  classes:
    Колобок: { x: 600, y: 100 }
    Лиса: { x: 40, y: 500 }
    Старик: { x: 300, y: 300 }
`;

describe("pinned classes", () => {
  it("keeps pinned classes at their coordinates and does not overlap anything", async () => {
    const l = await layoutText(withLayout(PINNED));
    expect(pos(l).Колобок).toEqual({ x: 600, y: 100 });
    expect(pos(l).Лиса).toEqual({ x: 40, y: 500 });
    expect(pos(l).Старик).toEqual({ x: 300, y: 300 });
    expect(l.classes.length).toBeGreaterThan(5);
    noOverlap(l);
  });

  it("does not move pinned classes when a class is added", async () => {
    const before = await layoutText(withLayout(PINNED));
    const bigger = kolobok.replace("classes:\n", "classes:\n  Новичок:\n    attributes:\n      - { name: поле }\n") +
      `\nlayout:\n${PINNED}`;
    const after = await layoutText(bigger);
    for (const n of ["Колобок", "Лиса", "Старик"]) expect(pos(after)[n]).toEqual(pos(before)[n]);
    expect(after.classes.some((c) => c.name === "Новичок")).toBe(true);
    noOverlap(after);
  });

  it("moves an unpinned class that would sit on a pinned one", async () => {
    const auto = await layoutText(kolobok);
    const lisa = auto.classes.find((c) => c.name === "Лиса")!;
    const b = auto.classes.find((c) => c.name === "Колобок")!;
    // Pin Колобок exactly where Лиса was put automatically.
    const l = await layoutText(withLayout(`  classes:\n    Колобок: { x: ${lisa.x}, y: ${lisa.y} }\n`));
    expect(pos(l).Колобок).toEqual({ x: lisa.x, y: lisa.y });
    noOverlap(l);
    expect(b).toBeDefined();
  });

  it("is deterministic and allows negative coordinates", async () => {
    const text = withLayout("  classes:\n    Колобок: { x: -300, y: -50 }\n");
    const svg = await renderSvg(text);
    expect(await renderSvg(text)).toBe(svg);
    const l = await layoutText(text);
    expect(l.originX).toBeLessThan(-300);
    expect(svg).toMatch(/viewBox="-/);
  });

  it("ignores orphaned layout entries", async () => {
    const withOrphans = withLayout("  classes:\n    Нет: { x: 1, y: 1 }\n  relations:\n    nope:Х-У: { bends: [[1, 1]] }\n");
    expect(await renderSvg(withOrphans)).toBe(await renderSvg(kolobok));
  });
});

describe("bends", () => {
  const two = (bends: string) => `classes:
  Родитель: {}
  Ребёнок: {}
  Сосед: {}
relations:
  generalization:
    - { child: Ребёнок, parent: Родитель }
  dependency:
    - { client: Сосед, supplier: Ребёнок, stereotype: use }
layout:
  classes:
    Родитель: { x: 20, y: 20 }
    Ребёнок: { x: 20, y: 300 }
    Сосед: { x: 400, y: 20 }
  relations:
${bends}`;

  it("routes the relation through the given points, orthogonally", async () => {
    const l = await layoutText(two("    generalization:Ребёнок-Родитель: { bends: [[300, 200], [300, 120]] }\n"));
    const e = l.relations.find((x) => x.key === "generalization:Ребёнок-Родитель")!;
    const has = (x: number, y: number) => e.points.some((p) => p.x === x && p.y === y);
    expect(has(300, 200)).toBe(true);
    expect(has(300, 120)).toBe(true);
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]!;
      const b = e.points[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
    // bends are in file order (child -> parent); the route runs parent -> child.
    expect(e.reversed).toBe(true);
    expect(e.points.findIndex((p) => p.y === 120)).toBeLessThan(e.points.findIndex((p) => p.y === 200));
  });

  it("leaves other relations to the engine and ends on the class borders", async () => {
    const l = await layoutText(two("    generalization:Ребёнок-Родитель: { bends: [[300, 200]] }\n"));
    const e = l.relations.find((x) => x.kind === "generalization")!;
    const box = (n: string) => l.classes.find((c) => c.name === n)!;
    const onBorder = (p: { x: number; y: number }, c: ReturnType<typeof box>) =>
      p.x >= c.x && p.x <= c.x + c.width && p.y >= c.y && p.y <= c.y + c.height &&
      (p.x === c.x || p.x === c.x + c.width || p.y === c.y || p.y === c.y + c.height);
    expect(onBorder(e.points[0]!, box("Родитель"))).toBe(true);
    expect(onBorder(e.points[e.points.length - 1]!, box("Ребёнок"))).toBe(true);
    const dep = l.relations.find((x) => x.kind === "dependency")!;
    expect(dep.points.length).toBeGreaterThanOrEqual(2);
  });

  it("parsePins drops malformed and orphaned entries", () => {
    const { model } = parseModel(two(""));
    const pins = parsePins(
      { classes: { Родитель: { x: 1.4, y: 2 }, Нет: { x: 0, y: 0 }, Сосед: { x: "a" } }, relations: { "x": { bends: [[1, 1]] } } },
      model,
    );
    expect(pins).toEqual({ classes: { Родитель: { x: 1, y: 2 } }, relations: {} });
  });

  it("layoutDiagram without pins equals the pure automatic layout", async () => {
    const { model } = parseModel(kolobok);
    expect(await layoutDiagram(model, { classes: {}, relations: {} })).toEqual(await layoutDiagram(model));
  });
});

describe("pinned layout invariants", () => {
  const sets: Record<string, string> = {
    "3 pins": PINNED,
    "5 pins": `  classes:
    Колобок: { x: 100, y: 900 }
    Лиса: { x: 900, y: 100 }
    Старуха: { x: 500, y: 500 }
    Зверь: { x: 100, y: 100 }
    Место: { x: 900, y: 1200 }
`,
  };
  for (const [name, layout] of Object.entries(sets)) {
    it(`labels stay off lines and off each other (${name})`, async () => {
      expect(labelProblems(await layoutText(withLayout(layout)))).toEqual([]);
    });

    it(`no relation or label crosses a foreign class (${name})`, async () => {
      const l = await layoutText(withLayout(layout));
      noOverlap(l);
      for (const e of l.relations) {
        for (let i = 1; i < e.points.length; i++) {
          const a = e.points[i - 1]!;
          const b = e.points[i]!;
          expect(a.x === b.x || a.y === b.y, `${e.key} is orthogonal`).toBe(true);
          for (const c of l.classes) {
            if (c.name === e.source || c.name === e.target) continue;
            expect(segHitsBox(a, b, c), `${e.key} crosses ${c.name}`).toBe(false);
          }
        }
        for (const lab of e.labels)
          for (const c of l.classes) expect(rectsOverlap(lab, c), `label "${lab.text}" of ${e.key} on ${c.name}`).toBe(false);
      }
    });
  }
});
