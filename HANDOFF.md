# HANDOFF — PoE2DB Scraper (บันทึกงานค้างสำหรับ session หน้า)

> อัปเดตล่าสุด: 2026-06-20 (รอบ 4 — build-guide skill + GitHub Pages; เฟส scraper เหลือ 3.2/3.3)
> โปรเจกต์: `C:\wamp64\www\Filler POE2` — Node.js scraper ดึง PoE2 จาก poe2db.tw → MySQL `poe2db` + โหลดรูป
> อ่าน `README.md` ประกอบสำหรับภาพรวม/วิธีรัน

---

## 1. สถานะปัจจุบัน (เฟส 1 เสร็จแล้ว ✅)

ข้อมูลที่อยู่ใน DB `poe2db` ตอนนี้ (user `root` / pass อยู่ใน `src/config.js`):

| ตาราง | จำนวน | หมายเหตุ |
|---|---|---|
| `gem` | 1,046 | skill 350 + support 643 + **spirit 53** (แก้ 2.2 แล้ว) |
| `unique_item` | 447 | **link base ครบ 447/447 (100%)** — ลบ gem ปลอม 69 ตัวออก (ดู 2.3) |
| `base_item` | 370 | อาวุธ/เกราะ/เครื่องประดับ/ขวด/jewel/tablet/belt |
| `item_mod` | 6,674 | mod ที่ติดมากับ item (implicit/explicit/quality, en + th) |
| `affix` | 1,872 | **ใหม่ (3.1)** — affix pool (prefix/suffix/corrupted) ราย mod_key + en/th |
| `affix_item_class` | 8,544 | **ใหม่** — affix ↔ item_class (m:n) + source + weight |
| `gem_level` | 17,649 | level progression ราย gem |
| `tag` | 54 | gem tags |
| `item_class` | 72 | เพิ่มจาก 33 — affix ใช้ slug ละเอียดกว่า (Gloves_str, Body_Armours_dex_int ฯลฯ) |
| `image` | 1,521 | โหลดลงดิสก์สำเร็จ 1,384 (`images/`, ~16MB) |

Thai coverage: gem 100%, base 100%, unique 100% (447/447), item_mod ~99%, **affix stat ~99% (1,856/1,872)**
Views พร้อมใช้: `v_gem`, `v_unique`, `v_base`, **`v_affix`** (affix flatten + item_class + source)

ตรวจสถานะได้ทุกเมื่อ: `node scripts/report.js`

---

## 2. งานค้างเฟส 1 — ✅ ปิดครบแล้ว (2.1–2.3) เหลือ 2.4 (ไม่ต้องแก้)

### 2.1 Item ที่ scrape ไม่สำเร็จ 7 ตัว — ✅ เก็บครบแล้ว
รัน `gems.js` + `uniques.js` ซ้ำ → ok ครบ fail=0 (Elemental Sundering, Bijouborne, ฯลฯ เก็บได้หมด)

### 2.2 spirit gems ไม่ถูกจัดประเภท — ✅ แก้แล้ว
**สาเหตุ:** `found` Map ใน gems.js เก็บ type แรกที่เจอ (skill/support) ก่อน spirit เลยไม่เคยได้ 'spirit'
**แก้:** เพิ่ม `TYPE_PRIORITY` ให้ spirit override type เดิม (gems.js ~บรรทัด 151) → ตอนนี้มี spirit 53 ตัว

### 2.3 uniques link base ไม่ได้ — ✅ แก้แล้ว (เดิม 96, ตอนนี้ 0)
แยกได้ 3 สาเหตุ:
1. **69 ตัวเป็น skill gem ที่หลุดเข้ามา** (หน้าเป็น `GemPopup` ไม่ใช่ `UniquePopup`; `base_name_en`=ชื่อตัวเอง และซ้ำกับตาราง gem)
   → แก้ `parseUniquePage` ให้รับเฉพาะ popup ที่มี class `UniquePopup` + ลบ 69 แถว (และ mod 404) ที่เก็บไว้แล้ว
2. **17 base ชื่อผิดเป็น "Crafting Project"** (หน้า jewel/tablet/relic เป็น `normalPopup` ตัวเล็ก ทำให้ `displayName` หยิบ section header)
   → แก้ `bases.js` ให้ใช้ `meta.BaseType` เป็นชื่อหลักแทน `displayName` (ทั้ง parseBasePage + parseThai)
3. **belts ที่ขาด** (Double/Mail/Ornate Belt) เพิ่งเป็น candidate หลังเก็บ uniques 503 ครบ → re-run bases.js เก็บได้
ผลรวม: re-run bases.js → `linked 447/447`

