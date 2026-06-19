// Scrape unique items into the DB (en + th).
import { getPage, mapLimit } from "../lib/client.js";
import { discover } from "../lib/discover.js";
import * as P from "../lib/parse.js";
import { getPool, closePool } from "../db/pool.js";
import { imageId, replaceMods, applyThaiMods } from "../db/upsert.js";
import { retryOnDeadlock } from "../lib/retry.js";
import { SCRAPE } from "../config.js";

async function parseUniquePage(slug) {
  const { html, url } = await getPage(`us/${encodeURIComponent(slug)}`);
  if (!html) return null;
  const $ = P.load(html);
  const popup = P.mainPopup($);
  if (!popup.length) return null;
  // The Unique_item index also links skill-gem pages (e.g. Power Siphon, Herald of Ash).
  // Those render as GemPopup, not UniquePopup — skip them so they don't pollute unique_item.
  if (!/\bUniquePopup\b/.test(popup.attr("class") || "")) return null;

  const names = P.popupNames($);
  const meta = P.parseMetaTable($);
  const props = P.parsePropertyLines($);
  return {
    slug,
    name: names[0] || P.displayName($),
    baseName: meta.BaseType || names[1] || null,
    reqs: P.parseRequirements($),
    flavour: P.parseFlavour($),
    mods: P.parseMods($),
    props,
    image: P.popupImage($),
    url,
  };
}

async function parseThai(slug) {
  const { html } = await getPage(`th/${encodeURIComponent(slug)}`);
  if (!html) return null;
  const $ = P.load(html);
  if (!P.mainPopup($).length) return null;
  return { name: P.popupNames($)[0] || P.displayName($), flavour: P.parseFlavour($), mods: P.parseMods($) };
}

async function save(u) {
  const pool = getPool();
  const imgId = await imageId(u.image);
  await pool.execute(
    `INSERT INTO unique_item (slug,name_en,base_name_en,req_level,req_str,req_dex,req_int,
        properties,flavour_en,image_id,source_url,scraped_at)
     VALUES (:slug,:name,:base,:rl,:rs,:rd,:ri,:props,:fl,:img,:url,NOW())
     ON DUPLICATE KEY UPDATE name_en=VALUES(name_en),base_name_en=VALUES(base_name_en),
        req_level=VALUES(req_level),req_str=VALUES(req_str),req_dex=VALUES(req_dex),
        req_int=VALUES(req_int),properties=VALUES(properties),flavour_en=VALUES(flavour_en),
        image_id=VALUES(image_id),source_url=VALUES(source_url),scraped_at=NOW()`,
    {
      slug: u.slug, name: u.name, base: u.baseName,
      rl: u.reqs.req_level, rs: u.reqs.req_str, rd: u.reqs.req_dex, ri: u.reqs.req_int,
      props: JSON.stringify(u.props), fl: u.flavour, img: imgId, url: u.url,
    }
  );
  const [[row]] = await pool.execute("SELECT id FROM unique_item WHERE slug=:s", { s: u.slug });
  await replaceMods("unique_item", row.id, u.mods);
  return row.id;
}

async function applyThai(id, slug) {
  const th = await parseThai(slug);
  if (!th) return;
  const pool = getPool();
  await pool.execute("UPDATE unique_item SET name_th=:n, flavour_th=:f WHERE id=:id", {
    n: th.name || null, f: th.flavour || null, id,
  });
  await applyThaiMods("unique_item", id, th.mods);
}

async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const pool = getPool();
  const [run] = await pool.execute("INSERT INTO scrape_run (category, started_at) VALUES ('uniques', NOW())");
  const runId = run.insertId;

  let entries = await discover("us/Unique_item");
  console.log(`discovered ${entries.length} unique links`);
  if (limit) entries = entries.slice(0, limit);

  let ok = 0, fail = 0;
  await mapLimit(entries, SCRAPE.concurrency, async ({ slug }) => {
    try {
      const u = await parseUniquePage(slug);
      if (!u || !u.name) { fail++; return; }
      const id = await retryOnDeadlock(() => save(u));
      await retryOnDeadlock(() => applyThai(id, slug));
      ok++;
      if (ok % 25 === 0) console.log(`  ${ok}/${entries.length} (latest: ${u.name})`);
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

main().catch((e) => { console.error(e); process.exit(1); });
