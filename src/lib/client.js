// Rate-limited, retrying HTTP client with on-disk HTML cache.
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { SITE, SCRAPE, UA } from "../config.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cachePath(url) {
  const h = createHash("sha1").update(url).digest("hex");
  return path.join(SCRAPE.cacheDir, h.slice(0, 2), h + ".html");
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

let lastStart = 0;
async function throttle() {
  const now = Date.now();
  const wait = lastStart + SCRAPE.minDelayMs - now;
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
}

// Fetch a poe2db page (relative path like "us/Lightning_Arrow"), cached.
export async function getPage(relPath, { force = false } = {}) {
  const url = relPath.startsWith("http") ? relPath : `${SITE.base}/${relPath}`;
  const cp = cachePath(url);
  if (!force && (await exists(cp))) {
    return { html: await readFile(cp, "utf8"), url, cached: true };
  }
  let lastErr;
  for (let attempt = 1; attempt <= SCRAPE.maxRetries; attempt++) {
    try {
      await throttle();
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "en,th;q=0.8" },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) {
        // 404 etc. — record and return null html so caller can skip
        return { html: null, url, status: res.status, cached: false };
      }
      const html = await res.text();
      await mkdir(path.dirname(cp), { recursive: true });
      await writeFile(cp, html);
      return { html, url, status: res.status, cached: false };
    } catch (err) {
      lastErr = err;
      const backoff = Math.min(8000, 500 * 2 ** (attempt - 1));
      console.warn(`  retry ${attempt}/${SCRAPE.maxRetries} ${url} (${err.message}) wait ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// Tiny concurrency runner that preserves input order in results.
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}
