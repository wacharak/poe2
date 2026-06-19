---
name: poe2-build-guide
description: Turn a PoE2 build video transcript or a build-guide URL into a readable Thai HTML page with skill/item icons pulled from the local poe2db database. Use when the user pastes a build video transcript, gives a build-guide link (YouTube, Mobalytics, Maxroll, mobalytics, etc.), or asks to "translate this build / make an HTML guide like the Twister one". Project-scoped: requires the local MySQL `poe2db` DB and the `images/` folder.
---

# PoE2 Build Guide → Thai HTML

Generate a styled, easy-to-read **Thai** HTML build guide from a source the user provides
(a pasted video transcript, or a URL), embedding skill/item icons from the local `poe2db` database.
The proven reference output is **`build-guide-twister.html`** in the project root — clone its look & structure.

## When to use
- User pastes a PoE2 build **video transcript** and asks to translate / make a page.
- User gives a **build-guide URL** (Mobalytics, Maxroll, YouTube description, etc.).
- User says "ทำหน้า html แบบนี้" / "แปลบิลด์นี้" / "make a guide like the Twister one".

## Inputs
- **Transcript** (pasted text): translate/summarize it directly — this is fine for user-provided docs.
- **URL**: fetch first (see Fetch strategy). Translate/summarize the result.
- Never reproduce large verbatim copyrighted text — **summarize and translate** into your own Thai prose.

## Workflow

### 1. Get the source content
- Pasted transcript → use as-is.
- URL → `WebFetch` first. If it returns **403 / Cloudflare** (common on **mobalytics.gg**),
  fall back to the Exa tool `mcp__plugin_ecc_exa__web_fetch_exa` (`maxCharacters: 12000`).
  Mobalytics build pages are React SPAs — Equipment/Passive widgets often won't extract as text;
  capture what you can (gem list, levels, quest rewards, skill rotation) and link to the original.

### 2. Identify skills/items and look up icons (local DB)
Collect every PoE2 skill gem, support gem, and unique/item name mentioned, then query the DB.
Write a throwaway script (delete after) — import the pool relative to the project:

```js
// scripts/_tmp_findimg.js  (delete when done)
import { getPool, closePool } from "../src/db/pool.js";
const p = getPool(); const q = async (s,a)=>(await p.query(s,a))[0];
for (const n of [/* names... */]) {
  for (const r of await q("SELECT name_en,name_th,gem_type,image_path FROM v_gem WHERE name_en LIKE :n",{n:`%${n}%`}))
    console.log(JSON.stringify(r));               // also try v_unique / v_base for items
}
await closePool();
```
Run: `node scripts/_tmp_findimg.js`

Notes on results:
- `image_path` is relative under `images/` → reference in HTML as `images/<image_path>`.
- `image_path` ending in **`BlankGem.webp`** = no real icon exists → omit the image, keep the text.
- `name_th` is the in-game Thai name — show it alongside the English name.
- Views available: `v_gem`, `v_unique`, `v_base`, `v_affix`.

### 3. Build the HTML
- Copy the CSS + scaffold from **`template.html`** (in this skill folder) or from `build-guide-twister.html`.
- Structure: hero header → (optional) tab bar → skill/item **icon gallery** → translated sections.
- Translate into Thai, **reorganized and readable** (not word-for-word). Keep skill/item names in
  English plus the Thai game name. **Highlight the important bits** with `.imp` callout boxes and `<mark>`
  (e.g. skill rotation, stat requirements, quest rewards, key damage multipliers).
- Inline icon next to a mentioned skill: `<span class="chip"><img src="images/<path>">Name</span>`.
- Multiple sources (e.g. a video + a Mobalytics page) → put each in its own **tab** (see template JS).
- Tables work great for gem lists (with Lv / weapon set) and quest rewards.

### 4. Output + sharing
- Write the file to the **project root** (e.g. `build-guide-<name>.html`) so `images/...` resolves
  on WAMP (`http://localhost/Filler%20POE2/<file>`).
- It is **not** an Artifact — the strict CSP would block local/CDN images. Always a local file.
- To publish on **GitHub Pages** for sharing: force-add the referenced icons (they're gitignored),
  commit, push. Pages serves from `main` root:
  ```bash
  grep -oE 'images/[^"]+\.webp' build-guide-<name>.html | sort -u | xargs git add -f
  git add build-guide-<name>.html && git commit -m "feat: add <name> build guide" && git push
  ```
  Live at `https://<user>.github.io/poe2/build-guide-<name>.html`.

## Gotchas (learned)
- Mobalytics blocks `WebFetch` (Cloudflare) → use Exa fetch.
- Reference images by **relative `images/` path**, never CDN (CSP) and never an Artifact.
- Some skills resolve to `BlankGem.webp` in the DB — skip their image.
- Keep the dark PoE theme consistent: gold `--gold`, panel `--panel`, chip borders by gem type
  (Spirit = blue, Unique = orange, Support = gold).
