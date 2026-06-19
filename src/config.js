// Central config. DB credentials are read from environment variables so no
// secret is committed. Local values live in a gitignored `.env` at the project
// root (copy `.env.example` -> `.env` and fill in your password).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

export const DB = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "poe2db",
  charset: "utf8mb4",
};

export const SITE = {
  base: "https://poe2db.tw",
  cdn: "https://cdn.poe2db.tw",
  langs: ["us", "th"], // us = canonical English, th = Thai twin
};

// Politeness: keep concurrency low and add a gap between requests.
export const SCRAPE = {
  concurrency: 3,
  minDelayMs: 350, // min gap between request starts per worker
  maxRetries: 4,
  cacheDir: "scratch/cache", // raw HTML cache so re-parsing needs no re-fetch
  imageDir: "images", // downloaded webp files live here
};

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