### 2.4 รูป 130 ตัวโหลดไม่ได้ (status='failed')
ส่วนใหญ่เป็น HTTP 403 = รูป placeholder ที่ไม่มีจริงบน CDN (เช่น `BlankGreenSupportGem.webp`)
ไม่ต้องแก้ ถ้าอยากลองซ้ำ: `UPDATE image SET status='pending' WHERE status='failed';` แล้ว `node src/scrape/images.js`

---

## 3. เฟสถัดไป (ยังไม่เริ่ม — schema เผื่อขยายไว้บางส่วนแล้ว)

ผู้ใช้ยังไม่ได้เลือกว่าจะทำอันไหนก่อน — **ถามก่อนเริ่ม**

### 3.1 Modifiers (affixes ทั้งหมด) — ✅ เสร็จแล้ว
- **scraper: `src/scrape/mods.js`** (รัน `node src/scrape/mods.js [N]`)
- **กุญแจสำคัญ:** affix ไม่ได้อยู่ใน HTML table — แต่ฝัง inline เป็น JSON ในหน้าแต่ละ item-class
  ผ่าน `new ModsView({...})` (poe2db render ฝั่ง client ด้วย Mustache) → helper `extractModsViewData` ใน parse.js สกัด JSON ออกมา (balanced-brace scan) **ไม่ต้องใช้ Playwright/endpoint แยก**
- discovery: ดึง slug จากลิงก์ `#ModifiersCalc` บนหน้า `/us/Modifiers` (ได้ 63 item-class pages)
- ผลลัพธ์: affix 1,872 ตัว, affix_item_class 8,544, th ~99%
- โครงสร้าง JSON ต่อ mod: `Name`, `Level`(ilvl), `ModGenerationTypeID`(1=Prefix/2=Suffix/5=Corrupted ผ่าน `data.gen`+GEN_TYPES), `ModFamilyList`(กลุ่มกันชน), `DropChance`(weight), `str`(stat HTML), `hover`(=mod_key เสถียร เช่น `Dexterity1`)
- **เก็บค้าง/ต่อยอดได้:** source อื่นที่ยังว่างบนบางหน้า (essence/breach/synthesis ฯลฯ) จะเก็บอัตโนมัติเมื่อ poe2db มีข้อมูล; weight ตอนนี้เก็บ `DropChance` ตัวเดียว (ยังไม่ทำ tag-weighted spawn weight ละเอียด)

### 3.2 Passive / Atlas tree — ยากสุด (เฟสถัดไปที่เหลือ)
- `/us/passive-skill-tree/` และ `/us/atlas-skill-tree/` เป็น **SPA โหลดจาก JS** (ไม่ใช่ HTML table)
- **บทเรียนจาก 3.1:** ลองหา JSON ที่ฝัง inline ในหน้าก่อน (เช่น pattern `new XxxView({...})` / ตัวแปร JS) — poe2db ชอบฝังข้อมูลแล้ว render ฝั่ง client มากกว่าเรียก endpoint
- ถ้าไม่มี inline จริง ๆ ค่อย render ด้วย Playwright (ต้องติดตั้ง "Playwright MCP Bridge" extension ก่อน — รอบนี้ MCP ใช้ไม่ได้เพราะยังไม่ติดตั้ง)
- reference: โปรเจกต์ poe2-theorycraft มี `scraper/tree.py` ที่ extract tree จาก SPA

### 3.3 Currency / Waystones / Endgame
- `/us/EndGame`, `/us/Waystones`, currency items
- โครงสร้างน่าจะคล้าย base item popup → reuse `parse.js` ได้

---

## 4. สถาปัตยกรรม / สิ่งที่ต้องรู้ก่อนแก้โค้ด (gotchas)

1. **ทุกหน้า detail ใช้โครงสร้าง `.newItemPopup` เหมือนกัน** — parser กลางอยู่ที่ `src/lib/parse.js`
   (helpers: `mainPopup`, `parseMods`, `parseMetaTable`, `parseKeyValTable`, `parseRequirements`, `popupImage`, `displayName`)
2. **รูป/ไอคอนอยู่ใน `.itemboximage img` ซึ่งอยู่ "นอก" `.newItemPopup`** — อย่า scope การหา img ไว้ใน popup
3. **HTML cache**: ทุกหน้าถูก cache ที่ `scratch/cache/<sha>/...` — แก้ parser แล้ว re-run ได้โดยไม่ยิงเว็บซ้ำ
   ลบโฟลเดอร์นี้ = บังคับดึงสด (ใช้เมื่อข้อมูลในเว็บอัปเดต/มี league ใหม่)
