/**
 * Automatic layout: model -> plain data (class boxes, relation routes, label positions).
 * Browser-safe (elkjs bundle, no Node imports). Drawing lives in `draw.ts` and only
 * reads the result of this module, so pinned classes and bends (da-4) and the
 * editor (da-6) can produce or modify a `DiagramGeometry` without touching the drawing code.
 */
import ElkModule from "elkjs/lib/elk.bundled.js";
import { rectsOverlap, routeAround, segHitsBox } from "./route.js";
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

export interface RelationLabel {
  kind: "name" | "stereotype" | "source-end" | "target-end";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RelationRoute {
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
  labels: RelationLabel[];
  /** True when `points` run from `ends[1]` to `ends[0]` of the relation (parents/interfaces go on top). */
  reversed: boolean;
}

export interface DiagramGeometry {
  /** Top-left of the drawing area; 0,0 unless pinned classes sit at negative coordinates. */
  originX?: number;
  originY?: number;
  width: number;
  height: number;
  classes: ClassBox[];
  relations: RelationRoute[];
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
interface RelationSpec {
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

/**
 * Computes class boxes, relation routes and label positions. With `fileLayout` (the file's `layout`
 * section, see `parseFileLayout`) pinned classes stand exactly there, the rest is arranged around
 * them, and relations with `bends` pass through those points (see `applyFileLayout`).
 */
export async function layoutDiagram(model: Model, fileLayout?: FileLayout): Promise<DiagramGeometry> {
  const boxes = new Map(model.classes.map((c) => [c.name, measureClass(c)]));

  const specs: RelationSpec[] = model.relations.map((relation) => ({
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

  const routes: RelationRoute[] = specs.map(({ relation: r, swap }, i) => {
    const e = result.edges![i] as any;
    const sec = e.sections?.[0];
    const points: Point[] = sec
      ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p: Point) => ({ x: round(p.x), y: round(p.y) }))
      : [];
    const [m0, m1] = markersFor(r);
    const [sourceMarker, targetMarker] = swap ? [m1, m0] : [m0, m1];

    const labels: RelationLabel[] = [];
    for (const l of (e.labels ?? []) as any[]) {
      const part = String(l.id).split("#")[1]!;
      let kind: RelationLabel["kind"];
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
      reversed: swap,
    };
  });

  const auto = fitArea(settleLabels({ width: round(result.width ?? 0), height: round(result.height ?? 0), classes, relations: routes }), false);
  const hasFileLayout = fileLayout && (Object.keys(fileLayout.classes ?? {}).length > 0 || Object.keys(fileLayout.relations ?? {}).length > 0);
  return hasFileLayout ? applyFileLayout(auto, model, fileLayout) : auto;
}

/** Association name with a reading-direction glyph; the glyph is chosen after layout. */
const withGlyph = (name: string, g: string) => (g === "◀" || g === "▲" ? `${g} ${name}` : `${name} ${g}`);

function centerText(r: Relation, g: string): string {
  if (r.kind === "dependency") return r.stereotype ? `«${r.stereotype}»` : "";
  if (r.kind === "association" && r.reading !== undefined) return withGlyph(r.name!, g);
  return r.name ?? "";
}

// ---- pinned classes and bends (da-4) --------------------------------------
/** The file's `layout` section. Orphaned or malformed entries are ignored (`check` warns about them). */
export interface FileLayout {
  classes?: Record<string, { x: number; y: number }>;
  /** `bends` run from the first to the second end of the relation, as in the file. */
  relations?: Record<string, { bends?: [number, number][] }>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Cleans the raw `layout` object from `parseModel` into `FileLayout`, keeping only entries that name something in the model. */
export function parseFileLayout(raw: unknown, model: Model): FileLayout {
  const fileLayout: FileLayout = { classes: {}, relations: {} };
  const o = (raw ?? {}) as Record<string, any>;
  const names = new Set(model.classes.map((c) => c.name));
  const keys = new Set(model.relations.map((r) => r.key));
  for (const [name, p] of Object.entries(o.classes ?? {}))
    if (names.has(name) && isNum((p as any)?.x) && isNum((p as any)?.y))
      fileLayout.classes![name] = { x: Math.round((p as any).x), y: Math.round((p as any).y) };
  for (const [key, r] of Object.entries(o.relations ?? {})) {
    const bends = (r as any)?.bends;
    if (keys.has(key) && Array.isArray(bends)) {
      const good = bends.filter((b: unknown) => Array.isArray(b) && isNum(b[0]) && isNum(b[1]));
      if (good.length > 0) fileLayout.relations![key] = { bends: good.map((b: number[]) => [Math.round(b[0]!), Math.round(b[1]!)]) };
    }
  }
  return fileLayout;
}

const GAP = 20;
const overlaps = (a: ClassBox, b: ClassBox, gap = GAP) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/**
 * Puts pinned classes at their coordinates and arranges the rest around them. Pure and
 * deterministic; `auto` is an unpinned layout (not modified).
 *
 * 1. Pinned classes are set to their coordinates.
 * 2. Every other class is placed in breadth-first order from the pinned ones. Its ideal spot
 *    keeps the offset it had in `auto` to each already placed neighbour (averaged); the
 *    closest spot that clears every placed class by 44 px is taken. Classes with no placed
 *    neighbour use the automatic position shifted by the first pin's offset.
 * 3. An relation whose classes moved by the same offset, with no bends and no collision, keeps its
 *    automatic route (translated). Every other relation goes through `routeAround`: orthogonal A*
 *    that never crosses a class other than its two ends and passes through the bends.
 * 4. Labels that collide with a class (and all labels of re-routed relations) are put at the
 *    first free candidate spot next to the relation.
 */
export function applyFileLayout(auto: DiagramGeometry, model: Model, fileLayout: FileLayout): DiagramGeometry {
  const pinned = fileLayout.classes ?? {};
  const first = auto.classes.find((c) => pinned[c.name]);
  const base = first ? { x: pinned[first.name]!.x - first.x, y: pinned[first.name]!.y - first.y } : { x: 0, y: 0 };
  const autoBy = new Map(auto.classes.map((c) => [c.name, c]));

  const classes: ClassBox[] = auto.classes.map((c) => {
    const p = pinned[c.name];
    return p ? { ...c, x: p.x, y: p.y } : { ...c, x: c.x + base.x, y: c.y + base.y };
  });
  const byName = new Map(classes.map((c) => [c.name, c]));

  const nb = new Map<string, string[]>(classes.map((c) => [c.name, []]));
  for (const r of model.relations) {
    const [a, b] = [r.ends[0].class, r.ends[1].class];
    if (a !== b) {
      nb.get(a)!.push(b);
      nb.get(b)!.push(a);
    }
  }
  const placed = new Set(classes.filter((c) => pinned[c.name]).map((c) => c.name));
  const order: string[] = [];
  const queue = [...placed];
  const seen = new Set(placed);
  while (queue.length > 0) {
    const n = queue.shift()!;
    for (const m of nb.get(n)!) if (!seen.has(m)) { seen.add(m); order.push(m); queue.push(m); }
  }
  for (const c of classes) if (!seen.has(c.name)) order.push(c.name);

  for (const name of order) {
    const c = byName.get(name)!;
    const a = autoBy.get(name)!;
    const ns = nb.get(name)!.filter((m) => placed.has(m));
    let ix = a.x + base.x;
    let iy = a.y + base.y;
    if (ns.length > 0) {
      ix = round(ns.reduce((s, m) => s + byName.get(m)!.x + (a.x - autoBy.get(m)!.x), 0) / ns.length);
      iy = round(ns.reduce((s, m) => s + byName.get(m)!.y + (a.y - autoBy.get(m)!.y), 0) / ns.length);
    }
    const obstacles = [...placed].map((n) => byName.get(n)!);
    const spot = freeSpot(c, ix, iy, obstacles);
    c.x = spot.x;
    c.y = spot.y;
    placed.add(name);
  }

  const relByKey = new Map(model.relations.map((r) => [r.key, r]));
  const used = new Set<string>();
  const taken: RelationLabel[] = [];
  const relations: RelationRoute[] = auto.relations.map((e) => {
    const s = byName.get(e.source)!;
    const t = byName.get(e.target)!;
    const sa = autoBy.get(e.source)!;
    const ta = autoBy.get(e.target)!;
    const ds = { x: s.x - sa.x, y: s.y - sa.y };
    const dt = { x: t.x - ta.x, y: t.y - ta.y };
    const bends = fileLayout.relations?.[e.key]?.bends;
    let routed: RelationRoute | undefined;
    let rerouted = false;
    if (e.source === e.target) routed = shift(e, ds.x, ds.y);
    else if (!bends?.length && ds.x === dt.x && ds.y === dt.y) {
      const cand = shift(e, ds.x, ds.y);
      if (!crossesBox(cand.points, classes, s, t)) routed = cand;
    }
    if (!routed) {
      const via = bends ? (e.reversed ? [...bends].reverse() : bends).map(([x, y]) => ({ x, y })) : [];
      const points = routeAround(s, t, classes, via, used) ?? routeThrough(s, t, via);
      routed = { ...e, points };
      rerouted = true;
    }
    routed = fixGlyph(routed, relByKey.get(e.key)!, byName);
    const labels = routed.labels.map((l) => {
      const hit = classes.some((c) => rectsOverlap(l, c));
      const out = rerouted || hit ? placeLabel(routed!.points, l, classes, taken) : l;
      taken.push(out);
      return out;
    });
    return { ...routed, labels };
  });

  return fitArea(settleLabels({ width: 0, height: 0, classes, relations }), true);
}

/** Drawing area: everything we know about, plus the margin. */
function fitArea(layout: DiagramGeometry, always: boolean): DiagramGeometry {
  const { classes, relations } = layout;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const c of classes) { see(c.x, c.y); see(c.x + c.width, c.y + c.height); }
  for (const e of relations) {
    for (const p of e.points) see(p.x, p.y);
    for (const l of e.labels) { see(l.x, l.y); see(l.x + l.width, l.y + l.height); }
  }
  if (!isFinite(minX)) return { width: 2 * MARGIN, height: 2 * MARGIN, classes, relations };
  const originX = minX - MARGIN;
  const originY = minY - MARGIN;
  if (!always && originX >= (layout.originX ?? 0) && originY >= (layout.originY ?? 0) && maxX + MARGIN <= (layout.originX ?? 0) + layout.width && maxY + MARGIN <= (layout.originY ?? 0) + layout.height)
    return layout;
  return { originX, originY, width: maxX + MARGIN - originX, height: maxY + MARGIN - originY, classes, relations };
}

function shift(e: RelationRoute, dx: number, dy: number): RelationRoute {
  if (dx === 0 && dy === 0) return e;
  return {
    ...e,
    points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    labels: e.labels.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })),
  };
}

/** Reading-direction glyph depends on where the boxes ended up. */
function fixGlyph(e: RelationRoute, r: Relation, byName: Map<string, ClassBox>): RelationRoute {
  if (r.kind !== "association" || r.reading === undefined) return e;
  const from = byName.get(r.ends[r.reading === 1 ? 0 : 1].class)!;
  const to = byName.get(r.ends[r.reading].class)!;
  const g = glyph(to.x + to.width / 2 - (from.x + from.width / 2), to.y + to.height / 2 - (from.y + from.height / 2));
  return { ...e, labels: e.labels.map((l) => (l.kind === "name" ? { ...l, text: withGlyph(r.name!, g) } : l)) };
}

const within = (v: number, lo: number, hi: number) => v > lo && v < hi;

/** Orthogonal polyline from box `s` to box `t` through `via` (consecutive points not on one axis get an elbow). */
function routeThrough(s: ClassBox, t: ClassBox, via: Point[]): Point[] {
  if (via.length === 0) return autoRoute(s, t);
  const start = attach(s, via[0]!);
  const end = attach(t, via[via.length - 1]!);
  const pts: Point[] = [start.p];
  // `vertical`: the last segment ran vertically, so the next elbow turns horizontally first.
  let vertical = !start.vertical; // the first elbow keeps the exit direction
  const go = (q: Point) => {
    const cur = pts[pts.length - 1]!;
    if (cur.x !== q.x && cur.y !== q.y) {
      pts.push(vertical ? { x: q.x, y: cur.y } : { x: cur.x, y: q.y });
      vertical = !vertical;
    }
    if (cur.x !== q.x || cur.y !== q.y) {
      pts.push(q);
      vertical = cur.x === q.x;
    }
  };
  for (const q of via) go(q);
  const last = pts[pts.length - 1]!;
  if (last.x !== end.p.x && last.y !== end.p.y) {
    pts.push(end.vertical ? { x: end.p.x, y: last.y } : { x: last.x, y: end.p.y });
  }
  pts.push(end.p);
  return dedupe(pts);
}

/** Point on the border of `b` facing `toward`; `vertical` says the segment leaving it is vertical. */
function attach(b: ClassBox, toward: Point): { p: Point; vertical: boolean } {
  if (within(toward.x, b.x, b.x + b.width) && (toward.y <= b.y || toward.y >= b.y + b.height))
    return { p: { x: toward.x, y: toward.y < b.y ? b.y : b.y + b.height }, vertical: true };
  if (within(toward.y, b.y, b.y + b.height) && (toward.x <= b.x || toward.x >= b.x + b.width))
    return { p: { x: toward.x < b.x ? b.x : b.x + b.width, y: toward.y }, vertical: false };
  // Diagonal (or inside the box): leave horizontally from the middle of the facing side.
  const cy = round(b.y + b.height / 2);
  return { p: { x: toward.x < b.x + b.width / 2 ? b.x : b.x + b.width, y: cy }, vertical: false };
}

/** Straight line where the boxes overlap in one axis, otherwise a Z through the middle of the gap. */
function autoRoute(s: ClassBox, t: ClassBox): Point[] {
  const ox0 = Math.max(s.x, t.x);
  const ox1 = Math.min(s.x + s.width, t.x + t.width);
  const oy0 = Math.max(s.y, t.y);
  const oy1 = Math.min(s.y + s.height, t.y + t.height);
  if (ox1 - ox0 >= 16 && (s.y + s.height <= t.y || t.y + t.height <= s.y)) {
    const x = round((ox0 + ox1) / 2);
    const [a, b] = s.y < t.y ? [s.y + s.height, t.y] : [s.y, t.y + t.height];
    return [{ x, y: a }, { x, y: b }];
  }
  if (oy1 - oy0 >= 16 && (s.x + s.width <= t.x || t.x + t.width <= s.x)) {
    const y = round((oy0 + oy1) / 2);
    const [a, b] = s.x < t.x ? [s.x + s.width, t.x] : [s.x, t.x + t.width];
    return [{ x: a, y }, { x: b, y }];
  }
  if (s.y + s.height <= t.y || t.y + t.height <= s.y) {
    const sx = round(s.x + s.width / 2);
    const tx = round(t.x + t.width / 2);
    const down = s.y < t.y;
    const a = down ? s.y + s.height : s.y;
    const b = down ? t.y : t.y + t.height;
    const m = round((a + b) / 2);
    return [{ x: sx, y: a }, { x: sx, y: m }, { x: tx, y: m }, { x: tx, y: b }];
  }
  const sy = round(s.y + s.height / 2);
  const ty = round(t.y + t.height / 2);
  const right = s.x < t.x;
  const a = right ? s.x + s.width : s.x;
  const b = right ? t.x : t.x + t.width;
  const m = round((a + b) / 2);
  return [{ x: a, y: sy }, { x: m, y: sy }, { x: m, y: ty }, { x: b, y: ty }];
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (prev && prev.x === p.x && prev.y === p.y) continue;
    out.push(p);
  }
  return out;
}


