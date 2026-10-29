---
name: diagent
description: Draw UML class diagrams. Use when asked to draw, sketch, model or visualize classes and the relations between them, or to edit an existing `*.cd.yaml`.
---

# Writing diagrams with diagent

A diagram is one `*.cd.yaml` file: the **model** (`classes`, `relations`) that you write, and an optional `layout` that a human owns. The `diagent` CLI validates the file and draws it. In the diagent repo itself run it from the repo root as `pnpm -s dev <args>`; its output starts with one `$ tsx ...` banner line.

`diagent schema` prints the JSON Schema (the same file ships as `schema/diagent.schema.json` in the package; unknown keys are errors): the source of truth for every key, enum value and relation kind. Run it once before writing; the rules below cover only what the schema cannot say.

## Format

```yaml
classes:
  Заказ:
    attributes:
      - { name: номер, type: Integer, visibility: private }
    operations:
      - { name: оплатить, params: { сумма: Money }, returns: Boolean }
  Позиция: {}
  Оплачиваемое:
    kind: interface
  Клиент:
    abstract: true
  Статус:
    kind: enum
    literals: [НОВЫЙ, ОПЛАЧЕН]

relations:
  composition:
    - { whole: Заказ, part: Позиция, whole_multiplicity: "1", part_multiplicity: "1..*" }
  realization:
    - { implementor: Заказ, interface: Оплачиваемое }
  association:
    - name: делает
      reading: forward
      ends:
        - { class: Клиент, role: покупатель, multiplicity: "1" }
        - { class: Заказ, role: заказ, multiplicity: "0..*", navigable: true }
```

Relations are grouped by kind under `relations.<kind>`, each a list. Kinds and their end fields:

| kind | fields |
| --- | --- |
| `generalization` | `child`, `parent` |
| `realization` | `implementor`, `interface` (a class with `kind: interface`) |
| `composition`, `aggregation` | `whole`, `part`, `whole_multiplicity`, `part_multiplicity`, `name` |
| `dependency` | `client`, `supplier`, `stereotype` |
| `association` | `name`, `reading`, `ends` (exactly two of `class`, `role`, `multiplicity`, `navigable`) |

## Rules

- Leave `layout` out. Positions belong to the human and the autolayout.
- Name the ends of a relation by meaning: an association gets a verb `name` read from `ends[0]` to `ends[1]` (`reading: forward`) and a `role` on each end that says what that class is in this relation (`покупатель`, `хозяин`), never `end1` or `a`.
- Write visibility as a word: `public`, `private`, `protected`, `package`. The symbols `+ - # ~` are YAML-hostile and rejected.
- Write multiplicity as a quoted string: `"1"`, `"0..1"`, `"*"`, `"1..*"`. An unquoted `1` is a number and fails.
- Give an `id` to every relation when two relations of the same kind join one pair of classes in the same order.
- Describe the model only. Colours, fonts, sizes, arrow styles and hidden edges have no place in the file; the renderer decides how it looks.
- Class names are letters, digits and `_`, starting with a letter; use the user's language for them.
- Draw what the user asked for. Each class and relation traces to the request; put a member only where it carries meaning.

## Loop

1. Write or edit `<name>.cd.yaml`.
2. Run `diagent check --json <file>`. Exit 0 means no errors; `ok: false` lists `diagnostics` with `path`, `line`, `column`, `message`. Fix every `error`, then run again until `ok: true`. Each `warning` also needs a look.
3. Run `diagent render <file> -o <name>.png` (add `--theme dark` if asked). Success prints nothing and exits 0.
4. Open the PNG and look at it. Compare it with the request: every class present, arrows in the intended direction, multiplicities and names readable. Change the model and go back to step 2 until the picture says what was asked.
