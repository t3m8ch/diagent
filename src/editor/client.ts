/**
 * Browser side of `diagent edit`. Runs the same layout and drawing code as `render`
 * (`layoutDiagram`, `applyPins`, `drawSvg`); the server only holds the file.
 * Bundled with esbuild into `client.js` (`pnpm build`).
 */
import { bendAt, edgeAt, insertIndex, type Bend } from "../bends.js";
import { drawSvg, type Theme } from "../draw.js";
import { History, inverseOf } from "../history.js";
import { applyPins, layoutDiagram, parsePins, type ClassBox, type DiagramLayout, type Pins } from "../layout.js";
import { parseModel, type Model } from "../model.js";
import type { LayoutAction } from "../save.js";

const GRID = 10;

interface Diagnostic {
  severity: string;
  path: string;
  line: number;
  column: number;
  message: string;
}
interface FileState {
  text: string;
  ok: boolean;
  diagnostics: Diagnostic[];
  name?: string;
}

const $ = (id: string) => document.getElementById(id)!;
const stage = $("stage");
const errorsBox = $("errors");
const statusBox = $("status");

const history = new History();
let text = "";
let model: Model | undefined;
let auto: DiagramLayout | undefined; // autolayout without pins
let pins: Pins = {};
let shown: DiagramLayout | undefined; // what is on screen now
let drag: { name: string; dx: number; dy: number; box: ClassBox; moved: boolean } | undefined;
/** Edge whose bends are shown and editable (relation key). */
let selected: string | undefined;
/** Bends of `selected` while one is being dragged or created (not saved yet). */
let draftBends: Bend[] | undefined;
const bendsOf = (key: string): Bend[] => (key === selected && draftBends ? draftBends : pins.relations?.[key]?.bends ?? []);

const theme = (): Theme => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function status(s: string) {
  statusBox.textContent = s;
}

function draw(layout: DiagramLayout) {
  shown = layout;
  stage.innerHTML = drawSvg(layout, theme());
  const svg = stage.querySelector("svg")!;
  const ns = "http://www.w3.org/2000/svg";
  const current = drag ? { ...pins.classes, [drag.name]: { x: 0, y: 0 } } : pins.classes ?? {};
  for (const c of layout.classes) {
    if (!current[c.name]) continue;
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", String(c.x + c.width - 6));
    dot.setAttribute("cy", String(c.y + 6));
    dot.setAttribute("r", "3.5");
    dot.setAttribute("fill", "#1a73e8");
    svg.appendChild(dot);
  }
  const edge = selected ? layout.edges.find((e) => e.key === selected) : undefined;
  if (edge) {
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", edge.points.map((p) => `${p.x},${p.y}`).join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#1a73e8");
    line.setAttribute("stroke-width", "3");
    line.setAttribute("opacity", "0.45");
    line.setAttribute("pointer-events", "none");
    svg.appendChild(line);
    for (const [x, y] of bendsOf(edge.key)) {
      const h = document.createElementNS(ns, "rect");
      h.setAttribute("x", String(x - 4));
      h.setAttribute("y", String(y - 4));
      h.setAttribute("width", "8");
      h.setAttribute("height", "8");
      h.setAttribute("fill", "#fff");
      h.setAttribute("stroke", "#1a73e8");
      h.setAttribute("stroke-width", "2");
      svg.appendChild(h);
    }
  }
  const resetBtn = $("reset-bends") as HTMLButtonElement;
  resetBtn.disabled = !(selected && (pins.relations?.[selected]?.bends?.length ?? 0) > 0);
  ($("pin-all") as HTMLButtonElement).disabled = !model || layout.classes.every((c) => pins.classes?.[c.name]?.x === c.x && pins.classes[c.name]?.y === c.y);
  ($("unpin-all") as HTMLButtonElement).disabled = Object.keys(pins.classes ?? {}).length === 0;
}