const SPOT_GAP = 44;
const SPOT_STEP = 10;

/** Free spot closest to (ix, iy): rings of growing radius, ties by smaller y then x. */
function freeSpot(c: ClassBox, ix: number, iy: number, obstacles: ClassBox[]): Point {
  const ok = (x: number, y: number) => !obstacles.some((o) => overlaps({ ...c, x, y }, o, SPOT_GAP));
  const sx = Math.round(ix / SPOT_STEP) * SPOT_STEP;
  const sy = Math.round(iy / SPOT_STEP) * SPOT_STEP;
  if (ok(ix, iy)) return { x: ix, y: iy };
  for (let r = SPOT_STEP; r < 20000; r += SPOT_STEP) {
    let best: Point | undefined;
    let bestD = Infinity;
    const tryAt = (x: number, y: number) => {
      const d = (x - ix) ** 2 + (y - iy) ** 2;
      if (d < bestD || (d === bestD && best && (y < best.y || (y === best.y && x < best.x)))) {
        if (ok(x, y)) { best = { x, y }; bestD = d; }
      }
    };
    for (let k = -r; k <= r; k += SPOT_STEP) {
      tryAt(sx + k, sy - r);
      tryAt(sx + k, sy + r);
      tryAt(sx - r, sy + k);
      tryAt(sx + r, sy + k);
    }
    if (best) return best;
  }
  return { x: ix, y: iy };
}

