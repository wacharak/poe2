// Download all pending images registered in the DB.
import { downloadPending } from "../lib/images.js";
import { closePool } from "../db/pool.js";

const limit = process.argv[2] ? parseInt(process.argv[2], 10) : null;
const r = await downloadPending({ limit });
console.log(`images: ok=${r.ok} fail=${r.fail} total=${r.total}`);
await closePool();
