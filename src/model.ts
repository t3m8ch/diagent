/** Normalised diagram model (browser-safe: no Node imports). */
import { parseDocument } from "yaml";
import { KINDS, RELATION_KINDS, type RelationKind } from "./kinds.js";

export type Visibility = "public" | "private" | "protected" | "package";
export type ClassKind = "class" | "interface" | "enum";
export type { RelationKind };

export interface Attribute {
  name: string;
  type?: string;
  visibility: Visibility;
  static: boolean;
  multiplicity?: string;
}

export interface Operation {
  name: string;
  params: { name: string; type: string }[];
  returns?: string;
  visibility: Visibility;
  static: boolean;
  abstract: boolean;
}

export interface ClassModel {
  name: string;
  kind: ClassKind;
  abstract: boolean;
  stereotype?: string;
  attributes: Attribute[];
  operations: Operation[];
  literals: string[];
}

export interface RelationEnd {
  class: string;
  role?: string;
  multiplicity?: string;
  /** Open arrowhead at this end. */
  navigable: boolean;
}

export interface Relation {
  /** Key in `layout.relations`: `<kind>:<first>-<second>`, or the `id`. */
  key: string;
  kind: RelationKind;
  name?: string;
  stereotype?: string;
  /** Always two ends; for directed kinds `ends[0]` is the child / implementor / whole / client. */
  ends: [RelationEnd, RelationEnd];
  /** Association only: which end the reading direction points at. */
  reading?: 0 | 1;
}

export interface Model {
  classes: ClassModel[];
  relations: Relation[];
}

type Obj = Record<string, any>;

/** Builds the model from already-validated data (the result of `check` without errors). */
export function buildModel(data: Obj): Model {
  const classes: ClassModel[] = Object.entries((data.classes ?? {}) as Obj).map(([name, c]) => {
    c = c ?? {};
    return {
      name,
      kind: c.kind ?? "class",
      abstract: c.abstract === true,
      stereotype: c.stereotype,
      attributes: (c.attributes ?? []).map((a: Obj) => ({
        name: a.name,
        type: a.type,
        visibility: a.visibility ?? "public",
        static: a.static === true,
        multiplicity: a.multiplicity,
      })),
      operations: (c.operations ?? []).map((o: Obj) => ({
        name: o.name,
        params: Object.entries((o.params ?? {}) as Obj).map(([n, t]) => ({ name: n, type: String(t) })),
        returns: o.returns,
        visibility: o.visibility ?? "public",
        static: o.static === true,
        abstract: o.abstract === true,
      })),
      literals: c.literals ?? [],
    };
  });

  const relations: Relation[] = [];
  const rel = (data.relations ?? {}) as Obj;
  for (const kind of RELATION_KINDS) {
    for (const r of (rel[kind] ?? []) as Obj[]) {
      let ends: [RelationEnd, RelationEnd];
      let first: string;
      let second: string;
      if (kind === "association") {
        ends = r.ends.map((e: Obj) => ({
          class: e.class,
          role: e.role,
          multiplicity: e.multiplicity,
          navigable: e.navigable === true,
        })) as [RelationEnd, RelationEnd];
        first = ends[0].class;
        second = ends[1].class;
      } else {
        const info = KINDS[kind];
        const [a, b] = info.fields!;
        first = r[a];
        second = r[b];
        const multi = info.multiplicities === true;
        ends = [
          { class: first, multiplicity: multi ? r.whole_multiplicity : undefined, navigable: false },
          {
            class: second,
            multiplicity: multi ? r.part_multiplicity : undefined,
            navigable: info.secondEndNavigable === true,
          },
        ];
      }
      relations.push({
        key: r.id ?? `${kind}:${first}-${second}`,
        kind,
        name: r.name,
        stereotype: r.stereotype,
        ends,
        reading: kind === "association" && r.name ? (r.reading === "backward" ? 0 : 1) : undefined,
      });
    }
  }
  return { classes, relations };
}

/** Parses YAML text and builds the model. Throws on YAML syntax errors; run `check` first. */
export function parseModel(text: string): { model: Model; layout: Obj } {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error(doc.errors[0]!.message);
  const data = (doc.toJS() ?? {}) as Obj;
  return { model: buildModel(data), layout: data.layout ?? {} };
}
