/**
 * Records the example exploration, compiles it, and checks the reference
 * adapter against the seven laws.
 *
 *   pnpm conformance           print the report, fail if a law fails
 *   pnpm conformance --write   also rewrite the files in examples/
 *
 * The second example records a bug. It is explored on a system that has
 * the bug, and it is written to examples/ too.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkAdapter, conforms, formatReport } from "../conformance/src/index.ts";
import { record } from "../core/src/index.ts";
import { createFixtureAdapter } from "./src/adapter.ts";
import { bugExploration, exampleExploration, exampleValues } from "./src/example.ts";
import buggy from "./test/systems/buggy-adapter.ts";

const adapter = createFixtureAdapter();
const trace = await record(adapter, exampleExploration);

const bug = await record(buggy, bugExploration);

if (process.argv.includes("--write")) {
  const dir = join(import.meta.dirname, "examples");
  for (const example of [trace, bug]) {
    writeFileSync(join(dir, `${example.id}.trace.json`), `${JSON.stringify(example, null, 2)}\n`);
    for (const target of adapter.targets) {
      const artifact = target.compile(example);
      writeFileSync(join(dir, artifact.path), artifact.content);
    }
  }
}

const results = await checkAdapter(adapter, [{ trace, params: exampleValues }]);
console.log(`Conformance of adapter "${adapter.id}"\n`);
console.log(formatReport(results));

const withBug = await checkAdapter(buggy, [{ trace: bug }]);
console.log(`\nThe same adapter on a system with a bug, with a trace that records it\n`);
console.log(formatReport(withBug));
if (!conforms(results) || !conforms(withBug)) process.exit(1);
