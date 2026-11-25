/**
 * Counts the lines of each adapter: lines of its `src/` files that are
 * neither blank nor comments. One count per file, so that a reader can
 * leave out what is not the adapter (the toy system, the example data).
 *
 *   pnpm size          a table
 *   pnpm size --json   the same as JSON, for a result file
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Lines that hold code. A line that ends a block comment and then holds code counts. */
export function codeLines(source: string): number {
  let inBlock = false;
  let count = 0;
  for (const raw of source.split("\n")) {
    let line = raw.trim();
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      inBlock = false;
      line = line.slice(end + 2).trim();
    }
    // Remove the block comments that open and close on this line, then see what is left.
    line = line.replace(/\/\*.*?\*\//g, "").trim();
    const open = line.indexOf("/*");
    if (open !== -1) {
      inBlock = true;
      line = line.slice(0, open).trim();
    }
    if (line !== "" && !line.startsWith("//")) count += 1;
  }
  return count;
}

const packages = join(import.meta.dirname, "..", "packages");
const adapters = readdirSync(packages)
  .filter((name) => name.startsWith("adapter-"))
  .sort()
  .map((name) => {
    const src = join(packages, name, "src");
    const files = readdirSync(src)
      .filter((file) => file.endsWith(".ts"))
      .sort()
      .map((file) => ({ file: `packages/${name}/src/${file}`, lines: codeLines(readFileSync(join(src, file), "utf8")) }));
    return { adapter: name, lines: files.reduce((sum, entry) => sum + entry.lines, 0), files };
  });

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ measure: "lines that are neither blank nor comments", adapters }, null, 2));
} else {
  for (const adapter of adapters) {
    console.log(`${adapter.adapter}  ${adapter.lines}`);
    for (const entry of adapter.files) console.log(`  ${String(entry.lines).padStart(5)}  ${entry.file}`);
  }
}
