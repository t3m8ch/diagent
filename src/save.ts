/**
 * The save pipeline of the editor: (file text, actions) -> new file text. Pure and browser-safe.
 * Only the top-level `layout` key is touched (via the `yaml` Document API, so comments and
 * formatting of the model survive); orphaned layout entries are dropped on every save.
 */
import { Document, isMap, parseDocument } from "yaml";
import { buildModel } from "./model.js";

/** What the editor can do to the layout. da-7 adds actions here (pin-all, unpin-all). */
export type LayoutAction =
  | { type: "pinClass"; name: string; x: number; y: number }
  | { type: "unpinClass"; name: string }
  /** FileLayout every listed class at the given position ("Pin all": the editor sends the current positions). */
  | { type: "pinAll"; classes: Record<string, { x: number; y: number }> }
  /** Clears the class layout; bends are kept. */
  | { type: "unpinAll" }
  /** `bends: null` removes the entry. */
  | { type: "setBends"; key: string; bends: [number, number][] | null };

function flow(doc: Document, value: unknown) {
  const node = doc.createNode(value) as { flow?: boolean };
  node.flow = true;
  return node;
}

function applyOne(doc: Document, a: LayoutAction, names: Set<string>, keys: Set<string>): void {
  if (a.type === "pinClass") {
    if (names.has(a.name)) doc.setIn(["layout", "classes", a.name], flow(doc, { x: a.x, y: a.y }));
  } else if (a.type === "unpinClass") {
    if (doc.hasIn(["layout", "classes"])) doc.deleteIn(["layout", "classes", a.name]);
  } else if (a.type === "pinAll") {
    for (const [name, p] of Object.entries(a.classes)) if (names.has(name)) doc.setIn(["layout", "classes", name], flow(doc, { x: p.x, y: p.y }));
  } else if (a.type === "unpinAll") {
    if (doc.hasIn(["layout", "classes"])) doc.deleteIn(["layout", "classes"]);
  } else if (a.bends === null || a.bends.length === 0) {
    if (doc.hasIn(["layout", "relations"])) doc.deleteIn(["layout", "relations", a.key]);
  } else if (keys.has(a.key)) {
    const node = doc.createNode({ bends: a.bends.map((b) => [...b]) }) as any;
    node.flow = true;
    for (const item of node.items[0].value.items) item.flow = true; // [x, y] pairs on one line
    doc.setIn(["layout", "relations", a.key], node);
  }
}

/** Drops orphaned and empty entries from `layout`, and the section itself when nothing is left. */
function tidy(doc: Document, names: Set<string>, keys: Set<string>): void {
  const layout = doc.get("layout", true);
  if (!isMap(layout)) return;
  for (const [section, valid] of [["classes", names], ["relations", keys]] as const) {
    const m = layout.get(section, true);
    if (!isMap(m)) continue;
    m.items = m.items.filter((p) => valid.has(String((p.key as any)?.value ?? p.key)));
    if (m.items.length === 0) layout.delete(section);
  }
  if (layout.items.length === 0) doc.delete("layout");
}

/** Byte range of the top-level `layout` entry in `text` (key start .. end of value, no trailing newline). */
function layoutRange(text: string): [number, number] | undefined {
  const doc = parseDocument(text);
  if (!isMap(doc.contents)) return undefined;
  const pair = doc.contents.items.find((p) => (p.key as any)?.value === "layout");
  if (!pair) return undefined;
  const start = (pair.key as any).range[0] as number;
  let end = ((pair.value as any)?.range?.[1] as number | undefined) ?? text.indexOf("\n", start);
  if (end < 0) end = text.length;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return [start, end];
}

/**
 * Applies the actions and returns the new file text. Everything outside the top-level
 * `layout` entry is kept byte for byte (the entry is spliced into the original text).
 */
export function applyActions(text: string, actions: LayoutAction[]): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error(doc.errors[0]!.message);
  const model = buildModel((doc.toJS() ?? {}) as Record<string, any>);
  const names = new Set(model.classes.map((c) => c.name));
  const keys = new Set(model.relations.map((r) => r.key));
  for (const a of actions) applyOne(doc, a, names, keys);
  tidy(doc, names, keys);

  const layout = doc.get("layout", true);
  const range = layoutRange(text);
  let out: string;
  if (layout === undefined || layout === null) {
    if (!range) return text;
    let end = range[1];
    if (text[end] === "\n") end++;
    out = text.slice(0, range[0]) + text.slice(end);
  } else {
    const wrapper = new Document({});
    wrapper.contents = wrapper.createNode({}) as any;
    (wrapper.contents as any).set("layout", layout);
    const piece = wrapper.toString({ lineWidth: 0 }).trimEnd();
    if (range) out = text.slice(0, range[0]) + piece + text.slice(range[1]);
    else out = text.trimEnd() + "\n" + piece + "\n";
  }
  return out === text ? text : out;
}
