/**
 * Automatic layout: model -> plain data (class boxes, edge routes, label positions).
 * Browser-safe (elkjs bundle, no Node imports). Drawing lives in `draw.ts` and only
 * reads the result of this module, so pinned classes and bends (da-4) and the
 * editor (da-6) can produce or modify a `DiagramLayout` without touching the drawing code.
 */
import ElkModule from "elkjs/lib/elk.bundled.js";
import type { ClassModel, Model, Operation, Attribute, Relation, Visibility } from "./model.js";

// ---- fixed text metrics -------------------------------------------------
// Text is set in DejaVu Sans Mono, whose advance is 0.602 em. We never ask the
// system for metrics: width = number of code points * a constant, so the layout
// (and therefore the SVG bytes) is the same on every machine.
export const FONT_SIZE = 13;
export const CHAR_W = 8;
export const LABEL_FONT_SIZE = 12;
export const LABEL_CHAR_W = 7.5;
export const LINE_H = 18;
export const LABEL_H = 16;
export const PAD_X = 10;
export const PAD_Y = 6;
export const PAD_C = 5;
const MIN_WIDTH = 90;
const MARGIN = 20;

const textWidth = (s: string, cw: number) => Array.from(s).length * cw;

// ---- result types -------------------------------------------------------
export interface Point {
  x: number;
  y: number;
}

export interface TextItem {
  text: string;
  italic?: boolean;
  underline?: boolean;
}

export interface ClassBox {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Header lines: optional stereotype lines, then the name. */
  stereotypes: string[];
  italicName: boolean;
  headerHeight: number;
  /** Compartments below the header, top to bottom; `y` is relative to the box. */
  compartments: { y: number; height: number; items: TextItem[] }[];
}

export type Marker = "none" | "triangle" | "diamond" | "filled-diamond" | "arrow";

export interface EdgeLabel {
  kind: "name" | "stereotype" | "source-end" | "target-end";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeRoute {
  /** Relation key as in `layout.relations`. */
  key: string;
  kind: Relation["kind"];
  source: string;
  target: string;
  /** Polyline from source to target, orthogonal. */
  points: Point[];
  sourceMarker: Marker;
  targetMarker: Marker;
  dashed: boolean;
  labels: EdgeLabel[];
}

export interface DiagramLayout {
  width: number;
  height: number;
  classes: ClassBox[];
  edges: EdgeRoute[];
}

// ---- class content ------------------------------------------------------
const VIS: Record<Visibility, string> = { public: "+", private: "-", protected: "#", package: "~" };

const attributeText = (a: Attribute) =>
  `${VIS[a.visibility]} ${a.name}${a.type ? `: ${a.type}` : ""}${a.multiplicity ? ` [${a.multiplicity}]` : ""}`;

const operationText = (o: Operation) =>
  `${VIS[o.visibility]} ${o.name}(${o.params.map((p) => `${p.name}: ${p.type}`).join(", ")})${o.returns ? `: ${o.returns}` : ""}`;

function measureClass(c: ClassModel): Omit<ClassBox, "x" | "y"> {
  const stereotypes: string[] = [];
  if (c.kind === "interface") stereotypes.push("«interface»");
  if (c.kind === "enum") stereotypes.push("«enumeration»");
  if (c.stereotype) stereotypes.push(`«${c.stereotype}»`);

  const lists: TextItem[][] = [];
  if (c.kind === "enum") {
    if (c.literals.length > 0) lists.push(c.literals.map((text) => ({ text })));
  } else if (c.attributes.length > 0 || c.operations.length > 0) {
    lists.push(c.attributes.map((a) => ({ text: attributeText(a), underline: a.static })));
    lists.push(c.operations.map((o) => ({ text: operationText(o), underline: o.static, italic: o.abstract })));
  }

  const headerHeight = (stereotypes.length + 1) * LINE_H + 2 * PAD_Y;
  let y = headerHeight;
  const compartments = lists.map((items) => {
    const height = Math.max(items.length * LINE_H + 2 * PAD_C, 2 * PAD_C + 4);
    const comp = { y, height, items };
    y += height;
    return comp;
  });

  const widths = [
    textWidth(c.name, CHAR_W),
    ...stereotypes.map((s) => textWidth(s, CHAR_W)),
    ...lists.flat().map((i) => textWidth(i.text, CHAR_W)),
  ];
  const width = Math.max(MIN_WIDTH, Math.max(...widths) + 2 * PAD_X);
  return {
    name: c.name,
    width,
    height: y,
    stereotypes,
    italicName: c.abstract,
    headerHeight,
    compartments,
  };
}

// ---- relation semantics -------------------------------------------------
interface EdgeSpec {
  relation: Relation;
  /** ELK source is the visually upper end: parents/interfaces/wholes/clients go up. */
  swap: boolean;
}

function markersFor(r: Relation): [Marker, Marker] {
  switch (r.kind) {
    case "generalization":
    case "realization":
      return ["none", "triangle"];
    case "composition":
      return ["filled-diamond", "none"];
    case "aggregation":
      return ["diamond", "none"];
    case "dependency":
      return ["none", "arrow"];
    case "association":
      return [r.ends[0].navigable ? "arrow" : "none", r.ends[1].navigable ? "arrow" : "none"];
  }
}

const endLabel = (e: Relation["ends"][0]) => [e.role, e.multiplicity].filter(Boolean).join(" ");

function glyph(dx: number, dy: number): string {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "▶" : "◀";
  return dy >= 0 ? "▼" : "▲";
}

// ---- layout -------------------------------------------------------------
const ELK_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.padding": `[top=${MARGIN},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]`,
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "60",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "14",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
  "elk.spacing.edgeLabel": "4",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.randomSeed": "1",
};

