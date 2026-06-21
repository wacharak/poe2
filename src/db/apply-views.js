// Apply views.sql to the configured database (re-runnable; CREATE OR REPLACE).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { DB } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = await readFile(path.join(__dirname, "views.sql"), "utf8");

const conn = await mysql.createConnection({ ...DB, multipleStatements: true });
await conn.query(sql);
const [views] = await conn.query(
  "SELECT table_name FROM information_schema.views WHERE table_schema = ?",
  [DB.database]
);
console.log("Views applied:");
for (const row of views) console.log("  - " + Object.values(row)[0]);
await conn.end();
