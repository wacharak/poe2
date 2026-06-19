// Inspect saved HTML structure with cheerio.
// Usage: node scripts/recon.js scratch/file.html
import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";

const file = process.argv[2];
const html = await readFile(file, "utf8");
const $ = cheerio.load(html);

console.log("TITLE:", $("title").text().trim());

// Headings give the section layout
console.log("\n=== Headings (h1-h4) ===");
$("h1,h2,h3,h4").slice(0, 40).each((_, el) => {
  const t = $(el).text().trim().replace(/\s+/g, " ");
  if (t) console.log(`  <${el.tagName}> ${t.slice(0, 90)}`);
});

// Tables
console.log(`\n=== Tables: ${$("table").length} ===`);
$("table").slice(0, 8).each((i, el) => {
  const $t = $(el);
  const cls = $t.attr("class") || "";
  const id = $t.attr("id") || "";
  const headers = $t.find("thead th, tr:first-child th").map((_, th) => $(th).text().trim()).get();
  const rows = $t.find("tbody tr").length || $t.find("tr").length;
  console.log(`  [${i}] id="${id}" class="${cls}" rows=${rows}`);
  if (headers.length) console.log(`      headers: ${headers.join(" | ").slice(0, 140)}`);
});

// Links matching /us/ item-like pages, count by pattern
console.log("\n=== Sample internal /us/ links ===");
const links = new Map();
$("a[href^='/us/']").each((_, el) => {
  const href = $(el).attr("href");
  const txt = $(el).text().trim().replace(/\s+/g, " ");
  if (!links.has(href)) links.set(href, txt);
});
console.log(`  unique /us/ links: ${links.size}`);
let n = 0;
for (const [href, txt] of links) {
  if (n++ > 25) break;
  console.log(`  ${href}  ::  ${txt.slice(0, 50)}`);
}

// Images
console.log("\n=== Sample images ===");
const imgs = new Set();
$("img").each((_, el) => {
  const s = $(el).attr("src") || $(el).attr("data-src");
  if (s) imgs.add(s);
});
[...imgs].slice(0, 10).forEach((s) => console.log("  " + s));
console.log(`  total imgs: ${imgs.size}`);
