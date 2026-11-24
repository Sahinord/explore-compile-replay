/** Validates every example in spec/examples against the schema. Run: pnpm check:examples */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Trace } from "./schema.ts";

const dir = join(import.meta.dirname, "examples");
const files = readdirSync(dir).filter((name) => name.endsWith(".trace.json"));
let failed = 0;

for (const name of files) {
  const result = Trace.safeParse(JSON.parse(readFileSync(join(dir, name), "utf8")));
  if (result.success) {
    console.log(`ok    ${name} (${result.data.steps.length} steps)`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}`);
    for (const issue of result.error.issues) {
      console.error(`      ${issue.path.join(".")}: ${issue.message}`);
    }
  }
}

if (files.length === 0 || failed > 0) process.exit(1);
