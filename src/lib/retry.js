// Retry a DB operation on transient InnoDB lock errors.
const TRANSIENT = new Set(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function retryOnDeadlock(fn, { tries = 5 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!TRANSIENT.has(err.code)) throw err;
      lastErr = err;
      await sleep(50 + Math.floor(Math.random() * 150) * (i + 1));
    }
  }
  throw lastErr;
}
