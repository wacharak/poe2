// Collect candidate detail-page slugs from an index/category page.
import { getPage } from "./client.js";
import { load, clean } from "./parse.js";

// Header/footer nav targets that are NOT item detail pages.
const NAV = new Set([
  "/us/", "/us/Items", "/us/Unique_item", "/us/Reforging_Bench", "/us/Gem",
  "/us/Skill_Gems", "/us/Support_Gems", "/us/Spirit_Gems", "/us/Lineage_Supports",
  "/us/Modifiers", "/us/Desecrated_Modifiers", "/us/Keywords", "/us/Crafting",
  "/us/Liquid_Emotions", "/us/Quest", "/us/Ascendancy_class",
  "/us/passive-skill-tree/", "/us/Act", "/us/Waystones", "/us/EndGame",
  "/us/atlas-skill-tree/", "/us/patreon", "/us/Flasks", "/us/Essence",
  "/us/Splinter", "/us/Catalysts", "/us/Hideout", "/us/Strongbox",
]);

// Returns array of { slug, name } for /us/* links that look like detail pages.
export async function discover(indexPath) {
  const { html } = await getPage(indexPath);
  if (!html) return [];
  const $ = load(html);
  const seen = new Map();
  $("a[href^='/us/']").each((_, a) => {
    const href = $(a).attr("href");
    if (!href || NAV.has(href)) return;
    if (href.includes("?") || href.includes("#")) return; // marked?id=, anchors
    if (href.endsWith("/")) return; // sub-apps like trees
    const slug = decodeURIComponent(href.replace("/us/", ""));
    if (!slug || slug.includes("/")) return;
    const name = clean($(a).text());
    if (!seen.has(slug)) seen.set(slug, name);
  });
  return [...seen].map(([slug, name]) => ({ slug, name }));
}
