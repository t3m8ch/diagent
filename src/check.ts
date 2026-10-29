import { Ajv, type ErrorObject } from "ajv";
import {
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type Document,
} from "yaml";
import { KINDS, RELATION_KINDS } from "./kinds.js";
import { schema } from "./schema.js";

export interface Diagnostic {
  severity: "error" | "warning";
  /** YAML path such as `classes.Колобок.operations[1].visibility`; empty for the document root. */
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  message: string;
}

type Segment = string | number;
type Obj = Record<string, unknown>;

const ajv = new Ajv({ allErrors: true, verbose: true, strict: true });
const validate = ajv.compile(schema);

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function formatPath(path: Segment[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else if (/^[\p{L}\p{N}_]+$/u.test(seg)) out += out === "" ? seg : `.${seg}`;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

/** Check the text of a diagram file; returns errors and warnings with positions. */
export function check(text: string): Diagnostic[] {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });

  const at = (offset: number) => {
    const { line, col } = lineCounter.linePos(offset);
    return { line, column: col };
  };

  if (doc.errors.length > 0) {
    return doc.errors.map((e) => ({
      severity: "error" as const,
      path: formatPath(pathAtOffset(doc, e.pos[0])),
      ...at(e.pos[0]),
      message:
        e.message.split("\n")[0]!.replace(/ at line \d+, column \d+$/, "") +
        (e.code === "BAD_ALIAS" ? ' (a bare "*" starts a YAML alias; put the value in quotes)' : ""),
    }));
  }

  const data: unknown = doc.toJS();
  const diagnostics: Diagnostic[] = [];
  const add = (
    severity: Diagnostic["severity"],
    path: Segment[],
    message: string,
    target: "value" | "key" = "value",
  ) => {
    const offset = locate(doc, path, target);
    diagnostics.push({ severity, path: formatPath(path), ...at(offset), message });
  };

  const seen = new Set<string>();
  if (!validate(data)) {
    for (const err of validate.errors ?? []) {
      const found = describeSchemaError(data, err);
      if (!found) continue;
      const key = `${formatPath(found.path)}|${found.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add("error", found.path, found.message, found.target);
    }
  }

  if (isObj(data)) semanticChecks(data, add, (path) => at(locate(doc, path, "value")).line);
  return diagnostics;
}

function describeSchemaError(
  root: unknown,
  err: ErrorObject,
): { path: Segment[]; message: string; target: "value" | "key" } | undefined {
  const fixed = resolvePointer(root, err.instancePath);
  switch (err.keyword) {
    case "additionalProperties": {
      const prop = String(err.params.additionalProperty);
      const allowed = Object.keys((err.parentSchema as { properties?: Obj }).properties ?? {});
      return {
        path: [...fixed, prop],
        message: `unknown key "${prop}"; allowed keys: ${allowed.join(", ")}`,
        target: "key",
      };
    }
    case "required":
      return { path: fixed, message: `missing required key "${String(err.params.missingProperty)}"`, target: "value" };
    case "propertyNames": {
      const name = String(err.params.propertyName);
      return {
        path: [...fixed, name],
        message: `invalid class name "${name}": use letters, digits and "_", starting with a letter`,
        target: "key",
      };
    }
    case "pattern":
      if (err.schemaPath.includes("/propertyNames/")) return undefined;
      return { path: fixed, message: `must match ${String(err.params.pattern)}`, target: "value" };
    case "enum": {
      const allowed = (err.params.allowedValues as unknown[]).join(", ");
      return { path: fixed, message: `must be one of: ${allowed}; got ${JSON.stringify(err.data)}`, target: "value" };
    }
    case "type": {
      const expected = String(err.params.type);
      const got = typeName(err.data);
      return { path: fixed, message: `expected ${expected}, got ${got}${typeHint(expected, err.data, fixed)}`, target: "value" };
    }
    case "minItems":
    case "maxItems":
      return { path: fixed, message: `must have ${err.keyword === "minItems" ? "at least" : "at most"} ${String(err.params.limit)} items`, target: "value" };
    case "minLength":
      return { path: fixed, message: "must not be empty", target: "value" };
    default:
      return { path: fixed, message: err.message ?? "invalid value", target: "value" };
  }
}

/** JSON pointer to path segments; array indices become numbers. */
function resolvePointer(root: unknown, pointer: string): Segment[] {
  const out: Segment[] = [];
  let cur = root;
  for (const raw of pointer === "" ? [] : pointer.split("/").slice(1)) {
    const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(cur)) {
      out.push(Number(seg));
      cur = cur[Number(seg)];
    } else {
      out.push(seg);
      cur = isObj(cur) ? cur[seg] : undefined;
    }
  }
  return out;
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function typeHint(expected: string, data: unknown, path: Segment[]): string {
  if (data === null) {
    if (path.length === 0) return " (the file is empty)";
    if (expected === "string") return ' (write "~" in quotes if you mean the text)';
    if (typeof path[path.length - 1] === "number")
      return ' (an empty list item; a "#" starts a YAML comment)';
    if (expected === "object") return " (an empty value; write {} for an empty object)";
    if (expected === "array") return " (an empty value; write [] for an empty list)";
  }
  if (expected === "string" && (typeof data === "number" || typeof data === "boolean"))
    return " (put the value in quotes)";
  return "";
}

type Add = (severity: Diagnostic["severity"], path: Segment[], message: string, target?: "value" | "key") => void;

function semanticChecks(data: Obj, add: Add, lineOf: (path: Segment[]) => number): void {
  const classes = isObj(data.classes) ? data.classes : {};
  const kindOf = (name: string): string => {
    const c = classes[name];
    return isObj(c) && typeof c.kind === "string" ? c.kind : "class";
  };

  // Duplicate members.
  for (const [name, def] of Object.entries(classes)) {
    if (!isObj(def)) continue;
    const members: [string, string, boolean][] = [
      ["attributes", "attribute", true],
      ["operations", "operation", true],
      ["literals", "literal", false],
    ];
    for (const [field, noun, isObject] of members) {
      const list = def[field];
      if (!Array.isArray(list)) continue;
      const first = new Map<string, number>();
      list.forEach((item, i) => {
        const value = isObject ? (isObj(item) ? item.name : undefined) : item;
        if (typeof value !== "string") return;
        const path: Segment[] = isObject ? ["classes", name, field, i, "name"] : ["classes", name, field, i];
        const prev = first.get(value);
        if (prev === undefined) first.set(value, lineOf(path));
        else add("error", path, `duplicate ${noun}${isObject ? " name" : ""} "${value}" (first defined at line ${prev})`);
      });
    }
  }

  // Relations: references, interface targets, duplicate keys and ids.
  // Ids and generated keys share one namespace: both are keys in `layout.relations`.
  const firstByKey = new Map<string, { line: number; explicit: boolean }>();
  const relations = isObj(data.relations) ? data.relations : {};
  const checkRef = (path: Segment[], value: unknown): value is string => {
    if (typeof value !== "string") return false;
    if (!Object.hasOwn(classes, value)) {
      add("error", path, `unknown class "${value}"`);
      return false;
    }
    return true;
  };

  for (const kind of RELATION_KINDS) {
    const list = relations[kind];
    if (!Array.isArray(list)) continue;
    list.forEach((rel, i) => {
      if (!isObj(rel)) return;
      const base: Segment[] = ["relations", kind, i];
      let ends: [string, string] | undefined;
      if (kind === "association") {
        const e = Array.isArray(rel.ends) ? rel.ends : [];
        const names = [0, 1].map((n) => {
          const end = e[n];
          return isObj(end) ? end.class : undefined;
        });
        const ok = names.map((v, n) => checkRef([...base, "ends", n, "class"], v));
        if (ok[0] && ok[1]) ends = [names[0] as string, names[1] as string];
      } else {
        const [a, b] = KINDS[kind].fields!;
        const okA = checkRef([...base, a], rel[a]);
        const okB = checkRef([...base, b], rel[b]);
        if (okA && okB) ends = [rel[a] as string, rel[b] as string];
        if (KINDS[kind].secondEndIsInterface && okB && kindOf(rel[b] as string) !== "interface")
          add("error", [...base, b], `class "${String(rel[b])}" is not an interface (kind: ${kindOf(rel[b] as string)})`);
      }

      const id = typeof rel.id === "string" ? rel.id : undefined;
      const key = id ?? (ends ? `${kind}:${ends[0]}-${ends[1]}` : undefined);
      if (key === undefined) return;
      const path = id !== undefined ? [...base, "id"] : base;
      const prev = firstByKey.get(key);
      if (!prev) firstByKey.set(key, { line: lineOf(path), explicit: id !== undefined });
      else if (id !== undefined && prev.explicit)
        add("error", path, `duplicate id "${id}" (first defined at line ${prev.line})`);
      else if (id === undefined && !prev.explicit)
        add("error", path, `duplicate relation "${key}" (first defined at line ${prev.line}); give each of them a distinct "id"`);
      else
        add(
          "error",
          path,
          `duplicate relation key "${key}" (first defined at line ${prev.line}); an id must not equal the generated key of another relation`,
        );
    });
  }

  // Layout: orphaned entries are warnings.
  const layout = isObj(data.layout) ? data.layout : {};
  if (isObj(layout.classes))
    for (const name of Object.keys(layout.classes))
      if (!Object.hasOwn(classes, name))
        add("warning", ["layout", "classes", name], `orphaned layout entry: no class "${name}" in the model`, "key");
  if (isObj(layout.relations))
    for (const key of Object.keys(layout.relations))
      if (!firstByKey.has(key))
        add("warning", ["layout", "relations", key], `orphaned layout entry: no relation "${key}" in the model`, "key");
}

/** Source offset of the node at `path`; falls back to the deepest node that exists. */
function locate(doc: Document, path: Segment[], target: "value" | "key"): number {
  let node: unknown = doc.contents;
  let offset = isNode(node) ? (node.range?.[0] ?? 0) : 0;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]!;
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === String(seg));
      if (!pair) break;
      if (i === path.length - 1 && target === "key" && isNode(pair.key)) return pair.key.range?.[0] ?? offset;
      node = pair.value;
    } else if (isSeq(node)) {
      node = node.items[Number(seg)];
    } else break;
    if (isNode(node) && node.range) offset = node.range[0];
  }
  return offset;
}

/** YAML path of the deepest node whose source range contains `offset`. */
function pathAtOffset(doc: Document, offset: number): Segment[] {
  const path: Segment[] = [];
  let node: unknown = doc.contents;
  const contains = (n: unknown) => isNode(n) && n.range && n.range[0] <= offset && offset <= n.range[1];
  for (;;) {
    if (isMap(node)) {
      const pair = node.items.find((p) => contains(p.key) || contains(p.value));
      if (!pair || !isScalar(pair.key)) break;
      path.push(String(pair.key.value));
      node = contains(pair.key) ? undefined : pair.value;
    } else if (isSeq(node)) {
      const i = node.items.findIndex((it) => contains(it));
      if (i < 0) break;
      path.push(i);
      node = node.items[i];
    } else break;
  }
  return path;
}
