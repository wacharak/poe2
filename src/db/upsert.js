// Insert-or-update helpers returning row ids.
import { getPool } from "./pool.js";
import { registerImage } from "../lib/images.js";

export async function upsertItemClass(nameEn, nameTh = null) {
  if (!nameEn) return null;
  const pool = getPool();
  const slug = nameEn.replace(/\s+/g, "_");
  await pool.execute(
    "INSERT INTO item_class (slug, name_en, name_th) VALUES (:s,:en,:th) " +
      "ON DUPLICATE KEY UPDATE name_en=VALUES(name_en), name_th=COALESCE(VALUES(name_th), name_th)",
    { s: slug, en: nameEn, th: nameTh }
  );
  const [[row]] = await pool.execute("SELECT id FROM item_class WHERE slug=:s", { s: slug });
  return row?.id ?? null;
}

export async function upsertTag(nameEn, nameTh = null) {
  if (!nameEn) return null;
  const pool = getPool();
  await pool.execute(
    "INSERT INTO tag (name_en, name_th) VALUES (:en,:th) " +
      "ON DUPLICATE KEY UPDATE name_th=COALESCE(VALUES(name_th), name_th)",
    { en: nameEn, th: nameTh }
  );
  const [[row]] = await pool.execute("SELECT id FROM tag WHERE name_en=:en", { en: nameEn });
  return row?.id ?? null;
}

export async function imageId(cdnUrl) {
  return registerImage(cdnUrl);
}

// Replace all mods for an owner with the given set.
export async function replaceMods(ownerType, ownerId, mods) {
  const pool = getPool();
  await pool.execute("DELETE FROM item_mod WHERE owner_type=:t AND owner_id=:id", {
    t: ownerType,
    id: ownerId,
  });
  const rows = [];
  for (const [modType, list] of Object.entries(mods)) {
    (list || []).forEach((text, i) => {
      if (text) rows.push([ownerType, ownerId, modType, i, text]);
    });
  }
  if (rows.length) {
    await pool.query(
      "INSERT INTO item_mod (owner_type, owner_id, mod_type, ordinal, text_en) VALUES ?",
      [rows]
    );
  }
}

// Apply Thai mod texts by (mod_type, ordinal).
export async function applyThaiMods(ownerType, ownerId, mods) {
  const pool = getPool();
  for (const [modType, list] of Object.entries(mods)) {
    for (let i = 0; i < (list || []).length; i++) {
      if (list[i])
        await pool.execute(
          "UPDATE item_mod SET text_th=:th WHERE owner_type=:t AND owner_id=:id AND mod_type=:m AND ordinal=:o",
          { th: list[i], t: ownerType, id: ownerId, m: modType, o: i }
        );
    }
  }
}
