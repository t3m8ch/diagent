import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";

const errors = (text: string) => check(text).filter((d) => d.severity === "error");
const warnings = (text: string) => check(text).filter((d) => d.severity === "warning");

describe("check: valid diagrams", () => {
  it("accepts the Kolobok example without errors", () => {
    const text = readFileSync(new URL("../examples/kolobok.cd.yaml", import.meta.url), "utf8");
    expect(check(text)).toEqual([]);
  });

  it("accepts a minimal diagram", () => {
    expect(check("classes:\n  A: {}\n")).toEqual([]);
  });
});

describe("check: structure", () => {
  it("reports an unknown key at the key position", () => {
    const text = `classes:
  A:
    colour: red
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "classes.A.colour",
        line: 3,
        column: 5,
        message: 'unknown key "colour"; allowed keys: kind, abstract, stereotype, attributes, operations, literals',
      },
    ]);
  });

  it("reports a value of the wrong type", () => {
    const text = `classes:
  A:
    abstract: "yes"
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "classes.A.abstract",
        line: 3,
        column: 15,
        message: "expected boolean, got string",
      },
    ]);
  });

  it("rejects an invalid visibility with the list of allowed values", () => {
    const text = `classes:
  A:
    operations:
      - name: f
      - name: g
        visibility: secret
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "classes.A.operations[1].visibility",
        line: 6,
        column: 21,
        message: 'must be one of: public, private, protected, package; got "secret"',
      },
    ]);
  });

  it("reports a missing required key on the object", () => {
    const text = `classes:
  A:
    attributes:
      - type: String
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "classes.A.attributes[0]",
        line: 4,
        column: 9,
        message: 'missing required key "name"',
      },
    ]);
  });

  it("rejects class names that are not identifiers", () => {
    const text = `classes:
  1A: {}
  "my class": {}
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "classes.1A",
        line: 2,
        column: 3,
        message: 'invalid class name "1A": use letters, digits and "_", starting with a letter',
      },
      {
        severity: "error",
        path: 'classes["my class"]',
        line: 3,
        column: 3,
        message: 'invalid class name "my class": use letters, digits and "_", starting with a letter',
      },
    ]);
  });

  it("accepts class names in any alphabet", () => {
    expect(errors("classes:\n  Колобок: {}\n  東京_2: {}\n")).toEqual([]);
  });

  it("reports a duplicate class name", () => {
    const text = `classes:
  A: {}
  A: {}
`;
    const result = errors(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ path: "classes.A", line: 3, column: 3 });
    expect(result[0]?.message).toMatch(/unique/i);
  });

  it("requires classes", () => {
    expect(errors("relations: {}\n")).toEqual([
      { severity: "error", path: "", line: 1, column: 1, message: 'missing required key "classes"' },
    ]);
  });
});

describe("check: references and duplicates", () => {
  it("reports a reference to a missing class", () => {
    const text = `classes:
  A: {}
relations:
  generalization:
    - child: A
      parent: B
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "relations.generalization[0].parent",
        line: 6,
        column: 15,
        message: 'unknown class "B"',
      },
    ]);
  });

  it("reports a reference to a missing class inside association ends", () => {
    const text = `classes:
  A: {}
relations:
  association:
    - ends:
        - class: A
        - class: Z
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "relations.association[0].ends[1].class",
        line: 7,
        column: 18,
        message: 'unknown class "Z"',
      },
    ]);
  });

  it("reports a duplicate attribute name", () => {
    const text = `classes:
  A:
    attributes:
      - name: x
      - name: x
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "classes.A.attributes[1].name",
        line: 5,
        column: 15,
        message: 'duplicate attribute name "x" (first defined at line 4)',
      },
    ]);
  });

  it("reports a duplicate operation name and a duplicate literal", () => {
    const text = `classes:
  E:
    kind: enum
    literals: [ONE, TWO, ONE]
  B:
    operations:
      - name: f
      - name: f
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "classes.E.literals[2]",
        line: 4,
        column: 26,
        message: 'duplicate literal "ONE" (first defined at line 4)',
      },
      {
        severity: "error",
        path: "classes.B.operations[1].name",
        line: 8,
        column: 15,
        message: 'duplicate operation name "f" (first defined at line 7)',
      },
    ]);
  });

  it("reports a duplicate relation id", () => {
    const text = `classes:
  A: {}
  B: {}
relations:
  dependency:
    - { id: r, client: A, supplier: B }
    - { id: r, client: B, supplier: A }
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "relations.dependency[1].id",
        line: 7,
        column: 13,
        message: 'duplicate id "r" (first defined at line 6)',
      },
    ]);
  });

  it("reports several relations between one pair without an id", () => {
    const text = `classes:
  A: {}
  B: {}
relations:
  association:
    - ends: [{ class: A }, { class: B }]
    - ends: [{ class: A }, { class: B }]
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "relations.association[1]",
        line: 7,
        column: 7,
        message:
          'duplicate relation "association:A-B" (first defined at line 6); give each of them a distinct "id"',
      },
    ]);
  });

  it("allows two relations between one pair when they have ids", () => {
    const text = `classes:
  A: {}
  B: {}
relations:
  association:
    - { id: one, ends: [{ class: A }, { class: B }] }
    - { id: two, ends: [{ class: A }, { class: B }] }
`;
    expect(errors(text)).toEqual([]);
  });

  it("requires a realization to point at an interface", () => {
    const text = `classes:
  A: {}
  B: {}
  I:
    kind: interface
relations:
  realization:
    - { implementor: A, interface: I }
    - { implementor: A, interface: B }
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "relations.realization[1].interface",
        line: 9,
        column: 36,
        message: 'class "B" is not an interface (kind: class)',
      },
    ]);
  });
});

