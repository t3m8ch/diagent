/** SVG -> PNG with resvg (prebuilt native binding, no system fonts). Node only. */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);
const FONT_DIR = join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
const FONT_FILES = ["DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf", "DejaVuSansMono-Oblique.ttf", "DejaVuSansMono-BoldOblique.ttf"].map(
  (f) => join(FONT_DIR, f),
);

/** Rasterises an SVG produced by `drawSvg`; `scale` 2 gives a sharper picture for review. */
export function svgToPng(svg: string, scale = 2): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    font: {
      loadSystemFonts: false,
      fontFiles: FONT_FILES,
      defaultFontFamily: "DejaVu Sans Mono",
      monospaceFamily: "DejaVu Sans Mono",
    },
  });
  return resvg.render().asPng();
}
