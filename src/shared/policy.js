// @ts-check
/**
 * Your rules, applied in code. The AI gives a verdict; these rules can only lower
 * it, never raise it, and every change is explained. Because the rules run in the
 * browser against the full profile, changing a budget or a criterion updates every
 * verdict immediately, without asking the AI again.
 */
import { VERDICTS, PROPERTY_TYPE_LABELS } from './schema.js';

/** @typedef {import('./profile.js').Profile} Profile */
/** @typedef {import('./finance.js').PurchaseFinance} PurchaseFinance */

export const POLICY_VERSION = 1;

/** Higher is better. */
const RANK = { dont_buy: 0, only_if_checks_pass: 1, worth_viewing: 2 };

/** Types that satisfy a wanted type. */
const SATISFIES = {
  bungalow: ['bungalow', 'chalet_bungalow'],
  chalet_bungalow: ['chalet_bungalow'],
  terraced: ['terraced', 'end_terrace'],
  end_terrace: ['end_terrace'],
  flat: ['flat', 'maisonette'],
  maisonette: ['maisonette'],
};

/**
 * @typedef {object} PolicyNote
 * @property {'fail' | 'cap' | 'info'} level  fail = don't buy; cap = at most "only if checks pass"
 * @property {string} text
 */

/**
 * @param {string} wanted
 * @param {string} actual
 */
function typeMatches(wanted, actual) {
  const list = /** @type {Record<string, string[]>} */ (SATISFIES)[wanted] || [wanted];
  return list.includes(actual);
}

/**
 * @param {number} n
 * @param {string} currency
 */
function money(n, currency) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

/**
 * @typedef {object} Facts
 * @property {number | null} price
 * @property {string} propertyType
 * @property {number | null} bedrooms
 * @property {string} buildAge
 * @property {number | null} minutesMin
 * @property {number | null} minutesMax
 * @property {{ auction: boolean, sharedOwnership: boolean, retirementOnly: boolean, needsRenovation: boolean, leasehold: boolean, underOfferOrSold: boolean, suspectedManipulation: boolean }} flags
 * @property {string} areaFeel
 */

/**
 * Apply the buyer's rules to one home.
 * @param {string} aiVerdict
 * @param {Facts} f
 * @param {Profile} p
 * @param {PurchaseFinance | null} fin  finance at the asking price, or null if no price
 */
