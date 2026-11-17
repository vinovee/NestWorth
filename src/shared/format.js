// @ts-check
/** Display formatting, shared by the browser and the server. British English throughout. */

/** @type {Map<string, Intl.NumberFormat>} */
const cache = new Map();
/** @param {string} currency @param {number} digits */
function nf(currency, digits) {
  const key = `${currency}:${digits}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    cache.set(key, f);
  }
  return f;
}

/** £325,000 */
export const money = (/** @type {number} */ n, currency = 'GBP') => nf(currency, 0).format(Math.round(n));
/** £12.40 */
export const money2 = (/** @type {number} */ n, currency = 'GBP') => nf(currency, 2).format(n);

/** £325k or £1.25m */
export function moneyShort(/** @type {number} */ n, currency = 'GBP') {
  const sym = nf(currency, 0).formatToParts(0).find((p) => p.type === 'currency')?.value || '';
  if (Math.abs(n) >= 1e6) return `${sym}${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}m`;
  return `${sym}${Math.round(n / 1000)}k`;
}

/** +12% or −3% (true minus sign) */
export function signedPct(/** @type {number} */ n, digits = 0) {
  const v = Number(n.toFixed(digits));
  if (v === 0) return '0%';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`;
}

/** 7.5 → "7.5", 8 → "8" */
export const score = (/** @type {number} */ n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "45 min" or "40–50 min" */
export function minutesRange(/** @type {number | null} */ a, /** @type {number | null} */ b) {
  if (a === null || b === null) return 'Not estimated';
  return a === b ? `${a} min` : `${a}–${b} min`;
}

/** 17 Nov 2026 */
export function shortDate(/** @type {string | number | Date} */ d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Parse a money or number typed by a person: "£550,000", "550k" and "1.2m" all work.
 * Returns null for an empty box and NaN for something that isn't a number.
 * @param {string} raw
 * @returns {number | null}
 */
export function parseAmount(raw) {
  const t = raw.trim().toLowerCase().replace(/[£$€,\s]/g, '');
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(t);
  if (!m) return Number.NaN;
  const n = Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
  return Number.isFinite(n) ? n : Number.NaN;
}
