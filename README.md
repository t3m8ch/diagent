# diagent

UML class diagrams written by agents, laid out by a deterministic engine.

You (or your coding agent) describe the **model** (classes and relations) in a `*.cd.yaml` file. `diagent` validates it, lays it out automatically and draws it as SVG or PNG. A human can then fix the layout by hand in a browser editor; those positions are saved back into the same file.

> **Pre-1.0: the format may change without notice.**

![Kolobok class diagram](https://raw.githubusercontent.com/t3m8ch/diagent/master/docs/kolobok.png)

## Install

```sh
npm install --save-dev diagent
# or run without installing:
npx diagent check diagram.cd.yaml
```

Requires Node.js 20 or newer.

## Usage

```sh
npx diagent schema                              # print the JSON Schema of a diagram
npx diagent check [--json] diagram.cd.yaml      # validate; exit code 1 on errors
npx diagent render diagram.cd.yaml -o out.png   # out.svg or out.png, add --theme dark
npx diagent edit diagram.cd.yaml                # layout editor in a browser (--port N, --no-open)
```

The JSON Schema is also shipped as a file: `node_modules/diagent/schema/diagent.schema.json`. Unknown keys are errors.

## Example

```yaml
# yaml-language-server: $schema=./node_modules/diagent/schema/diagent.schema.json
classes:
  Order:
    attributes:
      - { name: number, type: Integer, visibility: private }
    operations:
      - { name: pay, params: { amount: Money }, returns: Boolean }
  Item: {}

relations:
  composition:
    - { whole: Order, part: Item, whole_multiplicity: "1", part_multiplicity: "1..*" }
```

```sh
npx diagent check order.cd.yaml
npx diagent render order.cd.yaml -o order.png
```

A bigger example is [`examples/kolobok.cd.yaml`](examples/kolobok.cd.yaml), rendered above.

## Use with an AI agent

[`SKILL.md`](SKILL.md) teaches an agent how to write and check diagrams. It ships in the package at `node_modules/diagent/SKILL.md`. Copy or symlink it into your agent's skills directory, for example:

```sh
mkdir -p .claude/skills/diagent
cp node_modules/diagent/SKILL.md .claude/skills/diagent/SKILL.md
```

Other agents can read it as a plain instruction file (for instance, reference it from `AGENTS.md`).

## License

GPL-3.0-only, see [LICENSE](LICENSE).
