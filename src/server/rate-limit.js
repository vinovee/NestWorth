// @ts-check
/**
 * In-memory limits that protect your AI budget: a per-client window, a daily cap
 * across everyone, and a cap on assessments running at once. They reset when the
 * server restarts; for a multi-instance deployment put a shared limiter in front.
 */

/**
 * @param {{ windowMs: number, max: number }} opts
 * @param {() => number} [now]
 */
export function createRateLimiter({ windowMs, max }, now = Date.now) {
  /** @type {Map<string, { start: number, count: number }>} */
  const windows = new Map();
  return {
    /**
     * Count one request; returns whether it is allowed and when to retry.
     * @param {string} key
     */
    take(key) {
      const t = now();
      if (windows.size > 10000) {
        for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
      }
      let w = windows.get(key);
      if (!w || t - w.start >= windowMs) {
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= max) return { ok: false, retryAfterSec: Math.ceil((w.start + windowMs - t) / 1000) };
      w.count++;
      return { ok: true, retryAfterSec: 0 };
    },
  };
}

/**
 * @param {number} max assessments per calendar day (UTC)
 * @param {() => Date} [now]
 */
export function createDailyCap(max, now = () => new Date()) {
  let day = '';
  let count = 0;
  return {
    take() {
      const today = now().toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        count = 0;
      }
      if (count >= max) return false;
      count++;
      return true;
    },
  };
}

/** @param {number} max */
export function createConcurrencyGate(max) {
  let active = 0;
  return {
    tryEnter() {
      if (active >= max) return false;
      active++;
      return true;
    },
    leave() {
      active = Math.max(0, active - 1);
    },
    get active() {
      return active;
    },
  };
}
