// Scrape skill / support / spirit gems into the DB (en + th).
import { getPage, mapLimit } from "../lib/client.js";
import { discover } from "../lib/discover.js";
import * as P from "../lib/parse.js";
import { getPool, closePool } from "../db/pool.js";
import { upsertItemClass, upsertTag, imageId, replaceMods, applyThaiMods } from "../db/upsert.js";
import { retryOnDeadlock } from "../lib/retry.js";
import { SCRAPE } from "../config.js";

const GEM_INDEXES = [
  ["skill", "us/Skill_Gems"],
  ["support", "us/Support_Gems"],
  ["spirit", "us/Spirit_Gems"],
];

const intOrNull = P.intOrNull;

function deriveReqsFromLevels(levels) {
  const r1 = levels.rows.find((r) => clean(r.Level) === "1") || levels.rows[0] || {};
  const get = (k) => intOrNull(r1[k]);
  return {
    req_level: get("Requires Level"),
    req_str: get("Str"),
    req_dex: get("Dex"),
    req_int: get("Int"),
  };
}
const clean = P.clean;

async function parseGemPage(slug, gemType) {
  const { html, url } = await getPage(`us/${encodeURIComponent(slug)}`);
  if (!html) return null;
  const $ = P.load(html);
  if (!P.mainPopup($).length) return null;

  const name = P.displayName($);
  const tags = P.parseGemTags($);
  const mods = P.parseMods($);
  const levels = P.parseGemLevels($);
  const reqs = deriveReqsFromLevels(levels);
  const itemClass = P.parseItemClass($);
  const description = P.parseGemDescription($);
  const image = P.popupImage($);

  // properties: capture popup property lines (Cost, Attack Speed, etc.)
  const props = {};
  P.mainPopup($)
    .find(".property")
    .each((_, e) => {
      const txt = clean($(e).text());
      const m = txt.match(/^([^:]+):\s*(.*)$/);
      if (m) props[m[1].trim()] = m[2].trim();
    });

  return { slug, name, gemType, tags, mods, levels, reqs, itemClass, description, image, props, url };
}

async function parseThai(slug) {
  const { html } = await getPage(`th/${encodeURIComponent(slug)}`);
  if (!html) return null;
  const $ = P.load(html);
  if (!P.mainPopup($).length) return null;
  return {
    name: P.displayName($),
    description: P.parseGemDescription($),
    mods: P.parseMods($),
    tags: P.parseGemTags($),
  };
}

