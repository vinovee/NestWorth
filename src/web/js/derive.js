// @ts-check
/**
 * Everything the screens show that is calculated rather than stored: money,
 * the buyer's rules, resale and sorting. Recomputed from the current profile, so
 * editing a budget updates every home at once.
 */
import { purchaseFinance, commuteMonthly, resaleProjection } from '../../shared/finance.js';
import { applyPolicy } from '../../shared/policy.js';
import { getState, trackOf, RULED_OUT } from './store.js';

/** @typedef {import('./store.js').Home} Home */
/** @typedef {import('../../shared/profile.js').Profile} Profile */

/**
 * The facts used for rules and money: the AI's, with the buyer's edits on top.
 * @param {Home} home
 */
export function factsOf(home) {
  const a = home.assessment;
  const o = home.overrides || {};
  const pick = (/** @type {string} */ k, /** @type {any} */ v) => (k in o ? o[k] : v);
  return {
    price: pick('price', a.listing.price),
    priceMax: pick('priceMax', a.listing.priceMax),
    propertyType: pick('propertyType', a.listing.propertyType),
    bedrooms: pick('bedrooms', a.listing.bedrooms),
    buildAge: a.listing.buildAge,
    minutesMin: pick('minutesMin', a.commute.minutesMin),
    minutesMax: pick('minutesMax', a.commute.minutesMax),
    farePerDay: pick('farePerDay', a.commute.farePerDay),
    flags: a.flags,
    areaFeel: a.areaFeel.kind,
  };
}

/**
 * @param {Home} home
 * @param {Profile} profile
 */
export function derive(home, profile) {
  const f = factsOf(home);
  const fin = f.price === null ? null : purchaseFinance(f.price, profile);
  const finTop = f.priceMax !== null && f.priceMax !== f.price ? purchaseFinance(f.priceMax, profile) : null;
  const policy = applyPolicy(home.assessment.verdict, f, profile, fin);
  const fares = commuteMonthly(f.farePerDay, profile.move.officeDaysPerWeek, profile.move.workingWeeksPerYear);
  const allIn = fin && fin.monthly !== null && fares !== null ? fin.monthly + fares : null;
  const isNew = f.buildAge === 'new_build' || f.buildAge === 'near_new';
  const assumptions = profile.resale.useMine
    ? { newBuildPremiumPct: isNew ? profile.resale.newBuildPremiumPct : 0, growth5yPct: profile.resale.growth5yPct, growthAnnualPct: profile.resale.growthAnnualPct }
    : home.assessment.resale;
  const years = [...new Set([5, 10, profile.resale.horizonYears])].sort((x, y) => x - y);
  const resale = f.price ? resaleProjection(f.price, assumptions, years) : null;
  const commuteAvg = f.minutesMin !== null && f.minutesMax !== null ? (f.minutesMin + f.minutesMax) / 2 : null;
  return { facts: f, fin, finTop, policy, verdict: policy.verdict, fares, allIn, resale, resaleAssumptions: assumptions, commuteAvg };
}

/** @typedef {ReturnType<typeof derive>} Derived */

/** Cache derived values per home until the home or profile changes. */
const cache = new WeakMap();
/** @param {Home} home */
export function d(home) {
  const profile = getState().profile;
  const hit = cache.get(home);
  if (hit && hit.profile === profile && hit.updatedAt === home.updatedAt) return /** @type {Derived} */ (hit.value);
  const value = derive(home, profile);
  cache.set(home, { profile, updatedAt: home.updatedAt, value });
  return value;
}

const VERDICT_RANK = { worth_viewing: 2, only_if_checks_pass: 1, dont_buy: 0 };
const BIG = 1e12;

