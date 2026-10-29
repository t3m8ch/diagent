import type { DiagramLayout } from "../src/layout.js";
import { rectsOverlap, segHitsBox } from "../src/route.js";

/** Human-readable problems of the label placement: a label on a class, on a route line, or on another label. */
export function labelProblems(l: DiagramLayout): string[] {
  const problems: string[] = [];
  const labels = l.relations.flatMap((e) => e.labels.map((lab) => ({ lab, key: e.key })));
  for (const [i, { lab, key }] of labels.entries()) {
    for (const c of l.classes) if (rectsOverlap(lab, c)) problems.push(`label "${lab.text}" of ${key} on class ${c.name}`);
    for (const e of l.relations)
      for (let k = 1; k < e.points.length; k++)
        if (segHitsBox(e.points[k - 1]!, e.points[k]!, lab)) problems.push(`label "${lab.text}" of ${key} on the line of ${e.key}`);
    for (const other of labels.slice(i + 1))
      if (rectsOverlap(lab, other.lab)) problems.push(`label "${lab.text}" of ${key} on label "${other.lab.text}" of ${other.key}`);
  }
  return problems;
}
