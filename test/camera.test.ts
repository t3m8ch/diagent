import { describe, expect, it } from "vitest";
import { MAX_SCALE, MIN_SCALE, fit, panBy, toDiagram, toScreen, viewBox, wheelPixels, wheelZoomFactor, zoomAt, zoomTo } from "../src/editor/camera.js";

const view = { width: 800, height: 600 };

describe("camera (da-9)", () => {
  it("zoom keeps the diagram point under the cursor in place", () => {
    const c = { x: -50, y: 20, scale: 0.8 };
    const before = toDiagram(c, 300, 200);
    const z = zoomAt(c, 1.7, 300, 200);
    expect(z.scale).toBeCloseTo(1.36);
    const after = toDiagram(z, 300, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("zoom stops at 10 % and 400 % and keeps the point fixed at the limit", () => {
    let c = { x: 0, y: 0, scale: 1 };
    c = zoomAt(c, 1000, 100, 100);
    expect(c.scale).toBe(MAX_SCALE);
    expect(toDiagram(c, 100, 100).x).toBeCloseTo(100);
    c = zoomAt(c, 1e-6, 100, 100);
    expect(c.scale).toBe(MIN_SCALE);
    expect(zoomTo(c, 50, view).scale).toBe(MAX_SCALE);
  });

  it("fit centres the diagram with padding and does not zoom in past 100 %", () => {
    const big = fit({ x: 0, y: 0, width: 2000, height: 1000 }, view, 40);
    expect(big.scale).toBeCloseTo(720 / 2000);
    const tl = toScreen(big, 0, 0);
    const br = toScreen(big, 2000, 1000);
    expect(tl.x).toBeCloseTo(view.width - br.x);
    expect(tl.y).toBeCloseTo(view.height - br.y);
    expect(tl.x).toBeGreaterThanOrEqual(40 - 1e-9);
    const small = fit({ x: -100, y: -50, width: 100, height: 100 }, view);
    expect(small.scale).toBe(1);
    expect(toScreen(small, -50, 0)).toEqual({ x: 400, y: 300 });
  });

  it("fit never goes below the minimum scale", () => {
    expect(fit({ x: 0, y: 0, width: 1e6, height: 1e6 }, view).scale).toBe(MIN_SCALE);
  });

  it("converts screen and diagram coordinates both ways", () => {
    const c = { x: 100, y: -40, scale: 2 };
    expect(toDiagram(c, 50, 30)).toEqual({ x: 125, y: -25 });
    expect(toScreen(c, 125, -25)).toEqual({ x: 50, y: 30 });
  });

  it("panBy moves the picture with the finger", () => {
    const c = panBy({ x: 0, y: 0, scale: 2 }, 20, -10);
    expect(c).toEqual({ x: -10, y: 5, scale: 2 });
    expect(toScreen(c, 0, 0)).toEqual({ x: 20, y: -10 });
  });

  it("viewBox covers exactly the canvas", () => {
    expect(viewBox({ x: 10, y: 20, scale: 2 }, view)).toBe("10 20 400 300");
  });

  it("normalises wheel deltas by deltaMode and signs the zoom factor", () => {
    expect(wheelPixels(3, 0, 600)).toBe(3);
    expect(wheelPixels(3, 1, 600)).toBe(48);
    expect(wheelPixels(1, 2, 600)).toBe(600);
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10)).toBeLessThan(1);
    expect(wheelZoomFactor(-10) * wheelZoomFactor(10)).toBeCloseTo(1);
  });
});