export const SORTS = /** @type {Record<string, { label: string, phrase: string, fn: (a: Home, b: Home) => number }>} */ ({
  fit: { label: 'AI fit rating', phrase: 'fit rating', fn: (a, b) => b.assessment.ratings.overall - a.assessment.ratings.overall || VERDICT_RANK[d(b).verdict] - VERDICT_RANK[d(a).verdict] },
  verdict: { label: 'Verdict', phrase: 'verdict', fn: (a, b) => VERDICT_RANK[d(b).verdict] - VERDICT_RANK[d(a).verdict] || b.assessment.ratings.overall - a.assessment.ratings.overall },
  live: { label: 'Liveability', phrase: 'liveability', fn: (a, b) => b.assessment.ratings.liveability - a.assessment.ratings.liveability },
  area: { label: 'Area', phrase: 'area rating', fn: (a, b) => b.assessment.ratings.area - a.assessment.ratings.area },
  commute: { label: 'Commute', phrase: 'shortest commute', fn: (a, b) => (d(a).commuteAvg ?? BIG) - (d(b).commuteAvg ?? BIG) },
  price: { label: 'Price', phrase: 'lowest price', fn: (a, b) => (d(a).facts.price ?? BIG) - (d(b).facts.price ?? BIG) },
  monthly: { label: 'Monthly mortgage', phrase: 'lowest monthly cost', fn: (a, b) => (d(a).fin?.monthly ?? BIG) - (d(b).fin?.monthly ?? BIG) },
  allin: { label: 'Monthly cost with fares', phrase: 'lowest monthly cost with fares', fn: (a, b) => (d(a).allIn ?? BIG) - (d(b).allIn ?? BIG) },
  resale: { label: 'Resale', phrase: '10-year resale change', fn: (a, b) => resale10(b) - resale10(a) },
  mine: { label: 'Your rating', phrase: 'your rating', fn: (a, b) => (trackOf(b.id).myRating ?? -1) - (trackOf(a.id).myRating ?? -1) },
  added: { label: 'Newest first', phrase: 'newest', fn: (a, b) => b.createdAt.localeCompare(a.createdAt) },
});

/** @param {Home} h */
function resale10(h) {
  const p = d(h).resale?.points.find((x) => x.years === 10);
  return p ? p.changePct : -BIG;
}

export const TABS = /** @type {{ key: string, label: string, has: (s: string) => boolean }[]} */ ([
  { key: 'active', label: 'Active', has: (s) => s !== RULED_OUT },
  { key: 'review', label: 'For review', has: (s) => s === 'For review' },
  { key: 'shortlisted', label: 'Shortlisted', has: (s) => s === 'Shortlisted' },
  { key: 'enquired', label: 'Enquired', has: (s) => s === 'Enquired' },
  { key: 'booked', label: 'Viewing booked', has: (s) => s === 'Viewing booked' },
  { key: 'viewed', label: 'Viewed', has: (s) => s === 'Viewed' },
  { key: 'offered', label: 'Offer made', has: (s) => s === 'Offer made' },
  { key: 'archived', label: 'Archived', has: (s) => s === RULED_OUT },
]);

/** @param {string} status */
export function tabFor(status) {
  if (status === RULED_OUT) return 'archived';
  const t = TABS.find((x) => x.key !== 'active' && x.has(status));
  return t ? t.key : 'active';
}

/**
 * Homes in a tab, filtered by verdict and sorted.
 * @param {string} tab
 * @param {string} verdict 'all' or a verdict key
 * @param {string} sort
 */
export function listHomes(tab, verdict, sort) {
  const t = TABS.find((x) => x.key === tab) || TABS[0];
  const fn = (SORTS[sort] || SORTS.fit).fn;
  return Object.values(getState().homes)
    .filter((h) => t.has(trackOf(h.id).status) && (verdict === 'all' || d(h).verdict === verdict))
    .sort((a, b) => fn(a, b) || a.createdAt.localeCompare(b.createdAt));
}

/** The best active home: worth viewing, within the stretch budget, highest rated. */
export function bestHome() {
  const p = getState().profile;
  const cap = p.budget.stretch || p.budget.max || Infinity;
  const pool = Object.values(getState().homes).filter((h) => {
    const x = d(h);
    return trackOf(h.id).status !== RULED_OUT && x.verdict === 'worth_viewing' && x.facts.price !== null && x.facts.price <= cap;
  });
  pool.sort((a, b) => b.assessment.ratings.overall - a.assessment.ratings.overall
    || b.assessment.ratings.liveability - a.assessment.ratings.liveability
    || (d(a).commuteAvg ?? BIG) - (d(b).commuteAvg ?? BIG)
    || (d(a).facts.price ?? BIG) - (d(b).facts.price ?? BIG));
  return pool[0] || null;
}
