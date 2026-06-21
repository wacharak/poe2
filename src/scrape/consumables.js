// Scrape Omens / Essences / Catalysts into currency_item (en + th).
// These are stackable crafting consumables that share the .newItemPopup detail
// shape with orbs, so they reuse the currency_item table. Their item_class
// (Omen / Essence / Catalyst) is read straight off the popup, which lets the
// build-guide tooling filter them apart from plain orbs later.
//
// Usage:  node src/scrape/consumables.js [omen|essence|catalyst|all] [limit]
import { getPage, mapLimit } from "../lib/client.js";
import * as P from "../lib/parse.js";
import { getPool, closePool } from "../db/pool.js";
import { upsertItemClass, imageId } from "../db/upsert.js";
import { retryOnDeadlock } from "../lib/retry.js";
import { SCRAPE } from "../config.js";

// index page + anchor selectors that mark a detail link on that page.
const CATEGORIES = {
  omen: { index: "us/Omen", selectors: ["a.whiteitem.Omen", "a.whiteitem"] },
  essence: { index: "us/Essence", selectors: ["a.item_currency"] },
  catalyst: { index: "us/Catalysts", selectors: ["a.item_currency", "a.whiteitem"] },
};

const KV_KEEP = /^(Base\.|Quality\.|Stack\.)/;
const normSlug = (href) =>
  decodeURIComponent((href || "").replace(/^\/us\//, "").replace(/^\//, ""));

async function discover(cat) {
  const { html } = await getPage(cat.index);
  if (!html) return [];
  const $ = P.load(html);
  const slugs = new Set();
  for (const sel of cat.selectors) {
    $(sel).each((_, a) => {
      const slug = normSlug($(a).attr("href"));
      if (slug && !slug.includes("/") && !slug.includes("#")) slugs.add(slug);
    });
    if (slugs.size) break; // first selector that matches wins
  }
  return [...slugs];
}

function propertyLines($) {
  return P.mainPopup($)
    .find(".property")
    .map((_, e) => P.clean($(e).text()))
    .get()
    .filter(Boolean);
}

function stackSize(lines) {
  for (const t of lines) {
    const m = /Stack Size:\s*\d+\s*\/\s*(\d+)/i.exec(t);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

async function parsePage(lang, slug) {
  const { html } = await getPage(`${lang}/${encodeURIComponent(slug)}`);
  if (!html) return null;
  const $ = P.load(html);
  if (!P.mainPopup($).length) return null;
  const lines = propertyLines($);
  const props = P.parsePropertyLines($);
  const kv = P.parseKeyValTable($);
  for (const [k, v] of Object.entries(kv)) if (KV_KEEP.test(k)) props[k] = v;
  const itemClass =
    P.parseItemClass($) || lines.find((t) => !t.includes(":")) || null;
  const effect =
    P.parseMods($).explicit.join("\n") ||
    P.mainPopup($)
      .find(".default.fst-italic")
      .map((_, e) => P.clean($(e).text()))
      .get()
      .join("\n") ||
    null;
  return {
    slug,
    name: P.displayName($),
    itemClass,
    stackSize: stackSize(lines),
    effect,
    props,
    image: P.popupImage($),
    url: `https://poe2db.tw/${lang}/${encodeURIComponent(slug)}`,
  };
}

async function save(c) {
  const pool = getPool();
  const classId = await upsertItemClass(c.itemClass);
  const imgId = await imageId(c.image);
  await pool.execute(
    `INSERT INTO currency_item (slug,name_en,item_class_id,stack_size,effect_en,properties,image_id,source_url,scraped_at)
     VALUES (:slug,:name,:cls,:stack,:eff,:props,:img,:url,NOW())
     ON DUPLICATE KEY UPDATE name_en=VALUES(name_en),item_class_id=VALUES(item_class_id),
        stack_size=VALUES(stack_size),effect_en=VALUES(effect_en),properties=VALUES(properties),
        image_id=VALUES(image_id),source_url=VALUES(source_url),scraped_at=NOW()`,
    {
      slug: c.slug, name: c.name, cls: classId, stack: c.stackSize,
      eff: c.effect, props: JSON.stringify(c.props), img: imgId, url: c.url,
    }
  );
  const [[row]] = await pool.execute("SELECT id FROM currency_item WHERE slug=:s", { s: c.slug });
  return row.id;
}

async function applyThai(id, slug) {
  const th = await parsePage("th", slug);
  if (!th) return;
  const pool = getPool();
  await pool.execute(
    "UPDATE currency_item SET name_th=:n, effect_th=:e WHERE id=:id",
    { n: th.name || null, e: th.effect || null, id }
  );
}

async function scrapeCategory(key, limit) {
  const cat = CATEGORIES[key];
  let slugs = await discover(cat);
  if (limit) slugs = slugs.slice(0, limit);
  console.log(`[${key}] discovered ${slugs.length} slugs`);
  let ok = 0, skip = 0, fail = 0;
  await mapLimit(slugs, SCRAPE.concurrency, async (slug) => {
    try {
      const c = await parsePage("us", slug);
      if (!c) { skip++; return; }
      const id = await retryOnDeadlock(() => save(c));
      await retryOnDeadlock(() => applyThai(id, slug));
      ok++;
      if (ok % 20 === 0) console.log(`  [${key}] ${ok} (latest: ${c.name})`);
    } catch (err) {
      fail++;
      console.warn(`  [${key}] FAIL ${slug}: ${err.message}`);
    }
  });
  console.log(`[${key}] done ok=${ok} skip=${skip} fail=${fail}`);
  return { ok, skip, fail, total: slugs.length };
}

async function main() {
  const which = (process.argv[2] || "all").toLowerCase();
  const limit = process.argv[3] ? parseInt(process.argv[3], 10) : null;
  const keys = which === "all" ? Object.keys(CATEGORIES) : [which];
  const pool = getPool();
  const [run] = await pool.execute(
    "INSERT INTO scrape_run (category, started_at) VALUES (:c, NOW())",
    { c: `consumables:${which}` }
  );
  const runId = run.insertId;

  let tot = { ok: 0, skip: 0, fail: 0, total: 0 };
  for (const k of keys) {
    if (!CATEGORIES[k]) { console.warn(`unknown category: ${k}`); continue; }
    const r = await scrapeCategory(k, limit);
    for (const f of Object.keys(tot)) tot[f] += r[f];
  }

  await pool.execute(
    "UPDATE scrape_run SET finished_at=NOW(), total=:t, ok_count=:o, fail_count=:f, note=:n WHERE id=:id",
    { t: tot.total, o: tot.ok, f: tot.fail, n: `skipped ${tot.skip} (${which})`, id: runId }
  );
  console.log(`ALL done. ok=${tot.ok} skip=${tot.skip} fail=${tot.fail}`);
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
