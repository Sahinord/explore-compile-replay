// Checks that every relative link of the Markdown pages points to a file that exists,
// and that every #anchor names a heading or an <a name> of its page. Offline: web links are not followed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const skip = new Set(["node_modules", ".git", "dist"]);

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (skip.has(name)) return [];
    if (statSync(path).isDirectory()) return pages(path);
    return name.endsWith(".md") ? [path] : [];
  });
}

function withoutCode(text: string): string {
  return text.replace(/^```[\s\S]*?^```/gm, "").replace(/`[^`\n]*`/g, "");
}

function slug(heading: string): string {
  const text = heading.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "");
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}

const anchorsOf = new Map<string, Set<string>>();
function anchors(page: string): Set<string> {
  if (!anchorsOf.has(page)) {
    const text = withoutCode(readFileSync(page, "utf8"));
    const found = new Set<string>();
    for (const [, heading] of text.matchAll(/^#{1,6}\s+(.+)$/gm)) found.add(slug(heading));
    for (const [, name] of text.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) found.add(name);
    anchorsOf.set(page, found);
  }
  return anchorsOf.get(page)!;
}

const broken: string[] = [];
for (const page of pages(root)) {
  const text = withoutCode(readFileSync(page, "utf8"));
  const links = [
    ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/(?:href|src|srcset)="([^"]+)"/g)].map((m) => m[1]),
  ];
  for (const link of links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
    const [path, anchor] = link.split("#");
    const target = path ? normalize(join(dirname(page), decodeURI(path))) : page;
    const where = `${relative(root, page)}: ${link}`;
    if (!existsSync(target)) broken.push(`${where} (no such file)`);
    else if (anchor && target.endsWith(".md") && !anchors(target).has(anchor)) broken.push(`${where} (no such anchor)`);
  }
}

if (broken.length) {
  console.error(`${broken.length} broken links:\n${broken.join("\n")}`);
  process.exit(1);
}
console.log("links: every relative link of the Markdown pages points to a file and an anchor that exist");
