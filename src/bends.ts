/** Geometry of bend editing (da-7): hit-testing relations and bend handles, and where a new bend goes in the list. Pure, browser-safe. */
import type { RelationRoute, Point } from "./layout.js";

export type Bend = [number, number];

/** The route polyline in file order (first end -> second end), the order `bends` are stored in. */
export const filePoints = (e: RelationRoute): Point[] => (e.reversed ? [...e.points].reverse() : e.points);

/** Nearest point of the segment a-b to p, with its distance to p and the fraction along a-b. */
function nearestOnSegment(a: Point, b: Point, p: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, dist: Math.hypot(p.x - q.x, p.y - q.y) };
}

/** Distance along the polyline (arc length) of the point closest to p, and how far p is from the line. */
function project(points: Point[], p: Point): { at: number; dist: number } {
  let best = { at: 0, dist: Infinity };
  let walked = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = nearestOnSegment(a, b, p);
    if (n.dist < best.dist) best = { at: walked + n.t * len, dist: n.dist };
    walked += len;
  }
  return best;
}

/** The relation closest to p within `tol` px, or undefined. Later (drawn on top) relations win ties. */
export function relationAt(relations: RelationRoute[], p: Point, tol = 6): RelationRoute | undefined {
  let best: RelationRoute | undefined;
  let bestDist = tol;
  for (const e of relations) {
    const d = project(e.points, p).dist;
    if (d <= bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

/** Index of the bend whose handle contains p, or -1. */
export function bendAt(bends: Bend[], p: Point, radius = 7): number {
  for (let i = bends.length - 1; i >= 0; i--) if (Math.hypot(bends[i]![0] - p.x, bends[i]![1] - p.y) <= radius) return i;
  return -1;
}

/**
 * Where a new bend at `p` goes in `bends` (file order): after every existing bend that lies
 * before p along the route, so the order of the points follows the line.
 */
export function insertIndex(relation: RelationRoute, bends: Bend[], p: Point): number {
  const pts = filePoints(relation);
  const at = project(pts, p).at;
  let i = 0;
  for (const b of bends) if (project(pts, { x: b[0], y: b[1] }).at <= at) i++;
  return i;
}