/** Applies a fresh file state: redraws when valid, otherwise shows the errors over the last valid picture. */
async function setState(state: FileState) {
  if (state.name) $("file").textContent = state.name;
  const messages = state.diagnostics.filter((d) => d.severity === "error");
  if (!state.ok) {
    errorsBox.style.display = "block";
    errorsBox.textContent = messages.map((d) => `${d.line}:${d.column} ${d.path ? d.path + ": " : ""}${d.message}`).join("\n");
    stage.classList.add("invalid");
    status("file is invalid, showing the last valid diagram");
    return;
  }
  errorsBox.style.display = "none";
  stage.classList.remove("invalid");
  if (state.text === text && shown) return;
  const mine = ++seq;
  const parsed = parseModel(state.text);
  const newAuto = await layoutDiagram(parsed.model);
  if (mine !== seq) return;
  text = state.text;
  model = parsed.model;
  auto = newAuto;
  pins = parsePins(parsed.layout, model);
  draw(applyPins(auto, model, pins));
  status("saved");
}

let seq = 0;
let queue: Promise<unknown> = Promise.resolve();

/** The generic action -> save pipeline: every user action (and undo/redo) goes through here. */
function send(actions: LayoutAction[]): Promise<void> {
  status("saving…");
  const job = queue.then(async () => {
    const r = await fetch("/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actions }),
    });
    const state = (await r.json()) as FileState;
    if (r.ok) await setState(state);
    else status("not saved: " + ((state as any).error ?? r.status));
  });
  queue = job.catch(() => status("not saved: server unreachable"));
  return job.catch(() => undefined);
}

/** A user action: records undo information, then saves. */
function perform(actions: LayoutAction[]) {
  history.push({ redo: actions, undo: inverseOf(actions, pins) });
  return send(actions);
}

// ---- pointer handling ------------------------------------------------------
function toDiagram(e: { clientX: number; clientY: number }) {
  const svg = stage.querySelector("svg")!;
  const p = svg.createSVGPoint();
  p.x = e.clientX;
  p.y = e.clientY;
  const q = p.matrixTransform(svg.getScreenCTM()!.inverse());
  return { x: q.x, y: q.y };
}

function classAt(e: { clientX: number; clientY: number }): ClassBox | undefined {
  if (!shown || !stage.querySelector("svg")) return undefined;
  const { x, y } = toDiagram(e);
  return [...shown.classes].reverse().find((c) => x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height);
}

const snap = (v: number) => Math.round(v / GRID) * GRID;

stage.addEventListener("pointermove", (e) => {
  if (!drag) stage.style.cursor = classAt(e) ? "grab" : "";
});

stage.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !model || !auto) return;
  const box = classAt(e);
  if (!box) {
    startBendInteraction(e);
    return;
  }
  e.preventDefault();
  const start = toDiagram(e);
  drag = { name: box.name, dx: 0, dy: 0, box, moved: false };
  let frame = 0;
  const onMove = (m: PointerEvent) => {
    const p = toDiagram(m);
    drag!.dx = p.x - start.x;
    drag!.dy = p.y - start.y;
    drag!.moved = drag!.moved || Math.hypot(drag!.dx, drag!.dy) > 3;
    if (!drag!.moved || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!drag) return;
      draw(applyPins(auto!, model!, draftPins()));
    });
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    cancelAnimationFrame(frame);
    const d = drag!;
    drag = undefined;
    stage.style.cursor = "";
    const target = draftPinsFor(d);
    const old = pins.classes?.[d.name];
    if (!d.moved || (old && old.x === target.x && old.y === target.y)) {
      draw(applyPins(auto!, model!, pins));
      return;
    }
    perform([{ type: "pinClass", name: d.name, x: target.x, y: target.y }]);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
});

