/**
 * The one per-kind table of relations. The model builder, `check`, the JSON Schema and the
 * layout read it, so a kind is described in a single place. Browser-safe, no imports.
 */

export type RelationKind =
  | "generalization"
  | "realization"
  | "composition"
  | "aggregation"
  | "dependency"
  | "association";

export type Marker = "none" | "triangle" | "diamond" | "filled-diamond" | "arrow";

export interface KindInfo {
  /** Keys of the two ends in the file; `undefined` for association, which has an `ends` list. */
  fields?: [string, string];
  /** Markers at `ends[0]` and `ends[1]`; `undefined` for association (arrowheads follow `navigable`). */
  markers?: [Marker, Marker];
  /** Always-open arrowhead at the second end (dependency). */
  secondEndNavigable?: boolean;
  /** Drawn dashed. */
  dashed?: boolean;
  /** Drawn from the second end to the first: parents and interfaces go on top. */
  swap?: boolean;
  /** Has `whole_multiplicity` / `part_multiplicity`. */
  multiplicities?: boolean;
  /** The kind has a `name`. */
  name?: boolean;
  /** The kind has a `stereotype` and shows it, instead of a name, in the middle of the line. */
  stereotype?: boolean;
  /** The second end must be an interface. */
  secondEndIsInterface?: boolean;
}

/** In the order relations are listed in the model. */
export const KINDS: Record<RelationKind, KindInfo> = {
  generalization: { fields: ["child", "parent"], markers: ["none", "triangle"], swap: true },
  realization: {
    fields: ["implementor", "interface"],
    markers: ["none", "triangle"],
    swap: true,
    dashed: true,
    secondEndIsInterface: true,
  },
  composition: { fields: ["whole", "part"], markers: ["filled-diamond", "none"], multiplicities: true, name: true },
  aggregation: { fields: ["whole", "part"], markers: ["diamond", "none"], multiplicities: true, name: true },
  dependency: {
    fields: ["client", "supplier"],
    markers: ["none", "arrow"],
    secondEndNavigable: true,
    dashed: true,
    stereotype: true,
  },
  association: { name: true },
};

export const RELATION_KINDS = Object.keys(KINDS) as RelationKind[];
