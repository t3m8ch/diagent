/**
 * Browser side of `diagent edit`. Runs the same layout and drawing code as `render`
 * (`layoutDiagram`, `applyFileLayout`, `drawSvg`); the server only holds the file.
 * Bundled with esbuild into `client.js` (`pnpm build`).
 */
import * as cam from "./camera.js";
import { bendAt, relationAt, insertIndex, type Bend } from "../bends.js";
import { drawSvg, type Theme } from "../draw.js";
import { History } from "../history.js";
import { applyFileLayout, layoutDiagram, parseFileLayout, type ClassBox, type DiagramGeometry, type FileLayout } from "../layout.js";
import { parseModel, type Model } from "../model.js";
import { inverseOf, type LayoutAction } from "../save.js";

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

const history = new History<LayoutAction>();
let text = "";
let model: Model | undefined;
let auto: DiagramGeometry | undefined; // autolayout without fileLayout
let fileLayout: FileLayout = {};
let shown: DiagramGeometry | undefined; // what is on screen now
let drag: { name: string; dx: number; dy: number; box: ClassBox; moved: boolean } | undefined;
/** Relation whose bends are shown and editable (relation key). */
let selected: string | undefined;
/** Bends of `selected` while one is being dragged or created (not saved yet). */
let draftBends: Bend[] | undefined;
const bendsOf = (key: string): Bend[] => (key === selected && draftBends ? draftBends : fileLayout.relations?.[key]?.bends ?? []);

/** Camera (da-9): only the svg's viewBox follows it; undefined until the first diagram is drawn and fitted. */
let camera: cam.Camera | undefined;
const view = (): cam.Size => ({ width: stage.clientWidth, height: stage.clientHeight });
/** Size of one screen pixel in diagram units: handles, dots and hit tolerances stay the same on screen at any zoom. */
const px = () => 1 / (camera?.scale ?? 1);
const DRAG_PX = 3;

function applyCamera() {
  const svg = stage.querySelector("svg");
  if (!svg || !camera) return;
  const v = view();
  svg.setAttribute("viewBox", cam.viewBox(camera, v));
  svg.setAttribute("width", String(v.width));
  svg.setAttribute("height", String(v.height));
  $("zoom").textContent = `${Math.round(camera.scale * 100)}%`;
}

/** Applies the camera after a pan; after a zoom the overlays are redrawn too (one frame at most), without re-layout. */
let cameraFrame = 0;
function setCamera(next: cam.Camera, redraw: boolean) {
  camera = next;
  applyCamera();
  if (!redraw || cameraFrame) return;
  cameraFrame = requestAnimationFrame(() => {
    cameraFrame = 0;
    if (shown) draw(shown);
  });
}

const boundsOf = (l: DiagramGeometry) => ({ x: l.originX ?? 0, y: l.originY ?? 0, width: l.width, height: l.height });

function fitDiagram() {
  if (shown) setCamera(cam.fit(boundsOf(shown), view()), true);
}

const theme = (): Theme => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function status(s: string) {
  statusBox.textContent = s;
}

