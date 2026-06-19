// Fetch raw HTML samples from poe2db.tw for structural inspection.
// Usage: node scripts/fetch-sample.js <path-under-poe2db.tw> [outfile]
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const rel = process.argv[2];
if (!rel) {
  console.error("need a path, e.g. us/Lightning_Arrow");
  process.exit(1);
}
const url = `https://poe2db.tw/${rel}`;
const out =
  process.argv[3] ||
  path.join("scratch", rel.replace(/[^a-zA-Z0-9]+/g, "_") + ".html");

const res = await fetch(url, { headers: { "User-Agent": UA } });
const html = await res.text();
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`status=${res.status} bytes=${html.length} -> ${out}`);
