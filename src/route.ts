/**
 * Orthogonal obstacle-avoiding edge router (da-4). Browser-safe, deterministic.
 *
 * Visibility grid: x and y lines come from the class boxes (edges, a small pad and a ring
 * around the two end classes), the ports on the end classes and the bends. A* runs over
 * (grid node, direction) with a bend penalty and a small penalty for reusing a segment that an
 * earlier edge already took. Ties are broken by insertion order, so the result is stable.
 */
import type { ClassBox, Point } from "./layout.js";

const RING = 20; // distance of the first/last bend from the end class (room for markers)
const PAD = 8; // clearance kept around other classes
const BEND = 40;
const REUSE = 8;
const DX = [0, 1, 0, -1]; // N E S W
const DY = [-1, 0, 1, 0];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when the axis-parallel segment a-b passes through the open interior of `c` grown by `pad`. */
export function segHitsBox(a: Point, b: Point, c: Rect, pad = 0): boolean {
  const x0 = c.x - pad, x1 = c.x + c.width + pad, y0 = c.y - pad, y1 = c.y + c.height + pad;
  if (a.y === b.y) return y0 < a.y && a.y < y1 && Math.min(a.x, b.x) < x1 && Math.max(a.x, b.x) > x0;
  if (a.x === b.x) return x0 < a.x && a.x < x1 && Math.min(a.y, b.y) < y1 && Math.max(a.y, b.y) > y0;
  return false;
}

/** Open-interior intersection of two rectangles. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

interface Start { node: Point; dir: number; cost: number; pre: Point[] }
interface Goal { node: Point; post: Point[]; inward: number; cost: number }

class Heap<T extends { f: number; seq: number }> {
  private a: T[] = [];
  get size() { return this.a.length; }
  private less(i: number, j: number) {
    const x = this.a[i]!, y = this.a[j]!;
    return x.f < y.f || (x.f === y.f && x.seq < y.seq);
  }
  push(v: T) {
    this.a.push(v);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [this.a[i], this.a[p]] = [this.a[p]!, this.a[i]!];
      i = p;
    }
  }
  pop(): T {
    const top = this.a[0]!;
    const last = this.a.pop()!;
    if (this.a.length > 0) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.a.length && this.less(l, m)) m = l;
        if (r < this.a.length && this.less(r, m)) m = r;
        if (m === i) break;
        [this.a[i], this.a[m]] = [this.a[m]!, this.a[i]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Route from `source` to `target` through `via` (bends, in route order) without crossing any
 * other class. Returns undefined when no route exists. Segments taken are added to `used`.
 */