function draw(layout: DiagramGeometry) {
  shown = layout;
  stage.innerHTML = drawSvg(layout, theme());
  const svg = stage.querySelector("svg")!;
  camera ??= cam.fit(boundsOf(layout), view());
  applyCamera();
  const u = px();
  const ns = "http://www.w3.org/2000/svg";
  const current = drag ? { ...fileLayout.classes, [drag.name]: { x: 0, y: 0 } } : fileLayout.classes ?? {};
  for (const c of layout.classes) {
    if (!current[c.name]) continue;
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", String(c.x + c.width - 6 * u));
    dot.setAttribute("cy", String(c.y + 6 * u));
    dot.setAttribute("r", String(3.5 * u));
    dot.setAttribute("fill", "#1a73e8");
    svg.appendChild(dot);
  }
  const relation = selected ? layout.relations.find((e) => e.key === selected) : undefined;
  if (relation) {
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", relation.points.map((p) => `${p.x},${p.y}`).join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#1a73e8");
    line.setAttribute("stroke-width", String(3 * u));
    line.setAttribute("opacity", "0.45");
    line.setAttribute("pointer-events", "none");
    svg.appendChild(line);
    for (const [x, y] of bendsOf(relation.key)) {
      const h = document.createElementNS(ns, "rect");
      h.setAttribute("x", String(x - 4 * u));
      h.setAttribute("y", String(y - 4 * u));
      h.setAttribute("width", String(8 * u));
      h.setAttribute("height", String(8 * u));
      h.setAttribute("fill", "#fff");
      h.setAttribute("stroke", "#1a73e8");
      h.setAttribute("stroke-width", String(2 * u));
      svg.appendChild(h);
    }
  }
  const resetBtn = $("reset-bends") as HTMLButtonElement;
  resetBtn.disabled = !(selected && (fileLayout.relations?.[selected]?.bends?.length ?? 0) > 0);
  ($("pin-all") as HTMLButtonElement).disabled = !model || layout.classes.every((c) => fileLayout.classes?.[c.name]?.x === c.x && fileLayout.classes[c.name]?.y === c.y);
  ($("unpin-all") as HTMLButtonElement).disabled = Object.keys(fileLayout.classes ?? {}).length === 0;
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
  fileLayout = parseFileLayout(parsed.layout, model);
  draw(applyFileLayout(auto, model, fileLayout));
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
  history.push({ redo: actions, undo: inverseOf(actions, fileLayout) });
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

let spaceDown = false;

