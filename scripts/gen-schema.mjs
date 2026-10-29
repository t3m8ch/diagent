// Writes schema/diagent.schema.json from the compiled src/schema.ts (run after tsc).
import { mkdirSync, writeFileSync } from "node:fs";
import { schema } from "../dist/schema.js";

mkdirSync(new URL("../schema/", import.meta.url), { recursive: true });
writeFileSync(new URL("../schema/diagent.schema.json", import.meta.url), JSON.stringify(schema, null, 2) + "\n");
