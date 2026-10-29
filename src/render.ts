/** Text of a diagram file -> SVG. Browser-safe; the PNG step lives in `png.ts` (Node only). */
import { drawSvg, type Theme } from "./draw.js";
import { layoutDiagram, parsePins, type DiagramLayout } from "./layout.js";
import { parseModel } from "./model.js";

export type { Theme };

/** Parses (without validating: run `check` first), lays out and returns the layout data. */
export async function layoutText(text: string): Promise<DiagramLayout> {
  const { model, layout } = parseModel(text);
  return layoutDiagram(model, parsePins(layout, model));
}

export async function renderSvg(text: string, options: { theme?: Theme } = {}): Promise<string> {
  return drawSvg(await layoutText(text), options.theme ?? "light");
}