/** Drags the scene with the pointer; `onClick` runs instead when the pointer did not move past the threshold. */
function startPan(e: PointerEvent, onClick?: () => void) {
  let last = { x: e.clientX, y: e.clientY };
  const from = last;
  let moved = false;
  stage.style.cursor = "grabbing";
  const onMove = (m: PointerEvent) => {
    moved = moved || Math.hypot(m.clientX - from.x, m.clientY - from.y) > DRAG_PX;
    if (moved && camera) setCamera(cam.panBy(camera, m.clientX - last.x, m.clientY - last.y), false);
    last = { x: m.clientX, y: m.clientY };
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    stage.style.cursor = spaceDown ? "grab" : "";
    if (!moved) onClick?.();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

stage.addEventListener("pointermove", (e) => {
  if (!drag) stage.style.cursor = spaceDown || classAt(e) ? "grab" : "";
});

stage.addEventListener("pointerdown", (e) => {
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    e.preventDefault();
    startPan(e);
    return;
  }
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
    drag!.moved = drag!.moved || Math.hypot(drag!.dx, drag!.dy) * camera!.scale > DRAG_PX;
    if (!drag!.moved || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!drag) return;
      draw(applyFileLayout(auto!, model!, draftPins()));
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
    const old = fileLayout.classes?.[d.name];
    if (!d.moved || (old && old.x === target.x && old.y === target.y)) {
      draw(applyFileLayout(auto!, model!, fileLayout));
      return;
    }
    perform([{ type: "pinClass", name: d.name, x: target.x, y: target.y }]);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
});

/** Pointer down outside any class: grab a bend handle, or press on an relation (select it / add a bend), or deselect. */
function startBendInteraction(e: PointerEvent) {
  if (!shown) return;
  const start = toDiagram(e);
  const relation = selected ? shown.relations.find((x) => x.key === selected) : undefined;
  const handle = relation ? bendAt(bendsOf(relation.key), start, 7 * px()) : -1;
  const hit = handle >= 0 ? relation : relationAt(shown.relations, start, 6 * px());
  if (!hit) {
    // Empty space: a drag pans the scene, a plain click deselects the relation.
    e.preventDefault();
    startPan(e, () => {
      if (selected && shown) {
        selected = undefined;
        draw(shown);
      }
    });
    return;
  }
  e.preventDefault();
  if (hit.key !== selected) {
    selected = hit.key;
    draw(applyFileLayout(auto!, model!, fileLayout));
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
    moved = moved || Math.hypot(p.x - start.x, p.y - start.y) * camera!.scale > DRAG_PX;
    if (!moved || frame) return;
    place(p);
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw(applyFileLayout(auto!, model!, draftRelationPins(hit.key)));
    });
  };
  const onUp = (u: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    cancelAnimationFrame(frame);
    const p = toDiagram(u);
    if (moved || isNew) place(moved ? p : start); // a plain click on the relation adds a bend there
    const next = draftBends;
    draftBends = undefined;
    if (!next || (!isNew && !moved) || JSON.stringify(next) === JSON.stringify(before)) {
      draw(applyFileLayout(auto!, model!, fileLayout));
      return;
    }
    perform([{ type: "setBends", key: hit.key, bends: next }]);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function draftRelationPins(key: string): FileLayout {
  return { ...fileLayout, relations: { ...fileLayout.relations, [key]: { bends: draftBends ?? [] } } };
}

function draftPinsFor(d: NonNullable<typeof drag>) {
  return { x: snap(d.box.x + d.dx), y: snap(d.box.y + d.dy) };
}
function draftPins(): FileLayout {
  return { ...fileLayout, classes: { ...fileLayout.classes, [drag!.name]: draftPinsFor(drag!) } };
}

stage.addEventListener("dblclick", (e) => {
  const box = classAt(e);
  if (!box && selected && shown) {
    const bends = bendsOf(selected);
    const i = bendAt(bends, toDiagram(e), 7 * px());
    if (i >= 0) perform([{ type: "setBends", key: selected, bends: bends.filter((_, j) => j !== i) }]);
    return;
  }
  if (box && fileLayout.classes?.[box.name]) perform([{ type: "unpinClass", name: box.name }]);
});

/** Toolbar actions. */
$("reset-bends").addEventListener("click", () => {
  if (selected && fileLayout.relations?.[selected]?.bends?.length) perform([{ type: "setBends", key: selected, bends: null }]);
});
$("pin-all").addEventListener("click", () => {
  if (!shown) return;
  perform([{ type: "pinAll", classes: Object.fromEntries(shown.classes.map((c) => [c.name, { x: c.x, y: c.y }])) }]);
});
$("unpin-all").addEventListener("click", () => perform([{ type: "unpinAll" }]));

stage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (!camera) return;
    const rect = stage.getBoundingClientRect();
    const dy = cam.wheelPixels(e.deltaY, e.deltaMode, stage.clientHeight);
    const dx = cam.wheelPixels(e.deltaX, e.deltaMode, stage.clientWidth);
    if (e.ctrlKey || e.metaKey) setCamera(cam.zoomAt(camera, cam.wheelZoomFactor(dy), e.clientX - rect.left, e.clientY - rect.top), true);
    else if (e.shiftKey && dx === 0) setCamera(cam.panBy(camera, -dy, 0), false); // Shift + wheel scrolls sideways
    else setCamera(cam.panBy(camera, -dx, -dy), false);
  },
  { passive: false },
);

const zoomCentre = (factor: number) => {
  if (!camera) return;
  const v = view();
  setCamera(cam.zoomAt(camera, factor, v.width / 2, v.height / 2), true);
};
$("fit").addEventListener("click", fitDiagram);
$("zoom100").addEventListener("click", () => camera && setCamera(cam.zoomTo(camera, 1, view()), true));
new ResizeObserver(() => applyCamera()).observe(stage);

window.addEventListener("keyup", (e) => {
  if (e.code !== "Space") return;
  spaceDown = false;
  stage.style.cursor = "";
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault(); // also keeps a focused toolbar button from firing
    spaceDown = true;
    stage.style.cursor = "grab";
    return;
  }
  if (e.key === "Escape" && selected && shown) {
    selected = undefined;
    draw(shown);
    return;
  }
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === "Digit1") {
    e.preventDefault();
    fitDiagram();
    return;
  }
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === "0") {
    e.preventDefault();
    if (camera) setCamera(cam.zoomTo(camera, 1, view()), true);
    return;
  }
  if (key === "=" || key === "+" || key === "-") {
    e.preventDefault();
    zoomCentre(key === "-" ? 1 / cam.ZOOM_STEP : cam.ZOOM_STEP);
    return;
  }
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
