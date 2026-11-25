/**
 * Writes the JSON Schema of a trace, generated from `schema.ts`.
 *
 *   pnpm schema           rewrite spec/trace.schema.json
 *   pnpm schema --check   fail if the file is not what `schema.ts` gives today
 *
 * The JSON Schema is for editors and for tools that are not written in
 * TypeScript. `schema.ts` stays the source of truth.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { TRACE_SCHEMA, Trace } from "./schema.ts";

const file = join(import.meta.dirname, "trace.schema.json");
const schema = {
  ...z.toJSONSchema(Trace, { io: "input" }),
  $id: "https://github.com/pierridotite/explore-compile-replay/blob/main/spec/trace.schema.json",
  title: `Explore-Compile-Replay trace (${TRACE_SCHEMA})`,
};
const content = `${JSON.stringify(schema, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    // A missing file is reported like a stale one.
  }
  if (current !== content) {
    console.error("spec/trace.schema.json is not up to date. Run: pnpm schema");
    process.exit(1);
  }
  console.log("ok    trace.schema.json is up to date");
} else {
  writeFileSync(file, content);
  console.log("wrote spec/trace.schema.json");
}
