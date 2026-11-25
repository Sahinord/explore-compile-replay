/**
 * Writes the JSON Schemas generated from the TypeScript sources.
 *
 *   pnpm schema           rewrite the files
 *   pnpm schema --check   fail if a file is not what the sources give today
 *
 * The JSON Schemas are for editors and for tools that are not written in
 * TypeScript. The `.ts` files stay the source of truth.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { actions, oracles } from "../packages/adapter-maestro/src/adapter.ts";
import { TRACE_SCHEMA, Trace } from "./schema.ts";

const root = join(import.meta.dirname, "..");
const base = "https://github.com/pierridotite/explore-compile-replay/blob/main/";

const files: { path: string; schema: object }[] = [
  {
    path: "spec/trace.schema.json",
    schema: { ...z.toJSONSchema(Trace, { io: "input" }), title: `Explore-Compile-Replay trace (${TRACE_SCHEMA})` },
  },
  {
    path: "packages/adapter-maestro/vocabulary.schema.json",
    schema: {
      ...z.toJSONSchema(z.object({ action: actions, oracle: oracles }), { io: "input" }),
      title: "Mobile vocabulary: what a step may do (action) and what a checkpoint may check (oracle)",
    },
  },
];

let stale = false;
for (const { path, schema } of files) {
  const file = join(root, path);
  const content = `${JSON.stringify({ ...schema, $id: base + path }, null, 2)}\n`;
  if (!process.argv.includes("--check")) {
    writeFileSync(file, content);
    console.log(`wrote ${path}`);
    continue;
  }
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    // A missing file is reported like a stale one.
  }
  if (current === content) {
    console.log(`ok    ${path} is up to date`);
  } else {
    stale = true;
    console.error(`${path} is not up to date. Run: pnpm schema`);
  }
}
if (stale) process.exit(1);
