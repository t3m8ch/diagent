/**
 * SVG drawing of a `DiagramGeometry`. Pure function, browser-safe (no Node imports);
 * knows nothing about the model or ELK.
 */
import {
  FONT_SIZE,
  LABEL_FONT_SIZE,
  LINE_H,
  PAD_C,
  PAD_X,
  PAD_Y,
  type ClassBox,
  type DiagramGeometry,
  type RelationLabel,
  type RelationRoute,
  type Marker,
  type Point,
} from "./layout.js";

export type Theme = "light" | "dark";

export const FONT_FAMILY = "DejaVu Sans Mono, monospace";

const COLORS: Record<Theme, { fg: string; bg: string }> = {
  light: { fg: "#000000", bg: "#ffffff" },
  dark: { fg: "#ffffff", bg: "#000000" },
};

const n = (v: number) => String(Math.round(v * 100) / 100);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MARKER_LEN: Record<Marker, number> = { none: 0, arrow: 0, triangle: 12, diamond: 16, "filled-diamond": 16 };

/** Draws the layout as a standalone SVG document. */
export function drawSvg(layout: DiagramGeometry, theme: Theme = "light"): string {
  const { fg, bg } = COLORS[theme];
  const out: string[] = [];
  const ox = layout.originX ?? 0;
  const oy = layout.originY ?? 0;
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(layout.width)}" height="${n(layout.height)}" viewBox="${n(ox)} ${n(oy)} ${n(layout.width)} ${n(layout.height)}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" fill="${fg}">`,
  );
  out.push(
    `<rect${ox || oy ? ` x="${n(ox)}" y="${n(oy)}"` : ""} width="${n(layout.width)}" height="${n(layout.height)}" fill="${bg}"/>`,
  );
  for (const e of layout.relations) out.push(drawRelation(e, fg, bg));
  for (const c of layout.classes) out.push(drawClass(c, fg, bg));
  out.push("</svg>");
  return out.join("\n") + "\n";
}

function drawClass(c: ClassBox, fg: string, bg: string): string {
  const cx = c.x + c.width / 2;
  const parts: string[] = [`<g>`];
  parts.push(`<rect x="${n(c.x)}" y="${n(c.y)}" width="${n(c.width)}" height="${n(c.height)}" fill="${bg}" stroke="${fg}" stroke-width="1.5"/>`);
  let ty = c.y + PAD_Y + 13;
  for (const s of c.stereotypes) {
    parts.push(`<text x="${n(cx)}" y="${n(ty)}" text-anchor="middle">${esc(s)}</text>`);
    ty += LINE_H;
  }
  parts.push(
    `<text x="${n(cx)}" y="${n(ty)}" text-anchor="middle" font-weight="bold"${c.italicName ? ' font-style="italic"' : ""}>${esc(c.name)}</text>`,
  );
  for (const comp of c.compartments) {
    const top = c.y + comp.y;
    parts.push(`<line x1="${n(c.x)}" y1="${n(top)}" x2="${n(c.x + c.width)}" y2="${n(top)}" stroke="${fg}" stroke-width="1.5"/>`);
    comp.items.forEach((item, i) => {
      const attrs =
        (item.italic ? ' font-style="italic"' : "") + (item.underline ? ' text-decoration="underline"' : "");
      parts.push(`<text x="${n(c.x + PAD_X)}" y="${n(top + PAD_C + i * LINE_H + 13)}"${attrs}>${esc(item.text)}</text>`);
    });
  }
  parts.push("</g>");
  return parts.join("\n");
}

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

const at = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const pt = (p: Point) => `${n(p.x)},${n(p.y)}`;

/** Marker at `tip`, where `d` points from the line towards the tip. */
function drawMarker(m: Marker, tip: Point, d: Point, fg: string, bg: string): string {
  const nx = { x: -d.y, y: d.x };
  switch (m) {
    case "none":
      return "";
    case "arrow":
      return `<polyline points="${pt(at(at(tip, d, -10), nx, 5))} ${pt(tip)} ${pt(at(at(tip, d, -10), nx, -5))}" fill="none" stroke="${fg}" stroke-width="1.5"/>`;
    case "triangle": {
      const b = at(tip, d, -12);
      return `<polygon points="${pt(tip)} ${pt(at(b, nx, 6))} ${pt(at(b, nx, -6))}" fill="${bg}" stroke="${fg}" stroke-width="1.5"/>`;
    }
    case "diamond":
    case "filled-diamond": {
      const mid = at(tip, d, -8);
      return `<polygon points="${pt(tip)} ${pt(at(mid, nx, 5))} ${pt(at(tip, d, -16))} ${pt(at(mid, nx, -5))}" fill="${m === "diamond" ? bg : fg}" stroke="${fg}" stroke-width="1.5"/>`;
    }
  }
}

function drawRelation(e: RelationRoute, fg: string, bg: string): string {
  const pts = e.points.map((p) => ({ ...p }));
  if (pts.length < 2) return "";
  const last = pts.length - 1;
  const startDir = unit(pts[1]!, pts[0]!); // from the line towards the source tip
  const endDir = unit(pts[last - 1]!, pts[last]!);
  const startTip = pts[0]!;
  const endTip = pts[last]!;
  pts[0] = at(startTip, startDir, -MARKER_LEN[e.sourceMarker]);
  pts[last] = at(endTip, endDir, -MARKER_LEN[e.targetMarker]);

  const parts = [`<g>`];
  parts.push(
    `<polyline points="${pts.map(pt).join(" ")}" fill="none" stroke="${fg}" stroke-width="1.5"${e.dashed ? ' stroke-dasharray="7 5"' : ""}/>`,
  );
  parts.push(drawMarker(e.sourceMarker, startTip, startDir, fg, bg));
  parts.push(drawMarker(e.targetMarker, endTip, endDir, fg, bg));
  for (const l of e.labels) parts.push(drawLabel(l));
  parts.push("</g>");
  return parts.filter(Boolean).join("\n");
}

function drawLabel(l: RelationLabel): string {
  return `<text x="${n(l.x + 2)}" y="${n(l.y + l.height - 4)}" font-size="${LABEL_FONT_SIZE}">${esc(l.text)}</text>`;
}
