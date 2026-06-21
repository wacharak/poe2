-- =====================================================================
-- PoE2DB local mirror schema
-- Source: https://poe2db.tw  (community DB by chuanhsing)
-- Charset utf8mb4 throughout for Thai (th) translations.
-- Strategy: English is canonical; translatable strings get a *_th twin.
-- =====================================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------- lookup: item classes (Bows, Quivers, Body Armour ...) ----
CREATE TABLE IF NOT EXISTS item_class (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug      VARCHAR(128) NOT NULL,
  name_en   VARCHAR(191) NOT NULL,
  name_th   VARCHAR(191) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_class_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- lookup: tags / keywords (Attack, Projectile, Lightning) --
CREATE TABLE IF NOT EXISTS tag (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name_en   VARCHAR(128) NOT NULL,
  name_th   VARCHAR(128) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tag_name (name_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- images (downloaded to disk, path stored here) -----------
CREATE TABLE IF NOT EXISTS image (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cdn_url      VARCHAR(512) NOT NULL,
  local_path   VARCHAR(512) NULL,         -- relative to project /images
  bytes        INT UNSIGNED NULL,
  sha256       CHAR(64) NULL,
  status       ENUM('pending','ok','failed') NOT NULL DEFAULT 'pending',
  downloaded_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_image_cdn (cdn_url),
  KEY ix_image_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- base items (white base types) ---------------------------
CREATE TABLE IF NOT EXISTS base_item (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug           VARCHAR(191) NOT NULL,     -- poe2db page slug, e.g. "Crude_Bow"
  name_en        VARCHAR(191) NOT NULL,
  name_th        VARCHAR(191) NULL,
  item_class_id  INT UNSIGNED NULL,
  drop_level     SMALLINT UNSIGNED NULL,    -- required/drop level
  req_level      SMALLINT UNSIGNED NULL,
  req_str        SMALLINT UNSIGNED NULL,
  req_dex        SMALLINT UNSIGNED NULL,
  req_int        SMALLINT UNSIGNED NULL,
  properties     JSON NULL,                 -- class-specific stats (damage, armour, es...)
  image_id       INT UNSIGNED NULL,
  source_url     VARCHAR(512) NOT NULL,
  scraped_at     DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_base_slug (slug),
  KEY ix_base_class (item_class_id),
  CONSTRAINT fk_base_class FOREIGN KEY (item_class_id) REFERENCES item_class(id) ON DELETE SET NULL,
  CONSTRAINT fk_base_image FOREIGN KEY (image_id) REFERENCES image(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- unique items --------------------------------------------
CREATE TABLE IF NOT EXISTS unique_item (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(191) NOT NULL,
  name_en         VARCHAR(191) NOT NULL,
  name_th         VARCHAR(191) NULL,
  base_item_id    INT UNSIGNED NULL,        -- the base it rolls on (if matched)
  base_name_en    VARCHAR(191) NULL,        -- raw base name as shown
  item_class_id   INT UNSIGNED NULL,
  req_level       SMALLINT UNSIGNED NULL,
  req_str         SMALLINT UNSIGNED NULL,
  req_dex         SMALLINT UNSIGNED NULL,
  req_int         SMALLINT UNSIGNED NULL,
  properties      JSON NULL,
  flavour_en      TEXT NULL,
  flavour_th      TEXT NULL,
  image_id        INT UNSIGNED NULL,
  source_url      VARCHAR(512) NOT NULL,
  scraped_at      DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_unique_slug (slug),
  KEY ix_unique_base (base_item_id),
  KEY ix_unique_class (item_class_id),
  CONSTRAINT fk_unique_base FOREIGN KEY (base_item_id) REFERENCES base_item(id) ON DELETE SET NULL,
  CONSTRAINT fk_unique_class FOREIGN KEY (item_class_id) REFERENCES item_class(id) ON DELETE SET NULL,
  CONSTRAINT fk_unique_image FOREIGN KEY (image_id) REFERENCES image(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- gems (skill / support / spirit) -------------------------
CREATE TABLE IF NOT EXISTS gem (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(191) NOT NULL,
  name_en         VARCHAR(191) NOT NULL,
  name_th         VARCHAR(191) NULL,
  gem_type        ENUM('skill','support','spirit','meta','unknown') NOT NULL DEFAULT 'unknown',
  colour          ENUM('red','green','blue','white','none') NULL,
  item_class_id   INT UNSIGNED NULL,        -- weapon restriction e.g. Bows
  req_level       SMALLINT UNSIGNED NULL,
  req_str         SMALLINT UNSIGNED NULL,
  req_dex         SMALLINT UNSIGNED NULL,
  req_int         SMALLINT UNSIGNED NULL,
  description_en  TEXT NULL,
  description_th  TEXT NULL,
  properties      JSON NULL,                -- cost, cast/attack speed, etc.
  image_id        INT UNSIGNED NULL,
  source_url      VARCHAR(512) NOT NULL,
  scraped_at      DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gem_slug (slug),
  KEY ix_gem_type (gem_type),
  CONSTRAINT fk_gem_class FOREIGN KEY (item_class_id) REFERENCES item_class(id) ON DELETE SET NULL,
  CONSTRAINT fk_gem_image FOREIGN KEY (image_id) REFERENCES image(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- gem <-> tag join ----------------------------------------
CREATE TABLE IF NOT EXISTS gem_tag (
  gem_id  INT UNSIGNED NOT NULL,
  tag_id  INT UNSIGNED NOT NULL,
  PRIMARY KEY (gem_id, tag_id),
  CONSTRAINT fk_gemtag_gem FOREIGN KEY (gem_id) REFERENCES gem(id) ON DELETE CASCADE,
  CONSTRAINT fk_gemtag_tag FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- gem per-level progression -------------------------------
CREATE TABLE IF NOT EXISTS gem_level (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  gem_id        INT UNSIGNED NOT NULL,
  level         SMALLINT UNSIGNED NOT NULL,
  requires_level SMALLINT UNSIGNED NULL,
  req_str       SMALLINT UNSIGNED NULL,
  req_dex       SMALLINT UNSIGNED NULL,
  req_int       SMALLINT UNSIGNED NULL,
  stats         JSON NULL,                  -- remaining columns keyed by header
  PRIMARY KEY (id),
  UNIQUE KEY uq_gemlevel (gem_id, level),
  CONSTRAINT fk_gemlevel_gem FOREIGN KEY (gem_id) REFERENCES gem(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- mods, shared across base/unique/gem ---------------------
CREATE TABLE IF NOT EXISTS item_mod (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_type  ENUM('base_item','unique_item','gem') NOT NULL,
  owner_id    INT UNSIGNED NOT NULL,
  mod_type    ENUM('implicit','explicit','enchant','quality','secondary_quality') NOT NULL,
  ordinal     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  text_en     TEXT NOT NULL,
  text_th     TEXT NULL,
  PRIMARY KEY (id),
  KEY ix_mod_owner (owner_type, owner_id),
  KEY ix_mod_type (mod_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- affix modifiers (prefix/suffix pools) -------------------
-- One row per distinct affix (keyed by poe2db's stable Mods id, e.g. "Dexterity1").
-- The same affix rolls on many item classes / from many sources, tracked in mod_item_class.
-- ("mod" is a MySQL reserved word, so the table is named "affix".)
CREATE TABLE IF NOT EXISTS affix (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  mod_key         VARCHAR(191) NOT NULL,      -- stable id from the hover link, e.g. "Dexterity1"
  name_en         VARCHAR(191) NULL,          -- affix name, e.g. "of the Mongoose"
  name_th         VARCHAR(191) NULL,
  generation_type VARCHAR(32) NULL,           -- Prefix / Suffix / (other)
  family          VARCHAR(191) NULL,          -- ModFamilyList[0] — mutual-exclusion group
  required_level  SMALLINT UNSIGNED NULL,     -- item level the tier unlocks at
  stat_text_en    TEXT NULL,                  -- rolled stat line, value ranges kept e.g. "+(5—8) to Dexterity"
  stat_text_th    TEXT NULL,
  domain          VARCHAR(32) NULL,           -- ModDomainsID (1=item, ...)
  PRIMARY KEY (id),
  UNIQUE KEY uq_affix_key (mod_key),
  KEY ix_affix_family (family),
  KEY ix_affix_gen (generation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- which item classes / sources an affix can roll on -------
CREATE TABLE IF NOT EXISTS affix_item_class (
  affix_id      INT UNSIGNED NOT NULL,
  item_class_id INT UNSIGNED NOT NULL,
  source        VARCHAR(32) NOT NULL DEFAULT 'normal',  -- normal/corrupted/desecrated/essence/...
  weight        INT UNSIGNED NULL,                      -- DropChance for this class+source
  PRIMARY KEY (affix_id, item_class_id, source),
  KEY ix_aic_class (item_class_id),
  CONSTRAINT fk_aic_affix FOREIGN KEY (affix_id) REFERENCES affix(id) ON DELETE CASCADE,
  CONSTRAINT fk_aic_class FOREIGN KEY (item_class_id) REFERENCES item_class(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- currency items (stackable consumables / orbs) -----------
-- Listed on /us/Currency; each has its own .newItemPopup detail page like a
-- base item (Base.* key/val), but the gameplay effect lives in .explicitMod.
CREATE TABLE IF NOT EXISTS currency_item (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug           VARCHAR(191) NOT NULL,     -- poe2db page slug, e.g. "Divine_Orb"
  name_en        VARCHAR(191) NOT NULL,
  name_th        VARCHAR(191) NULL,
  item_class_id  INT UNSIGNED NULL,         -- "Stackable Currency" etc
  stack_size     SMALLINT UNSIGNED NULL,    -- max stack size
  effect_en      TEXT NULL,                 -- gameplay effect (joined .explicitMod lines)
  effect_th      TEXT NULL,
  properties     JSON NULL,                 -- raw Base.* / property lines
  image_id       INT UNSIGNED NULL,
  source_url     VARCHAR(512) NOT NULL,
  scraped_at     DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_currency_slug (slug),
  KEY ix_currency_class (item_class_id),
  CONSTRAINT fk_currency_class FOREIGN KEY (item_class_id) REFERENCES item_class(id) ON DELETE SET NULL,
  CONSTRAINT fk_currency_image FOREIGN KEY (image_id) REFERENCES image(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- scrape run tracking -------------------------------------
CREATE TABLE IF NOT EXISTS scrape_run (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category    VARCHAR(64) NOT NULL,         -- gems / bases / uniques
  started_at  DATETIME NOT NULL,
  finished_at DATETIME NULL,
  total       INT UNSIGNED NULL,
  ok_count    INT UNSIGNED NULL,
  fail_count  INT UNSIGNED NULL,
  note        VARCHAR(512) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
