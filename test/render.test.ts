import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { drawSvg } from "../src/draw.js";
import { layoutText, renderSvg } from "../src/render.js";
import { labelProblems } from "./label-clearance.js";

const kolobok = readFileSync(new URL("../examples/kolobok.cd.yaml", import.meta.url), "utf8");
const tale = readFileSync(new URL("./fixtures/tale.cd.yaml", import.meta.url), "utf8");

const small: Record<string, string> = {
  generalization: "classes:\n  Зверь: { abstract: true }\n  Лиса: {}\nrelations:\n  generalization:\n    - { child: Лиса, parent: Зверь }\n",
  realization:
    "classes:\n  Поющий: { kind: interface, operations: [{ name: петь, abstract: true }] }\n  Колобок: {}\nrelations:\n  realization:\n    - { implementor: Колобок, interface: Поющий }\n",
  composition:
    'classes:\n  Колобок: {}\n  Песня: {}\nrelations:\n  composition:\n    - { whole: Колобок, part: Песня, whole_multiplicity: "1", part_multiplicity: "1" }\n',
  aggregation:
    'classes:\n  Колобок: {}\n  Ингредиент: {}\nrelations:\n  aggregation:\n    - { name: состав, whole: Колобок, part: Ингредиент, part_multiplicity: "1..*" }\n',
  dependency:
    "classes:\n  Старуха: {}\n  Колобок: {}\nrelations:\n  dependency:\n    - { client: Старуха, supplier: Колобок, stereotype: create }\n",
  association:
    'classes:\n  Старик: {}\n  Старуха: {}\nrelations:\n  association:\n    - name: просит испечь\n      ends:\n        - { class: Старик, multiplicity: "1", role: муж }\n        - { class: Старуха, multiplicity: "1", navigable: true }\n',
  "self-association":
    'classes:\n  Место: {}\nrelations:\n  association:\n    - name: ведёт в\n      ends:\n        - { class: Место, multiplicity: "0..1" }\n        - { class: Место, multiplicity: "0..1" }\n',
  members:
    "classes:\n  Счётчик:\n    stereotype: entity\n    attributes:\n      - { name: всего, type: Integer, static: true }\n      - { name: код, visibility: protected }\n    operations:\n      - { name: сброс, visibility: package }\n      - { name: считать, abstract: true, returns: Integer }\n  Цвет: { kind: enum, literals: [КРАСНЫЙ] }\n",
};

describe("renderSvg snapshots", () => {
  it("renders Колобок (light)", async () => {
    await expect(await renderSvg(kolobok)).toMatchFileSnapshot("__snapshots__/kolobok.light.svg");
  });
  it("renders Колобок (dark)", async () => {
    await expect(await renderSvg(kolobok, { theme: "dark" })).toMatchFileSnapshot("__snapshots__/kolobok.dark.svg");
  });
  for (const [name, text] of Object.entries(small)) {
    it(`renders ${name}`, async () => {
      await expect(await renderSvg(text)).toMatchFileSnapshot(`__snapshots__/${name}.svg`);
    });
  }
});

describe("renderSvg", () => {
  it("is byte-identical on repeated renders", async () => {
    expect(await renderSvg(kolobok)).toBe(await renderSvg(kolobok));
  });

  it("draws a class name and uses black and white only", async () => {
    const svg = await renderSvg("classes:\n  Колобок: {}\n");
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain(">Колобок</text>");
    expect(new Set(svg.match(/#[0-9a-f]{6}/g))).toEqual(new Set(["#000000", "#ffffff"]));
  });

  it("swaps colours in the dark theme", async () => {
    const svg = await renderSvg("classes:\n  A: {}\n", { theme: "dark" });
    expect(svg).toMatch(/<rect width="\d+" height="\d+" fill="#000000"\/>/);
  });

  it("writes visibility symbols, underline for static, italic for abstract, stereotypes", async () => {
    const svg = await renderSvg(small.members!);
    expect(svg).toContain(">«entity»</text>");
    expect(svg).toContain(">«enumeration»</text>");
    expect(svg).toMatch(/text-decoration="underline">\+ всего: Integer</);
    expect(svg).toContain(">+ код</text>".replace("+", "#"));
    expect(svg).toContain(">~ сброс()</text>");
    expect(svg).toMatch(/font-style="italic">\+ считать\(\): Integer</);
  });
});

describe("layoutText", () => {
  it("is plain JSON data, independent of drawing", async () => {
    const layout = await layoutText(kolobok);
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
    expect(layout.classes).toHaveLength(16);
    expect(drawSvg(layout)).toBe(await renderSvg(kolobok));
  });

  it("puts the parent above the child and the arrowhead on the parent", async () => {
    const layout = await layoutText(small.generalization!);
    const parent = layout.classes.find((c) => c.name === "Зверь")!;
    const child = layout.classes.find((c) => c.name === "Лиса")!;
    expect(parent.y + parent.height).toBeLessThan(child.y);
    expect(layout.relations[0]).toMatchObject({ source: "Зверь", target: "Лиса", sourceMarker: "triangle", targetMarker: "none" });
  });

  it("sizes a class by its content", async () => {
    const layout = await layoutText(
      "classes:\n  Короткий: {}\n  Длинный:\n    operations:\n      - { name: оченьДлинноеИмяОперации, params: { параметр: String } }\n",
    );
    const [short, long] = layout.classes;
    expect(long!.width).toBeGreaterThan(short!.width);
    expect(long!.height).toBeGreaterThan(short!.height);
  });

  it("does not overlap classes, nor relation labels", async () => {
    const layout = await layoutText(kolobok);
    type R = { x: number; y: number; width: number; height: number };
    const overlap = (a: R, b: R) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const boxes = layout.classes;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false);
    const labels = layout.relations.flatMap((e) => e.labels);
    for (let i = 0; i < labels.length; i++) {
      for (const b of boxes) expect(overlap(labels[i]!, b), labels[i]!.text).toBe(false);
      for (let j = i + 1; j < labels.length; j++)
        expect(overlap(labels[i]!, labels[j]!), `${labels[i]!.text} / ${labels[j]!.text}`).toBe(false);
    }
  });

  it("keeps labels off other classes, off every relation line and off each other", async () => {
    for (const [name, text] of Object.entries({ kolobok, tale })) expect(labelProblems(await layoutText(text)), name).toEqual([]);
  });

  it("draws a self-association as a loop", async () => {
    const relation = (await layoutText(small["self-association"]!)).relations[0]!;
    expect(relation.source).toBe(relation.target);
    expect(relation.points.length).toBeGreaterThanOrEqual(3);
  });
});
