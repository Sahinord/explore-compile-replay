/**
 * Records the example exploration, compiles it, and checks the reference
 * adapter against the seven laws.
 *
 *   pnpm conformance           print the report, fail if a law fails
 *   pnpm conformance --write   also rewrite the files in examples/
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkAdapter, conforms, formatReport } from "../conformance/src/index.ts";
import { record } from "../core/src/index.ts";
import { createFixtureAdapter } from "./src/adapter.ts";
import { exampleExploration, exampleValues } from "./src/example.ts";

const adapter = createFixtureAdapter();
const trace = await record(adapter, exampleExploration);

if (process.argv.includes("--write")) {
  const dir = join(import.meta.dirname, "examples");
  writeFileSync(join(dir, `${trace.id}.trace.json`), `${JSON.stringify(trace, null, 2)}\n`);
  for (const target of adapter.targets) {
    const artifact = target.compile(trace);
    writeFileSync(join(dir, artifact.path), artifact.content);
  }
}

const results = await checkAdapter(adapter, [{ trace, params: exampleValues }]);
console.log(`Conformance of adapter "${adapter.id}"\n`);
console.log(formatReport(results));
if (!conforms(results)) process.exit(1);
