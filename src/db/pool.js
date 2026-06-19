import mysql from "mysql2/promise";
import { DB } from "../config.js";

let pool;
export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...DB,
      waitForConnections: true,
      connectionLimit: 8,
      namedPlaceholders: true,
      dateStrings: true,
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