/** True when a segment of `points` passes through a class other than `a` and `b`. */
function crossesBox(points: Point[], boxes: ClassBox[], a: ClassBox, b: ClassBox): boolean {
  for (let i = 1; i < points.length; i++)
    for (const c of boxes) if (c !== a && c !== b && segHitsBox(points[i - 1]!, points[i]!, c)) return true;
  return false;
}

/** Candidate top-left corners for a label next to the relation, best first; a ring search around the anchor comes last. */
function labelCandidates(points: Point[], l: RelationLabel): Point[] {
  const out = nearCandidates(points, l);
  const anchor = anchorOf(points, l);
  for (let r = 8; r <= 200; r += 8)
    for (let k = -r; k <= r; k += 8) {
      out.push({ x: anchor.x + k, y: anchor.y - r }, { x: anchor.x + k, y: anchor.y + r });
      if (Math.abs(k) !== r) out.push({ x: anchor.x - r, y: anchor.y + k }, { x: anchor.x + r, y: anchor.y + k });
    }
  return out;
}

/** The point a label belongs to: the end of the route for end labels, the middle of the longest segment otherwise. */
function anchorOf(points: Point[], l: RelationLabel): Point {
  const n = points.length;
  if (n < 2) return { x: l.x, y: l.y };
  if (l.kind === "source-end") return points[0]!;
  if (l.kind === "target-end") return points[n - 1]!;
  let best = 0;
  let bestLen = -1;
  for (let i = 1; i < n; i++) {
    const len = Math.abs(points[i]!.x - points[i - 1]!.x) + Math.abs(points[i]!.y - points[i - 1]!.y);
    if (len > bestLen) { best = i; bestLen = len; }
  }
  return { x: (points[best]!.x + points[best - 1]!.x) / 2 - l.width / 2, y: (points[best]!.y + points[best - 1]!.y) / 2 - l.height / 2 };
}

