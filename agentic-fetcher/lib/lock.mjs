// An exclusive lock on a data file, so parallel agents can read-modify-write the same JSON/CSV/JSONL.
//
// The lock is a lock file `<target>.lock`, created with O_EXCL ("wx") and holding {pid, host, time}.
// A waiter retries with jittered exponential backoff (up to 30 min). A lock whose owner pid is no
// longer running (same host), or that is older than STALE_MS (another host), is stale and broken.
// Breaking a stale lock has a small race (two waiters can both judge the same lock stale); a writer
// only dies mid-write if its process is killed, so in practice a stale lock is rare.
import { closeSync, ftruncateSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";

const STALE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 30 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

/** Hold the lock on `path` while `fn()` runs (creating `path` if missing); returns fn's result. */
export async function withLock(path, fn) {
  const lock = `${path}.lock`;
  const me = JSON.stringify({ pid: process.pid, host: hostname(), time: Date.now() });
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(lock, "wx");
      writeSync(fd, me);
      closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    let holder = null;
    try { holder = JSON.parse(readFileSync(lock, "utf8")); } catch { /* being written or just removed */ }
    if (holder && ((holder.host === hostname() && !alive(holder.pid)) || Date.now() - holder.time > STALE_MS)) {
      try { unlinkSync(lock); } catch { /* someone else broke it first */ }
      continue;
    }
    if (Date.now() - t0 > TIMEOUT_MS) throw new Error(`timed out waiting for ${lock}`);
    await sleep(Math.min(200, 2 ** Math.min(attempt, 8)) * (0.5 + Math.random()));
  }
  try {
    closeSync(openSync(path, "a"));                            // create the target if missing, never truncate
    return await fn();
  } finally {
    try { unlinkSync(lock); } catch { /* already gone */ }
  }
}

/** Rewrite a (locked) file in place: truncate, then write `text`. */
export function rewrite(path, text) {
  const fd = openSync(path, "r+");
  try {
    ftruncateSync(fd, 0);
    const buf = Buffer.from(text, "utf8");
    for (let off = 0; off < buf.length;) off += writeSync(fd, buf, off, buf.length - off, off);
  } finally {
    closeSync(fd);
  }
}