4. **Base discovery ไม่มีทางลัด**: poe2db ไม่มี sitemap, หน้า class (เช่น `/us/Bow`) เป็น keyword page
   วิธีที่ใช้ = crawl category hub (`CATEGORY_HUBS` ใน bases.js) + อนุมาน slug จาก base ที่ uniques อ้างถึง
   แล้ว classify ด้วยการมี field `Base.base_level` ในตาราง key/val
   **ข้อจำกัด: base ที่ไม่มี unique และไม่ถูก list ใน hub จะหลุด** (อาจตกหล่นบางตัว)
5. **InnoDB deadlock**: เกิดตอน worker หลายตัว upsert `tag`/`item_class` พร้อมกัน
   แก้แล้วด้วย `src/lib/retry.js` (`retryOnDeadlock`) — ครอบ save ทุก scraper อยู่แล้ว
6. **ชื่อ base type ภาษาไทย = อังกฤษ** — ไม่ใช่บั๊ก poe2db หน้า `/th/` แสดง base name เป็นอังกฤษจริง
   (แต่ gem/unique name + mod text แปลไทยครบ)
7. **มารยาท scrape**: `SCRAPE` ใน config.js = concurrency 3, ≥350ms/req, retry 4 ครั้ง — อย่าตั้งสูงกว่านี้

---

## 5. คำสั่งที่ใช้บ่อย

```bash
npm install                       # ครั้งแรกเท่านั้น
npm run schema                    # สร้าง/อัปเดตตาราง (idempotent)
node src/db/...                   # (views อยู่ที่ src/db/views.sql — apply ด้วย script ใน history)

node src/scrape/gems.js [N]       # ดูด gems (N = จำกัดจำนวน, เว้น = ทั้งหมด)
node src/scrape/uniques.js [N]
node src/scrape/bases.js [N]
node src/scrape/mods.js [N]        # ดูด affixes (prefix/suffix) ราย item-class (N = จำกัดจำนวนหน้า)
node src/scrape/images.js [N]     # โหลดรูป status='pending'

node scripts/report.js            # สรุปจำนวน + translation coverage + scrape runs
node scripts/fetch-sample.js us/<Slug>   # ดึง HTML หน้าหนึ่งมาดู (debug parser)
node scripts/recon.js scratch/<file>.html  # วิเคราะห์โครงสร้าง HTML
```

Views พร้อมใช้: `v_gem`, `v_unique`, `v_base`, `v_affix` (join รูป/class/source แล้ว)

---

## 6. จุดเริ่มสำหรับ session หน้า

เฟส 1 (2.1–2.3) + เฟส 3.1 Modifiers ปิดครบแล้ว

### นอกเหนือ scraper — งานที่ทำเพิ่มรอบนี้ (build-guide tooling)
- **GitHub:** repo `wacharak/poe2` (public) เชื่อมแล้ว · **DB creds ย้ายไป `.env`** (gitignore) — `config.js` อ่านจาก env, มี `.env.example`
- **gitignore:** `node_modules/`, `images/`, `scratch/`, `.env` (images regenerate ได้จาก scraper)
- **skill `poe2-build-guide`** (`.claude/skills/poe2-build-guide/`) — แปลคลิป/ลิงก์บิลด์ PoE2 → หน้า HTML ไทย + ดึงรูปไอคอนจาก DB (`v_gem`/`v_unique`) มี `template.html` ในโฟลเดอร์ skill
- **หน้าไกด์ที่ทำแล้ว:** `build-guide-twister.html`, `build-guide-hollow-assault.html` (อย่างละ 2 แท็บ: แปลคลิป + ไกด์ Mobalytics)
- **GitHub Pages live:** https://wacharak.github.io/poe2/ — ไอคอนที่หน้าใช้ต้อง `git add -f` (เพราะ `images/` ถูก gitignore)
- gotcha: Mobalytics บล็อก WebFetch (Cloudflare) → ใช้ Exa `web_fetch_exa`; รูปอ้างอิง local `images/` เท่านั้น (Artifact/CDN โดน CSP)


1. รัน `node scripts/report.js` ดูสถานะ (unique 447/447, spirit 53, affix 1,872)
2. เฟสที่เหลือ: **3.3 Currency/Waystones/Endgame** (ง่ายสุด — static popup) หรือ **3.2 Passive/Atlas tree** (ยากสุด — SPA) — ถามผู้ใช้ก่อนเริ่ม
3. **gotcha #8 (ใหม่):** poe2db ชอบฝังข้อมูล inline เป็น JSON ใน `new XxxView({...})` แล้ว render ฝั่ง client — ก่อนคิดว่าหน้าไหน "ต้องใช้ Playwright" ให้ grep หา inline JSON ในหน้าก่อนเสมอ (ดู `extractModsViewData`)
