// Download images from cdn.poe2db.tw to disk; record in `image` table.
import { writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { SCRAPE, UA } from "../config.js";
import { getPool } from "../db/pool.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Map a CDN url to a local relative path that mirrors its CDN path.
function localPathFor(cdnUrl) {
  const u = new URL(cdnUrl);
  // strip leading "/image/" to keep folders shallow but meaningful
  const rel = u.pathname.replace(/^\/+/, "").replace(/^image\//i, "");
  return path.join(SCRAPE.imageDir, rel);
}

// Register an image url, return its image.id (insert-or-get).
export async function registerImage(cdnUrl) {
  if (!cdnUrl) return null;
  const pool = getPool();
  const [r] = await pool.execute(
    "INSERT INTO image (cdn_url, status) VALUES (:u, 'pending') " +
      "ON DUPLICATE KEY UPDATE cdn_url = VALUES(cdn_url)",
    { u: cdnUrl }
  );
  if (r.insertId) return r.insertId;
  const [[row]] = await pool.execute("SELECT id FROM image WHERE cdn_url = :u", { u: cdnUrl });
  return row?.id ?? null;
}

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// Download all pending images. Polite, sequential-ish with small delay.
export async function downloadPending({ limit = null } = {}) {
  const pool = getPool();
  const [rows] = await pool.query(
    "SELECT id, cdn_url FROM image WHERE status = 'pending'" +
      (limit ? ` LIMIT ${Number(limit)}` : "")
  );
  let ok = 0,
    fail = 0;
  for (const { id, cdn_url } of rows) {
    const dest = localPathFor(cdn_url);
    try {
      if (!(await fileExists(dest))) {
        const res = await fetch(cdn_url, { headers: { "User-Agent": UA } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, buf);
        var bytes = buf.length;
        var sha = createHash("sha256").update(buf).digest("hex");
        await sleep(150);
      } else {
        const st = await stat(dest);
        bytes = st.size;
        sha = null;
      }
      await pool.execute(
        "UPDATE image SET status='ok', local_path=:p, bytes=:b, sha256=:s, downloaded_at=NOW() WHERE id=:id",
        { p: path.relative(SCRAPE.imageDir, dest).replace(/\\/g, "/"), b: bytes, s: sha, id }
      );
      ok++;
    } catch (err) {
      await pool.execute("UPDATE image SET status='failed' WHERE id=:id", { id });
      fail++;
      console.warn(`  image fail ${cdn_url}: ${err.message}`);
    }
  }
  return { ok, fail, total: rows.length };
}