async function saveGem(g) {
  const pool = getPool();
  const classId = await upsertItemClass(g.itemClass);
  const imgId = await imageId(g.image);

  await pool.execute(
    `INSERT INTO gem (slug,name_en,gem_type,item_class_id,req_level,req_str,req_dex,req_int,
        description_en,properties,image_id,source_url,scraped_at)
     VALUES (:slug,:name,:type,:cls,:rl,:rs,:rd,:ri,:desc,:props,:img,:url,NOW())
     ON DUPLICATE KEY UPDATE name_en=VALUES(name_en),gem_type=VALUES(gem_type),
        item_class_id=VALUES(item_class_id),req_level=VALUES(req_level),req_str=VALUES(req_str),
        req_dex=VALUES(req_dex),req_int=VALUES(req_int),description_en=VALUES(description_en),
        properties=VALUES(properties),image_id=VALUES(image_id),source_url=VALUES(source_url),
        scraped_at=NOW()`,
    {
      slug: g.slug, name: g.name, type: g.gemType, cls: classId,
      rl: g.reqs.req_level, rs: g.reqs.req_str, rd: g.reqs.req_dex, ri: g.reqs.req_int,
      desc: g.description, props: JSON.stringify(g.props), img: imgId, url: g.url,
    }
  );
  const [[row]] = await pool.execute("SELECT id FROM gem WHERE slug=:s", { s: g.slug });
  const gemId = row.id;

  // tags
  await pool.execute("DELETE FROM gem_tag WHERE gem_id=:id", { id: gemId });
  for (const t of g.tags) {
    const tagId = await upsertTag(t);
    if (tagId)
      await pool.execute(
        "INSERT IGNORE INTO gem_tag (gem_id, tag_id) VALUES (:g,:t)",
        { g: gemId, t: tagId }
      );
  }

  // mods
  await replaceMods("gem", gemId, g.mods);

  // level progression
  await pool.execute("DELETE FROM gem_level WHERE gem_id=:id", { id: gemId });
  const known = new Set(["Level", "Requires Level", "Str", "Dex", "Int", "Mana"]);
  for (const r of g.levels.rows) {
    const lvl = intOrNull(r["Level"]);
    if (lvl == null) continue;
    const stats = {};
    for (const [k, v] of Object.entries(r)) if (!known.has(k)) stats[k] = v;
    await pool.execute(
      `INSERT INTO gem_level (gem_id,level,requires_level,req_str,req_dex,req_int,stats)
       VALUES (:g,:l,:rl,:rs,:rd,:ri,:st)
       ON DUPLICATE KEY UPDATE requires_level=VALUES(requires_level),req_str=VALUES(req_str),
         req_dex=VALUES(req_dex),req_int=VALUES(req_int),stats=VALUES(stats)`,
      {
        g: gemId, l: lvl, rl: intOrNull(r["Requires Level"]), rs: intOrNull(r["Str"]),
        rd: intOrNull(r["Dex"]), ri: intOrNull(r["Int"]), st: JSON.stringify(stats),
      }
    );
  }
  return gemId;
}

async function applyThai(gemId, slug) {
  const th = await parseThai(slug);
  if (!th) return;
  const pool = getPool();
  await pool.execute(
    "UPDATE gem SET name_th=:n, description_th=:d WHERE id=:id",
    { n: th.name || null, d: th.description || null, id: gemId }
  );
  await applyThaiMods("gem", gemId, th.mods);
  // tag th names by position is unreliable; skip (tags are language-stable enough)
}

async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const pool = getPool();
  const [run] = await pool.execute(
    "INSERT INTO scrape_run (category, started_at) VALUES ('gems', NOW())"
  );
  const runId = run.insertId;

  // discover
  // A gem may be listed in multiple indexes (e.g. a spirit gem also appears in
  // the skill list). 'spirit' is the most specific category, so let it override
  // a previously-assigned skill/support type; otherwise keep the first type seen.
  const TYPE_PRIORITY = { skill: 0, support: 0, spirit: 1 };
  const found = new Map();
  for (const [type, idx] of GEM_INDEXES) {
    const list = await discover(idx);
    for (const { slug } of list) {
      const prev = found.get(slug);
      if (prev == null || TYPE_PRIORITY[type] > TYPE_PRIORITY[prev]) found.set(slug, type);
    }
    console.log(`discover ${idx}: ${list.length} (cumulative ${found.size})`);
  }
  let entries = [...found];
  if (limit) entries = entries.slice(0, limit);
  console.log(`scraping ${entries.length} gems...`);

  let ok = 0, fail = 0;
  await mapLimit(entries, SCRAPE.concurrency, async ([slug, type], i) => {
    try {
      const g = await parseGemPage(slug, type);
      if (!g || !g.name) { fail++; return; }
      const gemId = await retryOnDeadlock(() => saveGem(g));
      await retryOnDeadlock(() => applyThai(gemId, slug));
      ok++;
      if (ok % 25 === 0) console.log(`  ${ok}/${entries.length} ok (latest: ${g.name})`);
    } catch (err) {
      fail++;
      console.warn(`  FAIL ${slug}: ${err.message}`);
    }
  });

  await pool.execute(
    "UPDATE scrape_run SET finished_at=NOW(), total=:t, ok_count=:o, fail_count=:f WHERE id=:id",
    { t: entries.length, o: ok, f: fail, id: runId }
  );
  console.log(`done. ok=${ok} fail=${fail}`);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