function nearCandidates(points: Point[], l: RelationLabel): Point[] {
  const out: Point[] = [];
  const n = points.length;
  if (n < 2) return [{ x: l.x, y: l.y }];
  if (l.kind === "source-end" || l.kind === "target-end") {
    const src = l.kind === "source-end";
    const p = src ? points[0]! : points[n - 1]!;
    const q = src ? points[1]! : points[n - 2]!;
    const dx = Math.sign(q.x - p.x);
    const dy = Math.sign(q.y - p.y);
    const L = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    for (const off of [4, 28, 52, 76, 100, 124]) {
      for (const t of [4, 20, 36, 52, 68, 84, 100, 116]) {
        if (t > Math.max(L, 4)) break;
        if (p.x === q.x) {
          const y = dy > 0 ? p.y + t : p.y - t - l.height;
          out.push({ x: p.x + off, y }, { x: p.x - off - l.width, y });
        } else {
          const x = dx > 0 ? p.x + t : p.x - t - l.width;
          out.push({ x, y: p.y - off - l.height }, { x, y: p.y + off });
        }
      }
    }
    return out;
  }
  const segs = points
    .slice(1)
    .map((q, i) => ({ a: points[i]!, b: q, len: Math.abs(q.x - points[i]!.x) + Math.abs(q.y - points[i]!.y), i }))
    .sort((u, v) => v.len - u.len || u.i - v.i);
  for (const s of segs) {
    const mx = (s.a.x + s.b.x) / 2;
    const my = (s.a.y + s.b.y) / 2;
    for (const off of [2, 26, 50, 74, 98, 122, 146]) {
      for (const f of [0, -0.25, 0.25, -0.5, 0.5]) {
        if (s.a.x === s.b.x) {
          const y = my - l.height / 2 + f * s.len;
          out.push({ x: mx + off, y }, { x: mx - off - l.width, y });
        } else {
          const x = mx - l.width / 2 + f * s.len;
          out.push({ x, y: my - l.height - off }, { x, y: my + off });
        }
      }
    }
  }
  return out;
}

