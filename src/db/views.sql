-- Convenience views joining entities with their image path + class name.
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW v_gem AS
SELECT g.id, g.slug, g.name_en, g.name_th, g.gem_type, ic.name_en AS item_class,
       g.req_level, g.req_str, g.req_dex, g.req_int,
       g.description_en, g.description_th,
       img.cdn_url AS image_url, img.local_path AS image_path
FROM gem g
LEFT JOIN item_class ic ON ic.id = g.item_class_id
LEFT JOIN image img ON img.id = g.image_id;

CREATE OR REPLACE VIEW v_unique AS
SELECT u.id, u.slug, u.name_en, u.name_th, u.base_name_en,
       b.slug AS base_slug, ic.name_en AS item_class,
       u.req_level, u.req_str, u.req_dex, u.req_int,
       u.flavour_en, u.flavour_th,
       img.cdn_url AS image_url, img.local_path AS image_path
FROM unique_item u
LEFT JOIN base_item b ON b.id = u.base_item_id
LEFT JOIN item_class ic ON ic.id = u.item_class_id
LEFT JOIN image img ON img.id = u.image_id;

-- Affix pool flattened to one row per (affix, item class, source).
CREATE OR REPLACE VIEW v_affix AS
SELECT a.id, a.mod_key, a.name_en, a.name_th, a.generation_type, a.family,
       a.required_level, a.stat_text_en, a.stat_text_th, a.domain,
       ic.name_en AS item_class, aic.source, aic.weight
FROM affix a
JOIN affix_item_class aic ON aic.affix_id = a.id
LEFT JOIN item_class ic ON ic.id = aic.item_class_id;

CREATE OR REPLACE VIEW v_base AS
SELECT b.id, b.slug, b.name_en, b.name_th, ic.name_en AS item_class,
       b.drop_level, b.req_str, b.req_dex, b.req_int,
       img.cdn_url AS image_url, img.local_path AS image_path
FROM base_item b
LEFT JOIN item_class ic ON ic.id = b.item_class_id
LEFT JOIN image img ON img.id = b.image_id;