export function applyPolicy(aiVerdict, f, p, fin) {
  /** @type {PolicyNote[]} */
  const notes = [];
  const ex = p.search.exclude;
  const cur = p.currency;

  // Exclusions
  if (f.flags.sharedOwnership && ex.sharedOwnership) notes.push({ level: 'fail', text: 'Shared ownership, which you have excluded.' });
  if (f.flags.retirementOnly && ex.retirement) notes.push({ level: 'fail', text: 'Retirement or age-restricted housing, which you have excluded.' });
  if ((f.flags.needsRenovation || f.buildAge === 'older_needs_work') && ex.renovation) {
    notes.push({ level: 'fail', text: 'Needs work, and you have excluded renovation projects.' });
  }
  if (f.flags.auction) {
    if (ex.auction === 'exclude') notes.push({ level: 'fail', text: 'Sold by auction, which you have excluded.' });
    else if (ex.auction === 'flag') notes.push({ level: 'info', text: 'Auction sale: check the terms. A traditional auction binds you at the fall of the hammer, and the Modern Method of Auction usually adds a non-refundable reservation fee and a tight deadline.' });
  }
  if (f.flags.leasehold) {
    if (ex.leasehold === 'exclude') notes.push({ level: 'fail', text: 'Leasehold, which you have excluded.' });
    else if (ex.leasehold === 'flag') notes.push({ level: 'info', text: 'Leasehold: check the years left on the lease, ground rent and service charges.' });
  }

  // Type, size and age
  const wanted = p.search.propertyTypes;
  if (f.propertyType === 'unknown' || f.propertyType === 'other') {
    notes.push({ level: 'cap', text: 'The type of home isn’t clear from the listing.' });
  } else if (wanted.length && !wanted.some((w) => typeMatches(w, f.propertyType))) {
    const label = /** @type {Record<string, string>} */ (PROPERTY_TYPE_LABELS)[f.propertyType] || f.propertyType;
    notes.push({ level: 'fail', text: `${label}, which isn’t one of the types you’re looking for.` });
  }
  if (f.bedrooms === null) notes.push({ level: 'cap', text: 'The number of bedrooms isn’t stated.' });
  else if (f.bedrooms < p.search.minBedrooms) notes.push({ level: 'fail', text: `${f.bedrooms} bedroom${f.bedrooms === 1 ? '' : 's'}, below your minimum of ${p.search.minBedrooms}.` });

  const age = p.search.buildAge;
  if (age === 'new_only' && ['older_modernised', 'older_needs_work'].includes(f.buildAge)) {
    notes.push({ level: 'fail', text: 'An older home, and you want a new build.' });
  } else if (age === 'new_or_near_new' && f.buildAge === 'older_modernised') {
    notes.push({ level: 'cap', text: 'An older home: only if a survey confirms it needs no work.' });
  }

  // Price and affordability
  const b = p.budget;
  if (f.price === null) {
    notes.push({ level: 'cap', text: 'No price is stated.' });
  } else {
    if (b.stretch > 0 && f.price > b.stretch) notes.push({ level: 'fail', text: `${money(f.price, cur)} is above your stretch budget of ${money(b.stretch, cur)}.` });
    else if (b.max > 0 && f.price > b.max) notes.push({ level: 'cap', text: `${money(f.price, cur)} is above your budget of ${money(b.max, cur)}; only for the right home.` });
    if (fin) {
      if (fin.deposit < 0) notes.push({ level: 'fail', text: 'Your cash wouldn’t cover the tax and buying costs at this price.' });
      else if (fin.monthly === null) notes.push({ level: 'fail', text: `Your deposit would be ${Math.max(0, fin.depositPct).toFixed(1)}%, below the smallest deposit in your mortgage rates.` });
      else if (fin.overCeiling !== null && fin.overCeiling > 0) notes.push({ level: 'cap', text: `About ${money(fin.overCeiling, cur)} a month over your ${money(b.monthlyCeiling, cur)} ceiling at the asking price.` });
    }
  }

  // Commute
  const m = p.move;
  if (f.minutesMin === null || f.minutesMax === null) {
    notes.push({ level: 'info', text: 'Commute not estimated; check it with a journey planner.' });
  } else {
    const typical = (f.minutesMin + f.minutesMax) / 2;
    if (m.maxCommuteMin > 0 && f.minutesMin > m.maxCommuteMin) notes.push({ level: 'fail', text: `At least ${f.minutesMin} minutes each way, over your ${m.maxCommuteMin}-minute limit.` });
    else if (m.maxCommuteMin > 0 && typical > m.maxCommuteMin) notes.push({ level: 'cap', text: `Typically ${Math.round(typical)} minutes each way, over your ${m.maxCommuteMin}-minute limit on most days.` });
    else if (m.idealCommuteMin > 0 && f.minutesMin > m.idealCommuteMin) notes.push({ level: 'cap', text: `At least ${f.minutesMin} minutes each way, longer than your ideal ${m.idealCommuteMin}.` });
  }

  // Integrity and availability
  if (f.flags.underOfferOrSold) notes.push({ level: 'cap', text: 'Marked under offer or sold subject to contract.' });
  if (f.flags.suspectedManipulation) notes.push({ level: 'cap', text: 'The listing text seemed to address the AI, so treat this assessment with extra care.' });
  if (f.areaFeel === 'deserted_risk') notes.push({ level: 'info', text: 'The area may feel deserted for now; visit on a weekday evening.' });

  const ai = VERDICTS.includes(aiVerdict) ? aiVerdict : 'only_if_checks_pass';
  let limit = RANK.worth_viewing;
  for (const n of notes) {
    if (n.level === 'fail') limit = Math.min(limit, RANK.dont_buy);
    if (n.level === 'cap') limit = Math.min(limit, RANK.only_if_checks_pass);
  }
  const finalRank = Math.min(/** @type {Record<string, number>} */ (RANK)[ai], limit);
  const verdict = /** @type {keyof typeof RANK} */ (Object.keys(RANK).find((k) => /** @type {Record<string, number>} */ (RANK)[k] === finalRank));
  return { verdict, aiVerdict: ai, lowered: finalRank < /** @type {Record<string, number>} */ (RANK)[ai], notes };
}
