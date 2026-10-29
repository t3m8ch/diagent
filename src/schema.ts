/** JSON Schema (draft-07) of a `*.cd.yaml` diagram. Printed by `diagent schema`. */

import { KINDS, RELATION_KINDS, type RelationKind } from "./kinds.js";

export const CLASS_NAME_PATTERN = "^\\p{L}[\\p{L}\\p{N}_]*$";

const str = { type: "string" } as const;
const bool = { type: "boolean" } as const;
const int = { type: "integer" } as const;
const visibility = {
  enum: ["public", "private", "protected", "package"],
  default: "public",
  description: "Written as a word, never as +, -, # or ~.",
} as const;
const multiplicity = {
  type: "string",
  description: 'Always a string: "1", "0..1", "0..*", "1..*", "*".',
} as const;
const className = {
  type: "string",
  description: "Name of a class from `classes`.",
} as const;
const id = {
  type: "string",
  minLength: 1,
  description: "Optional unique id; needed to tell apart several relations between one pair of classes.",
} as const;

const attribute = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { ...str, minLength: 1 },
    type: { ...str, description: 'Free text, e.g. "List<Ингредиент>".' },
    visibility,
    static: bool,
    multiplicity,
  },
} as const;

const operation = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { ...str, minLength: 1 },
    params: {
      type: "object",
      additionalProperties: str,
      description: "Parameter name -> type, in order.",
    },
    returns: str,
    visibility,
    static: bool,
    abstract: bool,
  },
} as const;

const classDef = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { enum: ["class", "interface", "enum"], default: "class" },
    abstract: bool,
    stereotype: str,
    attributes: { type: "array", items: attribute },
    operations: { type: "array", items: operation },
    literals: { type: "array", items: { ...str, minLength: 1 }, description: "Enumeration literals." },
  },
} as const;

const relation = (properties: Record<string, unknown>, required: string[]) =>
  ({
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required,
      properties: { id, ...properties },
    },
  }) as const;

const associationEnd = {
  type: "object",
  additionalProperties: false,
  required: ["class"],
  properties: {
    class: className,
    role: str,
    multiplicity,
    navigable: { ...bool, description: "Draw an open arrowhead at this end." },
  },
} as const;

const associationProperties = {
  name: str,
  reading: {
    enum: ["forward", "backward"],
    description: "Direction of reading: forward = from ends[0] to ends[1].",
  },
  ends: { type: "array", minItems: 2, maxItems: 2, items: associationEnd },
};

/** Properties of one relation kind, built from the per-kind table. */
function relationProperties(kind: RelationKind): { properties: Record<string, unknown>; required: string[] } {
  const info = KINDS[kind];
  if (!info.fields) return { properties: associationProperties, required: ["ends"] };
  const [first, second] = info.fields;
  const properties: Record<string, unknown> = {};
  if (info.name) properties.name = str;
  properties[first] = className;
  properties[second] = className;
  if (info.multiplicities) {
    properties.whole_multiplicity = multiplicity;
    properties.part_multiplicity = multiplicity;
  }
  if (info.stereotype) properties.stereotype = { ...str, description: 'E.g. "create", "use".' };
  return { properties, required: [first, second] };
}

const relations = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    RELATION_KINDS.map((kind) => {
      const { properties, required } = relationProperties(kind);
      return [kind, relation(properties, required)];
    }),
  ),
} as const;

const layout = {
  type: "object",
  additionalProperties: false,
  description: "Optional. Positions and bends, edited mostly by a human in the editor.",
  properties: {
    classes: {
      type: "object",
      propertyNames: { pattern: CLASS_NAME_PATTERN },
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["x", "y"],
        properties: { x: int, y: int },
        description: "Top-left corner.",
      },
    },
    relations: {
      type: "object",
      description: 'Key: "<kind>:<first end>-<second end>" or the relation `id`.',
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["bends"],
        properties: {
          bends: {
            type: "array",
            items: { type: "array", minItems: 2, maxItems: 2, items: int },
          },
        },
      },
    },
  },
} as const;

export const schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "diagent class diagram",
  type: "object",
  additionalProperties: false,
  required: ["classes"],
  properties: {
    classes: {
      type: "object",
      propertyNames: { pattern: CLASS_NAME_PATTERN },
      additionalProperties: classDef,
    },
    relations,
    layout,
  },
} as const;
