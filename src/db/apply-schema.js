// Apply schema.sql to the configured database.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { DB } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = await readFile(path.join(__dirname, "schema.sql"), "utf8");

const conn = await mysql.createConnection({ ...DB, multipleStatements: true });
await conn.query(sql);
const [tables] = await conn.query("SHOW TABLES");
console.log("Schema applied. Tables:");
for (const row of tables) console.log("  - " + Object.values(row)[0]);
await conn.end();
