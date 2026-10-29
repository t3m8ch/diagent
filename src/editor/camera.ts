/**
 * Camera of the layout editor (da-9). Pure, browser-safe.
 *
 * `x`, `y` is the diagram point shown in the top-left corner of the canvas and `scale` is
 * screen pixels per diagram unit. Screen coordinates are relative to the canvas.
 */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Size {
  x: number;
  y: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
/** One step of Ctrl+= / Ctrl+-. */
export const ZOOM_STEP = 1.25;

export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Canvas point -> diagram point. */
export const toDiagram = (c: Camera, sx: number, sy: number) => ({ x: c.x + sx / c.scale, y: c.y + sy / c.scale });
/** Diagram point -> canvas point. */
export const toScreen = (c: Camera, x: number, y: number) => ({ x: (x - c.x) * c.scale, y: (y - c.y) * c.scale });

/** Zooms by `factor` (clamped to the limits) keeping the diagram point under (sx, sy) where it is. */
export function zoomAt(c: Camera, factor: number, sx: number, sy: number): Camera {
  const scale = clampScale(c.scale * factor);
  const p = toDiagram(c, sx, sy);
  return { x: p.x - sx / scale, y: p.y - sy / scale, scale };
}

/** Moves the scene by a screen delta: the picture follows the finger. */
export const panBy = (c: Camera, dx: number, dy: number): Camera => ({ ...c, x: c.x - dx / c.scale, y: c.y - dy / c.scale });

/** Fits `bounds` into the canvas with `padding` screen pixels around it; never zooms in past 100 %. */
export function fit(bounds: Rect, view: Size, padding = 40): Camera {
  const w = Math.max(1, view.width - 2 * padding);
  const h = Math.max(1, view.height - 2 * padding);
  const scale = clampScale(Math.min(1, w / Math.max(1, bounds.width), h / Math.max(1, bounds.height)));
  return {
    scale,
    x: bounds.x + bounds.width / 2 - view.width / 2 / scale,
    y: bounds.y + bounds.height / 2 - view.height / 2 / scale,
  };
}

/** Sets the scale (clamped) around the canvas centre. */
export function zoomTo(c: Camera, scale: number, view: Size): Camera {
  return zoomAt(c, clampScale(scale) / c.scale, view.width / 2, view.height / 2);
}

/** The SVG `viewBox` that shows exactly the canvas. */
export const viewBox = (c: Camera, view: Size) => `${c.x} ${c.y} ${view.width / c.scale} ${view.height / c.scale}`;

/** Wheel delta in pixels whatever the `deltaMode` (0 pixels, 1 lines, 2 pages). */
export function wheelPixels(delta: number, deltaMode: number, page: number): number {
  return deltaMode === 1 ? delta * 16 : deltaMode === 2 ? delta * page : delta;
}

/** Zoom factor of one wheel / pinch event with the given pixel delta (up = zoom in). */
export const wheelZoomFactor = (deltaY: number) => Math.exp(-Math.max(-100, Math.min(100, deltaY)) * 0.0025);
