// Scrape base item types into the DB (en + th).
// Discovery: crawl equipment category hubs, then classify each page as a base
// by the presence of the raw "Base.base_level" game-data field.
import { getPage, mapLimit } from "../lib/client.js";
import { discover } from "../lib/discover.js";
import * as P from "../lib/parse.js";
import { getPool, closePool } from "../db/pool.js";
import { upsertItemClass, imageId, replaceMods, applyThaiMods } from "../db/upsert.js";
import { retryOnDeadlock } from "../lib/retry.js";
import { SCRAPE } from "../config.js";

const CATEGORY_HUBS = [
  "us/Weapon", "us/Armour", "us/Martial_Weapons", "us/Caster_Weapons",
  "us/Rings", "us/Amulets", "us/Belts", "us/Shields", "us/Focus",
  "us/Gloves", "us/Boots", "us/Flasks", "us/Charms", "us/Jewels", "us/Quivers",
];

// Keep these raw game-data groups in the properties JSON.
const KV_KEEP = /^(Base\.|Weapon\.|Armour\.|Shield\.|Quality\.|Sockets\.|AttributeRequirements\.)/;

async function parseBasePage(slug) {
  const { html, url } = await getPage(`us/${encodeURIComponent(slug)}`);
  if (!html) return null;
  const $ = P.load(html);
  if (!P.mainPopup($).length) return null;
  const kv = P.parseKeyValTable($);
  if (kv["Base.base_level"] === undefined) return null; // not a base type page
  const meta = P.parseMetaTable($);
  const reqs = P.reqsFromKeyVal(kv);

  const props = P.parsePropertyLines($);
  for (const [k, v] of Object.entries(kv)) if (KV_KEEP.test(k)) props[k] = v;
  if (meta.Tags) props.tags = meta.Tags;
  if (meta.Type) props.type_path = meta.Type;

  const itemClass = meta.Class || (Object.values(P.parsePropertyLines($))[0] || null);
  return {
    slug,
    // Jewel/tablet/relic pages render as normalPopup where displayName picks up a
    // section header ("Crafting Project"); meta.BaseType is the reliable base name.
    name: meta.BaseType || P.displayName($),
    itemClass: meta.Class || null,
    dropLevel: reqs.drop_level ?? P.intOrNull(meta.DropLevel),
    reqs,
    props,
    mods: P.parseMods($),
    image: P.popupImage($),
    url,
  };
}

async function parseThai(slug) {
  const { html } = await getPage(`th/${encodeURIComponent(slug)}`);
  if (!html) return null;
  const $ = P.load(html);
  if (!P.mainPopup($).length) return null;
  const meta = P.parseMetaTable($);
  return { name: meta.BaseType || P.displayName($), mods: P.parseMods($) };
}

async function save(b) {
  const pool = getPool();
  const classId = await upsertItemClass(b.itemClass);
  const imgId = await imageId(b.image);
  await pool.execute(
    `INSERT INTO base_item (slug,name_en,item_class_id,drop_level,req_level,req_str,req_dex,req_int,
        properties,image_id,source_url,scraped_at)
     VALUES (:slug,:name,:cls,:dl,:rl,:rs,:rd,:ri,:props,:img,:url,NOW())
     ON DUPLICATE KEY UPDATE name_en=VALUES(name_en),item_class_id=VALUES(item_class_id),
        drop_level=VALUES(drop_level),req_level=VALUES(req_level),req_str=VALUES(req_str),
        req_dex=VALUES(req_dex),req_int=VALUES(req_int),properties=VALUES(properties),
        image_id=VALUES(image_id),source_url=VALUES(source_url),scraped_at=NOW()`,
    {
      slug: b.slug, name: b.name, cls: classId, dl: b.dropLevel,
      rl: b.dropLevel, rs: b.reqs.req_str, rd: b.reqs.req_dex, ri: b.reqs.req_int,
      props: JSON.stringify(b.props), img: imgId, url: b.url,
    }
  );
  const [[row]] = await pool.execute("SELECT id FROM base_item WHERE slug=:s", { s: b.slug });
  await replaceMods("base_item", row.id, b.mods);
  return row.id;
}

async function applyThai(id, slug) {
  const th = await parseThai(slug);
  if (!th) return;
  const pool = getPool();
  await pool.execute("UPDATE base_item SET name_th=:n WHERE id=:id", { n: th.name || null, id });
  await applyThaiMods("base_item", id, th.mods);
}

async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const pool = getPool();
  const [run] = await pool.execute("INSERT INTO scrape_run (category, started_at) VALUES ('bases', NOW())");
  const runId = run.insertId;

  // discover candidate slugs from hubs
  const cand = new Set();
  for (const hub of CATEGORY_HUBS) {
    const list = await discover(hub);
    list.forEach(({ slug }) => cand.add(slug));
    console.log(`hub ${hub}: ${list.length} (candidates ${cand.size})`);
  }
  // also seed base slugs derived from the base names referenced by uniques
  const [ubn] = await pool.query(
    "SELECT DISTINCT base_name_en FROM unique_item WHERE base_name_en IS NOT NULL"
  );
  for (const { base_name_en } of ubn) {
    cand.add(base_name_en.replace(/'/g, "").replace(/\s+/g, "_"));
  }
  console.log(`+ ${ubn.length} base names from uniques (candidates ${cand.size})`);
  // skip slugs already known as gems or uniques (cheap pre-filter)
  const [gem] = await pool.query("SELECT slug FROM gem");
  const [uniq] = await pool.query("SELECT slug FROM unique_item");
  const known = new Set([...gem, ...uniq].map((r) => r.slug));
  let entries = [...cand].filter((s) => !known.has(s));
  if (limit) entries = entries.slice(0, limit);
  console.log(`classifying ${entries.length} candidate pages...`);

  let ok = 0, skip = 0, fail = 0;
  await mapLimit(entries, SCRAPE.concurrency, async (slug) => {
    try {
      const b = await parseBasePage(slug);
      if (!b) { skip++; return; }
      const id = await retryOnDeadlock(() => save(b));
      await retryOnDeadlock(() => applyThai(id, slug));
      ok++;
      if (ok % 25 === 0) console.log(`  ${ok} bases (latest: ${b.name})`);
    } catch (err) {
      fail++;
      console.warn(`  FAIL ${slug}: ${err.message}`);
    }
  });

  // link uniques to their base type now that bases exist
  const [link] = await pool.query(
    "UPDATE unique_item u JOIN base_item b ON b.name_en = u.base_name_en " +
      "SET u.base_item_id = b.id, u.item_class_id = b.item_class_id"
  );
  console.log(`linked ${link.affectedRows} uniques to base types`);

  await pool.execute(
    "UPDATE scrape_run SET finished_at=NOW(), total=:t, ok_count=:o, fail_count=:f, note=:n WHERE id=:id",
    { t: entries.length, o: ok, f: fail, n: `skipped ${skip} non-base; linked ${link.affectedRows} uniques`, id: runId }
  );
  console.log(`done. bases=${ok} skipped=${skip} fail=${fail}`);
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
