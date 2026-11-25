/**
 * Prints what Maestro recorded for each flow of a device run: one line per
 * command, with its status. The demo app holds no private data, so this
 * can go to a public log. Do not use it on a run against a real app.
 *
 *   node packages/adapter-maestro/device/record.ts <folder kept by ECR_MAESTRO_DEBUG>
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const root = process.argv[2];
if (root === undefined || !existsSync(root)) {
  console.log("No record: Maestro did not run, or wrote nothing.");
  process.exit(0);
}
const all = files(root);
console.log(`${all.length} files kept:`);
for (const path of all) console.log(`  ${path.slice(root.length + 1)}`);
for (const path of all.filter((entry) => /commands[^/]*\.json$/.test(entry))) {
  console.log(`\n== ${path.slice(root.length + 1)}`);
  const text = readFileSync(path, "utf8");
  try {
    const entries = JSON.parse(text) as { command?: Record<string, unknown>; metadata?: Record<string, unknown> }[];
    for (const entry of entries) {
      const error = (entry.metadata?.error as { message?: string } | undefined)?.message;
      console.log(
        `${String(entry.metadata?.status).padEnd(10)} ${Object.keys(entry.command ?? {}).join("+")}${error === undefined ? "" : `  ${error.replace(/\s+/g, " ").slice(0, 200)}`}`,
      );
    }
  } catch {
    console.log(`not a JSON list. It starts with: ${text.slice(0, 300)}`);
  }
}