export function routeAround(
  source: ClassBox,
  target: ClassBox,
  boxes: ClassBox[],
  via: Point[],
  used: Set<string>,
): Point[] | undefined {
  const ends = [source, target];
  const others = boxes.filter((b) => b !== source && b !== target);

  // ---- grid lines
  const xset = new Set<number>();
  const yset = new Set<number>();
  for (const b of boxes) {
    for (const v of [b.x - PAD, b.x, b.x + b.width, b.x + b.width + PAD]) xset.add(v);
    for (const v of [b.y - PAD, b.y, b.y + b.height, b.y + b.height + PAD]) yset.add(v);
  }
  const ports = (b: ClassBox) => {
    const px = [0.5, 0.25, 0.75].map((f) => Math.round(b.x + b.width * f));
    const py = [0.5, 0.25, 0.75].map((f) => Math.round(b.y + b.height * f));
    return { px, py };
  };
  for (const b of ends) {
    const { px, py } = ports(b);
    px.forEach((v) => xset.add(v));
    py.forEach((v) => yset.add(v));
    xset.add(b.x - RING); xset.add(b.x + b.width + RING);
    yset.add(b.y - RING); yset.add(b.y + b.height + RING);
  }
  for (const p of via) { xset.add(p.x); yset.add(p.y); }
  const xs = [...xset].sort((a, b) => a - b);
  const ys = [...yset].sort((a, b) => a - b);
  const xi = new Map(xs.map((v, i) => [v, i]));
  const yi = new Map(ys.map((v, i) => [v, i]));
  const W = xs.length, H = ys.length;
  const viaKeys = new Set(via.map((p) => `${p.x},${p.y}`));

  const nodeBlocked = (p: Point) => {
    if (viaKeys.has(`${p.x},${p.y}`)) return false;
    for (const b of ends) if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return true;
    for (const b of others)
      if (p.x > b.x - PAD && p.x < b.x + b.width + PAD && p.y > b.y - PAD && p.y < b.y + b.height + PAD) return true;
    return false;
  };
  const segBlocked = (a: Point, b: Point) => {
    for (const c of ends) if (segHitsBox(a, b, c, 0)) return true;
    for (const c of others) if (segHitsBox(a, b, c, PAD)) return true;
    return false;
  };
  const free = (a: Point, b: Point) => !nodeBlocked(b) && !segBlocked(a, b);

  // ---- A*
  const search = (starts: Start[], goals: Goal[]): Point[] | undefined => {
    const goalAt = new Map<string, Goal[]>();
    for (const g of goals) {
      const k = `${g.node.x},${g.node.y}`;
      goalAt.set(k, [...(goalAt.get(k) ?? []), g]);
    }
    const id = (x: number, y: number, d: number) => ((yi.get(y)! * W + xi.get(x)!) * 5 + d);
    const dist = new Float64Array(W * H * 5).fill(Infinity);
    const parent = new Int32Array(W * H * 5).fill(-1);
    const pre = new Map<number, Point[]>();
    type Item = { f: number; seq: number; state: number; g: number; goal?: Goal };
    const heap = new Heap<Item>();
    let seq = 0;
    const h = (p: Point) => Math.min(...goals.map((g) => Math.abs(g.node.x - p.x) + Math.abs(g.node.y - p.y)));
    for (const s of starts) {
      const st = id(s.node.x, s.node.y, s.dir);
      if (s.cost < dist[st]!) {
        dist[st] = s.cost;
        pre.set(st, s.pre);
        heap.push({ f: s.cost + h(s.node), seq: seq++, state: st, g: s.cost });
      }
    }
    const decode = (st: number) => {
      const d = st % 5;
      const n = (st - d) / 5;
      return { x: xs[n % W]!, y: ys[Math.floor(n / W)]!, d };
    };
    while (heap.size > 0) {
      const it = heap.pop();
      if (it.goal) {
        // reconstruct
        const out: Point[] = [...it.goal.post.slice().reverse()];
        let st = it.state;
        while (st !== -1) {
          const p = decode(st);
          out.push({ x: p.x, y: p.y });
          if (parent[st] === -1) {
            out.push(...pre.get(st)!.slice().reverse());
          }
          st = parent[st]!;
        }
        return out.reverse();
      }
      if (it.g > dist[it.state]!) continue;
      const cur = decode(it.state);
      const here = { x: cur.x, y: cur.y };
      for (const g of goalAt.get(`${cur.x},${cur.y}`) ?? []) {
        const turn = g.inward >= 0 && cur.d !== 4 && cur.d !== g.inward ? BEND : 0;
        const total = it.g + g.cost + turn;
        heap.push({ f: total, seq: seq++, state: it.state, g: total, goal: g });
      }
      for (let d = 0; d < 4; d++) {
        if (cur.d !== 4 && (cur.d + 2) % 4 === d) continue;
        const ix = xi.get(cur.x)! + DX[d]!;
        const iy = yi.get(cur.y)! + DY[d]!;
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
        const next = { x: xs[ix]!, y: ys[iy]! };
        if (!free(here, next)) continue;
        const len = Math.abs(next.x - here.x) + Math.abs(next.y - here.y);
        const key = segKey(here, next);
        const g = it.g + len + (cur.d !== 4 && cur.d !== d ? BEND : 0) + (used.has(key) ? REUSE * len / 10 : 0);
        const st = id(next.x, next.y, d);
        if (g < dist[st]!) {
          dist[st] = g;
          parent[st] = it.state;
          heap.push({ f: g + h(next), seq: seq++, state: st, g });
        }
      }
    }
    return undefined;
  };

  // ---- ports: [border point, ring node, outward direction]
  const portsOf = (b: ClassBox) => {
    const { px, py } = ports(b);
    const out: { border: Point; ring: Point; dir: number }[] = [];
    for (const x of px) out.push({ border: { x, y: b.y }, ring: { x, y: b.y - RING }, dir: 0 });
    for (const y of py) out.push({ border: { x: b.x + b.width, y }, ring: { x: b.x + b.width + RING, y }, dir: 1 });
    for (const x of px) out.push({ border: { x, y: b.y + b.height }, ring: { x, y: b.y + b.height + RING }, dir: 2 });
    for (const y of py) out.push({ border: { x: b.x, y }, ring: { x: b.x - RING, y }, dir: 3 });
    return out.filter((p) => free(p.border, p.ring) || false).filter((p) => !nodeBlocked(p.ring));
  };
  const starts: Start[] = portsOf(source).map((p) => ({ node: p.ring, dir: p.dir, cost: RING, pre: [p.border] }));
  const goals: Goal[] = portsOf(target).map((p) => ({ node: p.ring, post: [p.border], inward: (p.dir + 2) % 4, cost: RING }));

  const waypoints = via;
  let result: Point[] = [];
  const legs: { s: Start[]; g: Goal[] }[] = [];
  if (waypoints.length === 0) legs.push({ s: starts, g: goals });
  else {
    const wpGoal = (p: Point): Goal => ({ node: p, post: [], inward: -1, cost: 0 });
    const wpStart = (p: Point): Start => ({ node: p, dir: 4, cost: 0, pre: [] });
    legs.push({ s: starts, g: [wpGoal(waypoints[0]!)] });
    for (let i = 0; i + 1 < waypoints.length; i++) legs.push({ s: [wpStart(waypoints[i]!)], g: [wpGoal(waypoints[i + 1]!)] });
    legs.push({ s: [wpStart(waypoints[waypoints.length - 1]!)], g: goals });
  }
  for (const leg of legs) {
    if (leg.s.length === 0 || leg.g.length === 0) return undefined;
    const part = search(leg.s, leg.g);
    if (!part) return undefined;
    result = result.length === 0 ? part : [...result, ...part.slice(1)];
  }

  // Drop collinear middle points (bends given by the user stay) and mark the taken segments.
  const keep = (p: Point) => viaKeys.has(`${p.x},${p.y}`);
  const pts: Point[] = [];
  for (const p of result) {
    const n = pts.length;
    if (n > 0 && pts[n - 1]!.x === p.x && pts[n - 1]!.y === p.y) continue;
    pts.push(p);
  }
  const simple = pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1 || keep(p)) return true;
    const a = pts[i - 1]!, b = pts[i + 1]!;
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
  for (let i = 1; i < simple.length; i++) markUsed(simple[i - 1]!, simple[i]!, xs, ys, used);
  return simple;
}

const segKey = (a: Point, b: Point) =>
  a.x < b.x || (a.x === b.x && a.y < b.y) ? `${a.x},${a.y}>${b.x},${b.y}` : `${b.x},${b.y}>${a.x},${a.y}`;

function markUsed(a: Point, b: Point, xs: number[], ys: number[], used: Set<string>) {
  // Split the segment at the grid lines so that later searches see it unit by unit.
  const vertical = a.x === b.x;
  const lines = (vertical ? ys : xs).filter((v) => v >= Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x) && v <= Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x));
  for (let i = 1; i < lines.length; i++) {
    const p = vertical ? { x: a.x, y: lines[i - 1]! } : { x: lines[i - 1]!, y: a.y };
    const q = vertical ? { x: a.x, y: lines[i]! } : { x: lines[i]!, y: a.y };
    used.add(segKey(p, q));
  }
}