/** Pointer down outside any class: grab a bend handle, or press on an edge (select it / add a bend), or deselect. */
function startBendInteraction(e: PointerEvent) {
  if (!shown) return;
  const start = toDiagram(e);
  const edge = selected ? shown.edges.find((x) => x.key === selected) : undefined;
  const handle = edge ? bendAt(bendsOf(edge.key), start) : -1;
  const hit = handle >= 0 ? edge : edgeAt(shown.edges, start);
  if (!hit) {
    if (selected) {
      selected = undefined;
      draw(shown);
    }
    return;
  }
  e.preventDefault();
  if (hit.key !== selected) {
    selected = hit.key;
    draw(applyPins(auto!, model!, pins));
    return; // first click only selects
  }
  const before = bendsOf(hit.key).map((b) => [...b] as Bend);
  let index = handle;
  const isNew = handle < 0;
  let moved = false;
  const place = (p: { x: number; y: number }) => {
    const pt: Bend = [snap(p.x), snap(p.y)];
    if (index < 0) {
      index = insertIndex(hit, before, p);
      draftBends = [...before.slice(0, index), pt, ...before.slice(index)];
    } else {
      draftBends = before.map((b, i) => (i === index ? pt : b));
    }
  };
  let frame = 0;
  const onMove = (m: PointerEvent) => {
    const p = toDiagram(m);
    moved = moved || Math.hypot(p.x - start.x, p.y - start.y) > 3;
    if (!moved || frame) return;
    place(p);
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw(applyPins(auto!, model!, draftRelationPins(hit.key)));
    });
  };
  const onUp = (u: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    cancelAnimationFrame(frame);
    const p = toDiagram(u);
    if (moved || isNew) place(moved ? p : start); // a plain click on the edge adds a bend there
    const next = draftBends;
    draftBends = undefined;
    if (!next || (!isNew && !moved) || JSON.stringify(next) === JSON.stringify(before)) {
      draw(applyPins(auto!, model!, pins));
      return;
    }
    perform([{ type: "setBends", key: hit.key, bends: next }]);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function draftRelationPins(key: string): Pins {
  return { ...pins, relations: { ...pins.relations, [key]: { bends: draftBends ?? [] } } };
}

function draftPinsFor(d: NonNullable<typeof drag>) {
  return { x: snap(d.box.x + d.dx), y: snap(d.box.y + d.dy) };
}
function draftPins(): Pins {
  return { ...pins, classes: { ...pins.classes, [drag!.name]: draftPinsFor(drag!) } };
}

stage.addEventListener("dblclick", (e) => {
  const box = classAt(e);
  if (!box && selected && shown) {
    const bends = bendsOf(selected);
    const i = bendAt(bends, toDiagram(e));
    if (i >= 0) perform([{ type: "setBends", key: selected, bends: bends.filter((_, j) => j !== i) }]);
    return;
  }
  if (box && pins.classes?.[box.name]) perform([{ type: "unpinClass", name: box.name }]);
});

/** Toolbar actions. */
$("reset-bends").addEventListener("click", () => {
  if (selected && pins.relations?.[selected]?.bends?.length) perform([{ type: "setBends", key: selected, bends: null }]);
});
$("pin-all").addEventListener("click", () => {
  if (!shown) return;
  perform([{ type: "pinAll", classes: Object.fromEntries(shown.classes.map((c) => [c.name, { x: c.x, y: c.y }])) }]);
});
$("unpin-all").addEventListener("click", () => perform([{ type: "unpinAll" }]));

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selected && shown) {
    selected = undefined;
    draw(shown);
    return;
  }
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  let actions: LayoutAction[] | undefined;
  if (key === "z" && !e.shiftKey) actions = history.undo();
  else if ((key === "z" && e.shiftKey) || key === "y") actions = history.redo();
  else return;
  e.preventDefault();
  if (actions) send(actions);
});

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (shown) draw(shown);
});

// ---- live file ---------------------------------------------------------------
const events = new EventSource("/api/events");
events.addEventListener("file", (e) => {
  void setState(JSON.parse((e as MessageEvent).data) as FileState);
});
events.onerror = () => status("disconnected, retrying…");
fetch("/api/file")
  .then((r) => r.json())
  .then((s: FileState) => setState(s));
