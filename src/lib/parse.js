// HTML parsing helpers for poe2db item-popup pages.
// Every detail page (base / unique / gem) shares the .newItemPopup structure.
import * as cheerio from "cheerio";
import { SITE } from "../config.js";

const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
// Strip poe2db display markup like "<size:37>{Name}" -> "Name".
const stripMarkup = (s) =>
  clean((s || "").replace(/<[^>]*>/g, "").replace(/[{}]/g, ""));
const toCdn = (src) => {
  if (!src) return null;
  if (src.startsWith("http")) return src;
  return SITE.cdn + (src.startsWith("/") ? src : "/" + src);
};
const intOrNull = (s) => {
  const m = clean(s).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
};

export function load(html) {
  return cheerio.load(html);
}

// The primary item popup (first one — the page subject).
export function mainPopup($) {
  return $(".newItemPopup").first();
}

// Parse the "Name | ..." metadata table (DropLevel, BaseType, Class, Type, Tags, Icon).
export function parseMetaTable($) {
  const out = {};
  $("table").each((_, t) => {
    const $t = $(t);
    const head = clean($t.find("tr").first().text());
    if (!/^Name/.test(head)) return;
    $t.find("tr").each((_, tr) => {
      const cells = $(tr).find("td,th");
      if (cells.length < 1) return;
      const label = clean($(cells[0]).clone().children().remove().end().text()) ||
        clean($(cells[0]).text());
      const row = clean($(tr).text());
      // rows render as "KeyValue" stuck together; split on known keys
      const m = row.match(/^(DropLevel|BaseType|Class|Flags|Type|Tags|Icon)\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    });
  });
  return out;
}

// Parse the raw "key | val" game-data table (Base.*, Weapon.*, Sockets.* ...).
export function parseKeyValTable($) {
  const out = {};
  $("table").each((_, t) => {
    const $t = $(t);
    const headers = $t.find("tr").first().find("th,td").map((_, c) => clean($(c).text())).get();
    if (!(headers[0] === "key" && headers[1] === "val")) return;
    $t.find("tr").slice(1).each((_, tr) => {
      const c = $(tr).find("td");
      if (c.length >= 2) out[clean($(c[0]).text())] = clean($(c[1]).text());
    });
  });
  return out;
}

// Image from the popup header.
export function popupImage($) {
  // .itemboximage holds the subject icon and lives outside .newItemPopup.
  let src = $(".itemboximage img").first().attr("src");
  if (!src) src = mainPopup($).find("img").first().attr("src");
  return toCdn(src);
}

// Mods of a given css class within the main popup, in order.
function modsByClass($, cls) {
  return mainPopup($)
    .find("." + cls)
    .map((_, e) => clean($(e).text()))
    .get()
    .filter(Boolean);
}

export function parseMods($) {
  return {
    implicit: modsByClass($, "implicitMod"),
    explicit: modsByClass($, "explicitMod"),
    enchant: modsByClass($, "enchantMod"),
    quality: modsByClass($, "qualityMod"),
    secondary_quality: modsByClass($, "secondaryQualityMod"),
  };
}

// Requirements out of the raw key/val table (most reliable numbers).
export function reqsFromKeyVal(kv) {
  return {
    req_str: intOrNull(kv["AttributeRequirements.strength_requirement"]),
    req_dex: intOrNull(kv["AttributeRequirements.dexterity_requirement"]),
    req_int: intOrNull(kv["AttributeRequirements.intelligence_requirement"]),
    drop_level: intOrNull(kv["Base.base_level"]),
  };
}

// Requirements from the popup's .requirements block (Level / Str / Dex / Int).
export function parseRequirements($) {
  const txt = clean(mainPopup($).find(".requirements").text());
  const grab = (re) => {
    const m = txt.match(re);
    return m ? parseInt(m[1], 10) : null;
  };
  return {
    req_level: grab(/Level\s*\(?(\d+)/i),
    req_str: grab(/(\d+)\s*Str/i),
    req_dex: grab(/(\d+)\s*Dex/i),
    req_int: grab(/(\d+)\s*Int/i),
  };
}

// Property lines ("Damage:", "Attacks per Second:", ...) as a flat object.
export function parsePropertyLines($) {
  const props = {};
  mainPopup($)
    .find(".property")
    .each((_, e) => {
      const t = clean($(e).text());
      const m = t.match(/^([^:]+):\s*(.*)$/);
      if (m && m[2]) props[m[1].trim()] = m[2].trim();
    });
  return props;
}

// Flavour text (unique items).
export function parseFlavour($) {
  return clean(mainPopup($).find(".FlavourText").first().text()) || null;
}

// All .lc names in the popup (unique: [0]=item name, [1]=base name).
export function popupNames($) {
  return mainPopup($)
    .find(".lc")
    .map((_, e) => stripMarkup($(e).text()))
    .get()
    .filter(Boolean);
}

// ---- Gem-specific ----
export function parseGemTags($) {
  return mainPopup($)
    .find(".GemTags")
    .map((_, e) => clean($(e).text()))
    .get()
    .filter((t) => t && t.length < 40);
}

export function parseGemDescription($) {
  return clean(mainPopup($).find(".secDescrText").first().text()) || null;
}

export function parseItemClass($) {
  return clean(mainPopup($).find(".ItemClasses").first().text()) || null;
}

// Level progression table: headers -> keys; returns array of row objects.
export function parseGemLevels($) {
  let rows = [];
  $("table").each((_, t) => {
    const $t = $(t);
    const headers = $t.find("tr").first().find("th").map((_, th) => clean($(th).text())).get();
    if (!headers.length || !/^Level$/i.test(headers[0])) return;
    if (rows.length) return; // take the first matching table
    $t.find("tbody tr, tr").slice(1).each((_, tr) => {
      const cells = $(tr).find("td");
      if (cells.length < headers.length) return;
      const obj = {};
      headers.forEach((h, i) => (obj[h] = clean($(cells[i]).text())));
      rows.push(obj);
    });
  });
  return { headers: rows[0] ? Object.keys(rows[0]) : [], rows };
}

export function gemNameAndImage($) {
  const box = mainPopup($);
  const name =
    clean(box.find(".lc, .itemName, .gemitem").first().text()) ||
    clean($("h3").first().text());
  return { name, image: popupImage($) };
}

// Pull display name from the popup header / h3.
export function displayName($) {
  const box = mainPopup($);
  return (
    stripMarkup(box.find(".lc, .itemName").first().text()) ||
    stripMarkup($("h3").first().text()) ||
    stripMarkup($("title").text().split(" - ")[0])
  );
}

// Extract the JSON object passed to `new ModsView({...})` on item-class pages.
// poe2db ships the full affix pool inline here; the Mustache UI renders it client-side.
export function extractModsViewData(html) {
  if (!html) return null;
  const marker = "new ModsView(";
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf("{", at + marker.length);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; }
    }
  }
  return null;
}

export { clean, stripMarkup, toCdn, intOrNull };
