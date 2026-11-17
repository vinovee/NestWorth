// @ts-check
/**
 * Which homes are due for a scheduled re-check. Kept free of browser APIs so it can
 * be tested on its own.
 */

/** How often each profile setting re-checks a home, in milliseconds. */
export const REFRESH_EVERY_MS = /** @type {Record<string, number>} */ ({ off: 0, daily: 86400000, weekly: 7 * 86400000 });

/** The same value as RULED_OUT in store.js (a test keeps them in step). */
export const RULED_OUT_STATUS = 'Ruled out';

/**
 * A home can be re-checked if it was added by link and isn't ruled out. Pasted
 * listings, examples and homes added by hand have no page to re-read.
 * @param {{ source?: { type?: string, url?: string } }} home
 * @param {string} status
 */
export function canRefresh(home, status) {
  return home.source?.type === 'link' && Boolean(home.source.url) && status !== RULED_OUT_STATUS;
}

/**
 * Homes due for a re-check, the longest-waiting first.
 * @param {{ profile: { refresh: { frequency: string } }, homes: Record<string, any>, track: Record<string, { status: string }> }} state
 * @param {number} nowMs
 * @param {boolean} [force] every home that can be re-checked, however recently it was
 * @returns {any[]}
 */
export function dueHomes(state, nowMs, force = false) {
  const every = REFRESH_EVERY_MS[state.profile.refresh?.frequency] || 0;
  const lastChecked = (/** @type {any} */ home) => Date.parse(home.refresh?.checkedAt || home.meta?.assessedAt || home.createdAt) || 0;
  return Object.values(state.homes)
    .filter((home) => {
      if (!canRefresh(home, state.track[home.id]?.status ?? '')) return false;
      if (force) return true;
      // A listing that has gone stays put until the buyer checks it by hand.
      if (!every || home.refresh?.result === 'gone') return false;
      return nowMs - lastChecked(home) >= every;
    })
    .sort((a, b) => lastChecked(a) - lastChecked(b));
}
