// Scrape currency items (orbs / stackable consumables) into the DB (en + th).
// Discovery: the /us/Currency index lists each currency as an
// <a class="item_currency" href="<slug>">; every slug has a .newItemPopup
// detail page shaped like a base item (Base.* key/val), with the gameplay
// effect carried in .explicitMod and the stack size in a .property line.
import { getPage, mapLimit } from "../lib/client.js";
import * as P from "../lib/parse.js";
import { getPool, closePool } from "../db/pool.js";
import { upsertItemClass, imageId } from "../db/upsert.js";
import { retryOnDeadlock } from "../lib/retry.js";
import { SCRAPE } from "../config.js";

const INDEX = "us/Currency";

// Keep these raw game-data groups in the properties JSON.
const KV_KEEP = /^(Base\.|Quality\.|Stack\.)/;

// Collect currency detail-page slugs from the Currency index.
async function discoverCurrency() {
  const { html } = await getPage(INDEX);
  if (!html) return [];
  const $ = P.load(html);
  const slugs = new Set();
  $("a.item_currency").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    // hrefs are relative on this page, e.g. "Divine_Orb" or "/us/Divine_Orb"
    const slug = decodeURIComponent(href.replace(/^\/us\//, "").replace(/^\//, ""));
    if (slug && !slug.includes("/")) slugs.add(slug);
  });
  return [...slugs];
}

// Raw ".property" line texts, e.g. ["Stackable Currency", "Stack Size: 1 / 20"].
// (parsePropertyLines drops colon-less lines like the class descriptor, so we
// read the elements directly here.)
function propertyLines($) {
  return P.mainPopup($)
    .find(".property")
    .map((_, e) => P.clean($(e).text()))
    .get()
    .filter(Boolean);
}

// "Stack Size: 1 / 20" -> 20
function stackSize(lines) {
  for (const t of lines) {
    const m = /Stack Size:\s*\d+\s*\/\s*(\d+)/i.exec(t);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

async function parsePage(lang, slug) {
  const { html, url } = await getPage(`${lang}/${encodeURIComponent(slug)}`);
  if (!html) return null;
  const $ = P.load(html);
  if (!P.mainPopup($).length) return null;
  const lines = propertyLines($);
  const props = P.parsePropertyLines($);
  const kv = P.parseKeyValTable($);
  for (const [k, v] of Object.entries(kv)) if (KV_KEEP.test(k)) props[k] = v;
  // The item class is the property line without a "key: value" colon ("Stackable Currency").
  const itemClass = lines.find((t) => !t.includes(":")) || P.parseItemClass($) || null;
  // Orbs carry their effect in .explicitMod; shards have none and instead
  // describe themselves in the italic note ("A stack of 10 shards becomes ...").
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
    url,
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

async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : null;
  const pool = getPool();
  const [run] = await pool.execute(
    "INSERT INTO scrape_run (category, started_at) VALUES ('currency', NOW())"
  );
  const runId = run.insertId;

  let slugs = await discoverCurrency();
  if (limit) slugs = slugs.slice(0, limit);
  console.log(`discovered ${slugs.length} currency slugs`);

  let ok = 0, skip = 0, fail = 0;
  await mapLimit(slugs, SCRAPE.concurrency, async (slug) => {
    try {
      const c = await parsePage("us", slug);
      if (!c) { skip++; return; }
      const id = await retryOnDeadlock(() => save(c));
      await retryOnDeadlock(() => applyThai(id, slug));
      ok++;
      if (ok % 10 === 0) console.log(`  ${ok} currency (latest: ${c.name})`);
    } catch (err) {
      fail++;
      console.warn(`  FAIL ${slug}: ${err.message}`);
    }
  });

  await pool.execute(
    "UPDATE scrape_run SET finished_at=NOW(), total=:t, ok_count=:o, fail_count=:f, note=:n WHERE id=:id",
    { t: slugs.length, o: ok, f: fail, n: `skipped ${skip} non-popup`, id: runId }
  );
  console.log(`done. currency=${ok} skipped=${skip} fail=${fail}`);
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