describe("check: layout", () => {
  it("warns about orphaned layout entries and still succeeds", () => {
    const text = `classes:
  A: {}
  B: {}
relations:
  dependency:
    - { client: A, supplier: B }
layout:
  classes:
    A: { x: 0, y: 0 }
    Gone: { x: 5, y: 5 }
  relations:
    "dependency:A-B": { bends: [[1, 2]] }
    "dependency:B-A": { bends: [[1, 2]] }
`;
    expect(errors(text)).toEqual([]);
    expect(warnings(text)).toEqual([
      {
        severity: "warning",
        path: "layout.classes.Gone",
        line: 10,
        column: 5,
        message: 'orphaned layout entry: no class "Gone" in the model',
      },
      {
        severity: "warning",
        path: 'layout.relations["dependency:B-A"]',
        line: 13,
        column: 5,
        message: 'orphaned layout entry: no relation "dependency:B-A" in the model',
      },
    ]);
  });

  it("matches layout entries to relations by id", () => {
    const text = `classes:
  A: {}
  B: {}
relations:
  dependency:
    - { id: dep, client: A, supplier: B }
layout:
  relations:
    dep: { bends: [[1, 2]] }
`;
    expect(check(text)).toEqual([]);
  });

  it("requires integer coordinates", () => {
    const text = `classes:
  A: {}
layout:
  classes:
    A: { x: 1.5, y: 0 }
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "layout.classes.A.x",
        line: 5,
        column: 13,
        message: "expected integer, got number",
      },
    ]);
  });
});

describe("check: YAML traps", () => {
  it("explains a comment that swallowed a list item", () => {
    const text = `classes:
  A:
    attributes:
      - #поле
      - name: b
`;
    const result = errors(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: "classes.A.attributes[0]",
      line: 4,
      message: "expected object, got null (an empty list item; a \"#\" starts a YAML comment)",
    });
  });

  it("reports ~ as null instead of crashing", () => {
    const text = `classes:
  A:
    attributes:
      - name: a
        type: ~
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "classes.A.attributes[0].type",
        line: 5,
        column: 15,
        message: 'expected string, got null (write "~" in quotes if you mean the text)',
      },
    ]);
  });

  it("reports an unquoted * as a YAML syntax error with a position", () => {
    const text = `classes:
  A:
    attributes:
      - name: a
        multiplicity: *
`;
    const result = errors(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ line: 5 });
    expect(result[0]?.column).toBeGreaterThanOrEqual(23);
    expect(result[0]?.message).toMatch(/"\*" starts a YAML alias/);
  });

  it("asks to quote a number given as multiplicity", () => {
    const text = `classes:
  A:
    attributes:
      - name: a
        multiplicity: 1
`;
    expect(errors(text)).toEqual([
      {
        severity: "error",
        path: "classes.A.attributes[0].multiplicity",
        line: 5,
        column: 23,
        message: "expected string, got number (put the value in quotes)",
      },
    ]);
  });

  it("reports an empty file and non-mapping documents", () => {
    expect(errors("")).toEqual([
      { severity: "error", path: "", line: 1, column: 1, message: "expected object, got null (the file is empty)" },
    ]);
    expect(errors("- a\n")[0]).toMatchObject({ path: "", line: 1, column: 1, message: "expected object, got array" });
  });
});
