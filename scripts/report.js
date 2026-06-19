// Summary report of what's currently in the database.
import { getPool, closePool } from "../src/db/pool.js";

const p = getPool();
const q = async (sql) => (await p.query(sql))[0];

const counts = await q(`
  SELECT 'gem' e, COUNT(*) n FROM gem
  UNION ALL SELECT 'unique', COUNT(*) FROM unique_item
  UNION ALL SELECT 'base_item', COUNT(*) FROM base_item
  UNION ALL SELECT 'item_mod', COUNT(*) FROM item_mod
  UNION ALL SELECT 'affix', COUNT(*) FROM affix
  UNION ALL SELECT 'affix_item_class', COUNT(*) FROM affix_item_class
  UNION ALL SELECT 'gem_level', COUNT(*) FROM gem_level
  UNION ALL SELECT 'tag', COUNT(*) FROM tag
  UNION ALL SELECT 'item_class', COUNT(*) FROM item_class
  UNION ALL SELECT 'image (total)', COUNT(*) FROM image
  UNION ALL SELECT 'image (downloaded)', COUNT(*) FROM image WHERE status='ok'`);
console.log("\n=== ROW COUNTS ===");
console.table(counts);

console.log("\n=== gems by type ===");
console.table(await q("SELECT gem_type, COUNT(*) n FROM gem GROUP BY gem_type"));

console.log("\n=== translation coverage ===");
console.table(await q(`
  SELECT 'gem name_th' f, COUNT(name_th) have, COUNT(*) total FROM gem
  UNION ALL SELECT 'unique name_th', COUNT(name_th), COUNT(*) FROM unique_item
  UNION ALL SELECT 'base name_th', COUNT(name_th), COUNT(*) FROM base_item
  UNION ALL SELECT 'mod text_th', COUNT(text_th), COUNT(*) FROM item_mod
  UNION ALL SELECT 'affix stat_th', COUNT(stat_text_th), COUNT(*) FROM affix`));

console.log("\n=== affixes by generation type ===");
console.table(await q("SELECT generation_type, COUNT(*) n FROM affix GROUP BY generation_type ORDER BY n DESC"));

console.log("\n=== scrape runs ===");
console.table(await q("SELECT category, total, ok_count, fail_count, note FROM scrape_run ORDER BY id"));

await closePool();