// CJS bundle: under NodeNext the default import is typed as the module namespace.
const ELK = ElkModule as unknown as new () => { layout(graph: any): Promise<any> };
const elk = new ELK();
const round = (n: number) => Math.round(n);

/** Computes class boxes, edge routes and label positions. Ignores `layout` of the file (da-3). */
export async function layoutDiagram(model: Model): Promise<DiagramLayout> {
  const boxes = new Map(model.classes.map((c) => [c.name, measureClass(c)]));

  const specs: EdgeSpec[] = model.relations.map((relation) => ({
    relation,
    swap: relation.kind === "generalization" || relation.kind === "realization",
  }));

  const children = model.classes.map((c) => ({
    id: c.name,
    width: boxes.get(c.name)!.width,
    height: boxes.get(c.name)!.height,
  }));

  const edges = specs.map(({ relation: r, swap }) => {
    const [a, b] = swap ? [r.ends[1], r.ends[0]] : [r.ends[0], r.ends[1]];
    const labels: any[] = [];
    const add = (id: string, text: string, placement: string) => {
      if (text) {
        labels.push({
          id: `${r.key}#${id}`,
          text,
          width: textWidth(text, LABEL_CHAR_W) + 4,
          height: LABEL_H,
          layoutOptions: { "elk.edgeLabels.placement": placement },
        });
      }
    };
    add("tail", endLabel(a), "TAIL");
    add("center", centerText(r, "▶"), "CENTER");
    add("head", endLabel(b), "HEAD");
    return { id: r.key, sources: [a.class], targets: [b.class], labels };
  });

  const result = await elk.layout({
    id: "root",
    layoutOptions: ELK_OPTIONS,
    children,
    edges,
  } as any);

  const placed = new Map(((result.children ?? []) as any[]).map((n) => [n.id, n]));
  const classes: ClassBox[] = model.classes.map((c) => {
    const n = placed.get(c.name)!;
    return { ...boxes.get(c.name)!, x: round(n.x ?? 0), y: round(n.y ?? 0) };
  });
  const byName = new Map(classes.map((c) => [c.name, c]));

  const routes: EdgeRoute[] = specs.map(({ relation: r, swap }, i) => {
    const e = result.edges![i] as any;
    const sec = e.sections?.[0];
    const points: Point[] = sec
      ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p: Point) => ({ x: round(p.x), y: round(p.y) }))
      : [];
    const [m0, m1] = markersFor(r);
    const [sourceMarker, targetMarker] = swap ? [m1, m0] : [m0, m1];

    const labels: EdgeLabel[] = [];
    for (const l of (e.labels ?? []) as any[]) {
      const part = String(l.id).split("#")[1]!;
      let kind: EdgeLabel["kind"];
      let text: string = l.text;
      if (part === "tail") kind = "source-end";
      else if (part === "head") kind = "target-end";
      else {
        kind = r.kind === "dependency" ? "stereotype" : "name";
        if (r.kind === "association" && r.reading !== undefined) {
          const from = byName.get(r.ends[r.reading === 1 ? 0 : 1].class)!;
          const to = byName.get(r.ends[r.reading].class)!;
          const g = glyph(to.x + to.width / 2 - (from.x + from.width / 2), to.y + to.height / 2 - (from.y + from.height / 2));
          text = withGlyph(r.name!, g);
        }
      }
      labels.push({ kind, text, x: round(l.x), y: round(l.y), width: round(l.width), height: l.height });
    }
    return {
      key: r.key,
      kind: r.kind,
      source: (swap ? r.ends[1] : r.ends[0]).class,
      target: (swap ? r.ends[0] : r.ends[1]).class,
      points,
      sourceMarker,
      targetMarker,
      dashed: r.kind === "dependency" || r.kind === "realization",
      labels,
    };
  });

  return { width: round(result.width ?? 0), height: round(result.height ?? 0), classes, edges: routes };
}

/** Association name with a reading-direction glyph; the glyph is chosen after layout. */
const withGlyph = (name: string, g: string) => (g === "◀" || g === "▲" ? `${g} ${name}` : `${name} ${g}`);

function centerText(r: Relation, g: string): string {
  if (r.kind === "dependency") return r.stereotype ? `«${r.stereotype}»` : "";
  if (r.kind === "association" && r.reading !== undefined) return withGlyph(r.name!, g);
  return r.name ?? "";
}
