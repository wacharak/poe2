# PoE2DB Local Mirror

ดึงข้อมูล Path of Exile 2 จาก [poe2db.tw](https://poe2db.tw) (community DB โดย chuanhsing,
เนื้อหาอยู่ภายใต้ CC BY-NC-SA 3.0) มาเก็บลง MySQL ของเราเอง พร้อมโหลดรูปภาพลงดิสก์
รองรับ 2 ภาษา: อังกฤษ (canonical) + ไทย

## ขอบเขตเฟสปัจจุบัน
- **Base items** (base types — อาวุธ/เกราะ/เครื่องประดับ/ขวด) + ข้อมูลดิบของเกม
- **Unique items** + flavour text + mods
- **Gems** (skill / support / spirit) + tags + level progression + mods
- **รูปภาพ** ทั้งหมดจาก `cdn.poe2db.tw` โหลดลงโฟลเดอร์ `images/`

## ความต้องการ
- Node.js 18+ (ทดสอบบน v24)
- MySQL (ตั้งค่าใน `src/config.js` — ปัจจุบันชี้ db `poe2db`, user `root`)

## วิธีใช้
```bash
npm install
npm run schema          # สร้าง/อัปเดตตารางทั้งหมด (idempotent)

npm run scrape:gems     # ดูด gems  (ใส่ตัวเลขท้ายเพื่อจำกัดจำนวน เช่น: node src/scrape/gems.js 20)
npm run scrape:uniques  # ดูด unique items
npm run scrape:bases    # ดูด base types (discover จาก hub + base ที่ uniques อ้างถึง)
node src/scrape/images.js   # โหลดรูปที่ค้าง (status='pending') ลงดิสก์
```
รันซ้ำได้เสมอ — ทุก insert เป็น upsert (ON DUPLICATE KEY) จึงอัปเดตของเดิมไม่สร้างซ้ำ

## โครงสร้างโปรเจกต์
```
src/
  config.js            # DB creds, rate limit, โฟลเดอร์ cache/image
  db/
    schema.sql         # นิยามตารางทั้งหมด
    apply-schema.js    # รัน schema.sql
    pool.js            # mysql2 connection pool
    upsert.js          # helper insert-or-update (item_class, tag, mods, image)
  lib/
    client.js          # fetch แบบ rate-limit + retry + cache HTML ลงดิสก์
    discover.js        # เก็บ slug ของหน้า detail จากหน้า index/category
    parse.js           # ตัว parse โครงสร้าง .newItemPopup (ใช้ร่วมทุกชนิด)
    images.js          # ลงทะเบียน + โหลดรูป
    retry.js           # retry เมื่อเจอ InnoDB deadlock
  scrape/
    gems.js  uniques.js  bases.js  images.js
scratch/cache/         # HTML ที่ cache ไว้ (re-parse ได้โดยไม่ต้อง fetch ใหม่)
images/                # ไฟล์ .webp ที่โหลดมา (mirror path ของ CDN)
```

## หมายเหตุ / ข้อจำกัด
- **มารยาทในการ scrape**: จำกัด concurrency = 3 และเว้นระยะ ≥350ms/คำขอ (แก้ใน `config.js`)
- HTML ถูก cache ไว้ใน `scratch/cache/` — แก้ parser แล้ว re-run ได้โดยไม่ยิงเว็บซ้ำ
  (ลบโฟลเดอร์นี้เพื่อบังคับดึงข้อมูลสด)
- **Base discovery**: poe2db ไม่มี sitemap และหน้า class เป็น keyword page จึงใช้วิธี
  discover จาก category hub + อนุมาน slug จาก base ที่ unique อ้างถึง แล้ว classify ด้วย
  การมีฟิลด์ `Base.base_level` base ที่ไม่มี unique และไม่ถูก list ใน hub อาจหลุดได้
- ฟิลด์ตัวเลขบาง gem เป็น `0`/`null` ตามที่หน้าเว็บแสดง (เช่น req level 1 = 0)

## เฟสถัดไป (ยังไม่ทำ)
Modifiers (affixes), Passive/Atlas tree, Currency/Waystones — ดู schema เผื่อขยายได้
