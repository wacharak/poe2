// Scrape affix modifiers (prefix/suffix pools) per item class into the DB (en + th).
// Data source: each item-class page (e.g. /us/Claws) embeds the full affix pool inline
// in a `new ModsView({...})` JSON blob; poe2db renders it client-side via Mustache.
import { getPage } from "../lib/client.js";
import * as P from "../lib/parse.js";
import { getPool, closePool } from "../db/pool.js";
import { upsertItemClass } from "../db/upsert.js";
import { retryOnDeadlock } from "../lib/retry.js";
import { SCRAPE } from "../config.js";
import { mapLimit } from "../lib/client.js";

// Keys in the ModsView object that are metadata, not affix-source arrays.
const META_KEYS = new Set(["baseitem", "config", "gen", "opt"]);

// Per-page `gen` only maps Prefix/Suffix; this resolves the other PoE
// ModGenerationType ids (e.g. corrupted implicits) to readable labels.
const GEN_TYPES = { 1: "Prefix", 2: "Suffix", 3: "Unique", 5: "Corrupted", 10: "Enchantment", 11: "Essence" };

// Turn poe2db's `str` HTML into a clean stat line, preserving value ranges.
function statText(str) {
  if (!str) return null;
  const txt = P.stripMarkup(str)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  return txt.trim() || null;
}

// Pull the stable mod id out of a hover link like "?s=Data%5CMods%2FDexterity1".
function modKey(hover) {
  if (!hover) return null;
  let s;
  try { s = decodeURIComponent(hover); } catch { s = hover; }
  const m = s.match(/Mods[\\/]+([^\\/?"]+)/);
  return m ? m[1] : null;
}

// Flatten a ModsView blob into [{key, name, gen, family, level, weight, stat, source}].
function extractMods(data) {
  const gen = data.gen || {};
  const out = [];
  for (const [source, list] of Object.entries(data)) {
    if (META_KEYS.has(source) || !Array.isArray(list) || !list.length) continue;
    for (const m of list) {
      const key = modKey(m.hover);
      if (!key) continue; // affixes without a stable id (rare specials) are skipped
      out.push({
        key,
        name: m.Name || null,
        gen: gen[m.ModGenerationTypeID] || GEN_TYPES[m.ModGenerationTypeID] || (m.ModGenerationTypeID ?? null),
        family: Array.isArray(m.ModFamilyList) ? m.ModFamilyList.join(",") || null : null,
        level: P.intOrNull(m.Level),
        weight: typeof m.DropChance === "number" ? m.DropChance : null,
        stat: statText(m.str),
        source,
      });
    }
  }
  return out;
}

async function saveClassMods(classId, mods, domain) {
  const pool = getPool();
  let saved = 0;
  for (const m of mods) {
    await pool.execute(
      `INSERT INTO affix (mod_key,name_en,generation_type,family,required_level,stat_text_en,domain)
       VALUES (:k,:n,:g,:f,:l,:s,:d)
       ON DUPLICATE KEY UPDATE name_en=VALUES(name_en),generation_type=VALUES(generation_type),
         family=VALUES(family),required_level=VALUES(required_level),
         stat_text_en=VALUES(stat_text_en),domain=COALESCE(VALUES(domain),domain)`,
      { k: m.key, n: m.name, g: m.gen, f: m.family, l: m.level, s: m.stat, d: domain }
    );
    const [[row]] = await pool.execute("SELECT id FROM affix WHERE mod_key=:k", { k: m.key });
    await pool.execute(
      `INSERT INTO affix_item_class (affix_id,item_class_id,source,weight)
       VALUES (:m,:c,:src,:w)
       ON DUPLICATE KEY UPDATE weight=VALUES(weight)`,
      { m: row.id, c: classId, src: m.source, w: m.weight }
    );
    saved++;
  }
  return saved;
}

async function applyThai(slug) {
  const { html } = await getPage(`th/${encodeURIComponent(slug)}`);
  const data = P.extractModsViewData(html);
  if (!data) return 0;
  const pool = getPool();
  let n = 0;
  for (const m of extractMods(data)) {
    const [res] = await pool.execute(
      "UPDATE affix SET name_th=:n, stat_text_th=:s WHERE mod_key=:k",
      { n: m.name, s: m.stat, k: m.key }
    );
    n += res.affectedRows ? 1 : 0;
  }
  return n;
}

// Item-class pages that carry a Modifiers Calc section, discovered from /us/Modifiers.
async function discoverClassPages() {
  const { html } = await getPage("us/Modifiers");
  const $ = P.load(html);
  const out = new Map();
  $("a[href*='#ModifiersCalc']").each((_, a) => {
    const href = $(a).attr("href") || "";
    const m = href.match(/\/us\/([^#]+)#ModifiersCalc/);
    if (!m) return;
    const slug = decodeURIComponent(m[1]);
    if (slug && !out.has(slug)) out.set(slug, P.clean($(a).text()) || slug);
  });
  return [...out].map(([slug, name]) => ({ slug, name }));
}

async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const pool = getPool();
  const [run] = await pool.execute("INSERT INTO scrape_run (category, started_at) VALUES ('mods', NOW())");
  const runId = run.insertId;

  let pages = await discoverClassPages();
  console.log(`discovered ${pages.length} item-class modifier pages`);
  if (limit) pages = pages.slice(0, limit);

  let ok = 0, skip = 0, fail = 0, totalMods = 0;
  await mapLimit(pages, SCRAPE.concurrency, async ({ slug, name }) => {
    try {
      const { html } = await getPage(`us/${encodeURIComponent(slug)}`);
      const data = P.extractModsViewData(html);
      if (!data) { skip++; return; }
      const classId = await upsertItemClass(name || slug);
      const mods = extractMods(data);
      const domain = data.opt?.ModDomainsID != null ? String(data.opt.ModDomainsID) : null;
      const saved = await retryOnDeadlock(() => saveClassMods(classId, mods, domain));
      await retryOnDeadlock(() => applyThai(slug));
      totalMods += saved;
      ok++;
      console.log(`  ${slug}: ${saved} mod rows (classId ${classId})`);
    } catch (err) {
      fail++;
      console.warn(`  FAIL ${slug}: ${err.message}`);
    }
  });

  const [[{ n: distinct }]] = await pool.query("SELECT COUNT(*) n FROM affix");
  await pool.execute(
    "UPDATE scrape_run SET finished_at=NOW(), total=:t, ok_count=:o, fail_count=:f, note=:n WHERE id=:id",
    { t: pages.length, o: ok, f: fail, n: `${distinct} distinct mods; skipped ${skip}`, id: runId }
  );
  console.log(`done. pages ok=${ok} skip=${skip} fail=${fail}; distinct mods=${distinct}`);
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