type Seg = [Point, Point];

/**
 * Last step of every layout: moves each label that sits on a class, on a line of any relation
 * or on another label to the first free candidate spot next to its own relation. Labels that
 * are fine stay where they are. Pure.
 */
function settleLabels(layout: DiagramGeometry): DiagramGeometry {
  const { classes, relations } = layout;
  const segs: Seg[] = relations.flatMap((e) => e.points.slice(1).map((p, i): Seg => [e.points[i]!, p]));
  const onLine = (l: RelationLabel) => segs.some(([a, b]) => segHitsBox(a, b, l));
  const onClass = (l: RelationLabel) => classes.some((c) => rectsOverlap(l, c));
  const hard = (l: RelationLabel) => !onClass(l) && !onLine(l);

  const taken: RelationLabel[] = [];
  const kept = relations.map((e) => e.labels.map((l) => hard(l) && !taken.some((t) => rectsOverlap(l, t)) && (taken.push(l), true)));
  const out = relations.map((e, i) => {
    let changed = false;
    const labels = e.labels.map((l, j) => {
      if (kept[i]![j]) return l;
      const cands = labelCandidates(e.points, l).map((p) => ({ ...l, x: round(p.x), y: round(p.y) }));
      const best =
        cands.find((c) => hard(c) && !taken.some((t) => rectsOverlap(c, t))) ??
        cands.find(hard) ??
        cands.find((c) => !onClass(c)) ??
        l;
      taken.push(best);
      changed = true;
      return best;
    });
    return changed ? { ...e, labels } : e;
  });
  return { ...layout, relations: out };
}

/** First candidate that clears every class and the labels already placed; else one that clears the classes. */
function placeLabel(points: Point[], l: RelationLabel, boxes: ClassBox[], taken: RelationLabel[]): RelationLabel {
  const cands = labelCandidates(points, l).map((p) => ({ ...l, x: round(p.x), y: round(p.y) }));
  const clear = (c: RelationLabel) => !boxes.some((b) => rectsOverlap(c, b));
  return (
    cands.find((c) => clear(c) && !taken.some((t) => rectsOverlap(c, t))) ??
    cands.find(clear) ??
    cands[0] ??
    l
  );
}
