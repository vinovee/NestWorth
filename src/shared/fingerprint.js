// @ts-check
/**
 * A cheap fingerprint of a listing: its first price, and whether it says it's under
 * offer or sold. Scheduled refreshes compare fingerprints, so the AI only runs again
 * when something that matters to the buyer has changed.
 */
import { money } from './format.js';

/** @typedef {{ price: number | null, status: 'available' | 'under_offer' | 'sold' }} Fingerprint */

export const LISTING_STATUSES = ['available', 'under_offer', 'sold'];

const PRICE = /[£€$]\s?(\d{1,3}(?:,\d{3})+|\d{5,9})(?![\d,])/g;
const SOLD = /\b(?:sold\s+(?:stc|subject\s+to\s+contract)|sale\s+agreed|let\s+agreed)\b/i;
// "All rights reserved" in a page footer is not a reservation.
const UNDER_OFFER = /\b(?:under\s+offer|(?<!rights\s)reserved|offer\s+accepted)\b/i;

/**
 * @param {string} text
 * @returns {Fingerprint}
 */
export function listingFingerprint(text) {
  /** @type {number | null} */
  let price = null;
  for (const m of text.matchAll(PRICE)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (n >= 10000 && n <= 1e9) {
      price = n;
      break;
    }
  }
  const status = SOLD.test(text) ? 'sold' : UNDER_OFFER.test(text) ? 'under_offer' : 'available';
  return { price, status };
}

/**
 * @param {unknown} v
 * @returns {v is Fingerprint}
 */
export function isFingerprint(v) {
  const f = /** @type {any} */ (v);
  return Boolean(f) && typeof f === 'object' && (f.price === null || (typeof f.price === 'number' && Number.isFinite(f.price))) && LISTING_STATUSES.includes(f.status);
}

const STATUS_CHANGE = /** @type {Record<string, string>} */ ({
  under_offer: 'It’s now marked as under offer or reserved.',
  sold: 'It’s now marked as sold subject to contract.',
  available: 'It’s no longer marked as under offer or sold.',
});

/**
 * What changed between two fingerprints, in plain English. Empty when nothing did.
 * @param {Fingerprint} before
 * @param {Fingerprint} after
 * @param {string} [currency]
 * @returns {string[]}
 */
export function describeChanges(before, after, currency = 'GBP') {
  /** @type {string[]} */
  const changes = [];
  if (before.price !== after.price) {
    if (before.price !== null && after.price !== null) {
      changes.push(`The price ${after.price < before.price ? 'dropped' : 'went up'} from ${money(before.price, currency)} to ${money(after.price, currency)}.`);
    } else if (after.price !== null) {
      changes.push(`The listing now shows a price of ${money(after.price, currency)}.`);
    } else {
      changes.push('The listing no longer shows a price.');
    }
  }
  if (before.status !== after.status) changes.push(STATUS_CHANGE[after.status]);
  return changes;
}
