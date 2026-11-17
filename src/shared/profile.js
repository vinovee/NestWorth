// @ts-check
/**
 * The buyer's inputs. Nothing about any particular person is built into the app:
 * everything that was hard-coded in the original single-user dashboard (budget,
 * sale price, mortgage, commute destination, criteria) is an input here.
 *
 * Privacy: the full profile stays in the browser. Only `criteriaForAI` is sent to
 * the server, and it leaves out the sale price, mortgage balance and savings.
 */
import { validate } from './validate.js';
import { PROPERTY_TYPES } from './schema.js';
import { REGION_KEYS, BUYER_STATUSES } from './tax-rules.js';
import { maxPriceForMonthly } from './finance.js';

/** @typedef {import('./validate.js').Schema} Schema */

/**
 * @typedef {object} Profile
 * @property {number} version
 * @property {'GBP'|'EUR'|'USD'} currency
 * @property {{ destination: string, officeDaysPerWeek: number, workingWeeksPerYear: number, idealCommuteMin: number, maxCommuteMin: number }} move
 * @property {{ target: number, max: number, stretch: number, monthlyCeiling: number }} budget
 * @property {{ selling: boolean, expectedPrice: number, mortgageBalance: number, agentFeePct: number, agentFeeVat: boolean, legalFees: number, otherCosts: number }} sale
 * @property {{ savings: number, buyingCosts: number }} cash
 * @property {{ termYears: number, rateBands: { maxLtv: number, rate: number }[] }} mortgage
 * @property {{ region: string, buyerStatus: string, nonResident: boolean, customBands: { upTo: number | null, rate: number }[] }} tax
 * @property {{ propertyTypes: string[], minBedrooms: number, buildAge: string, mustHaves: string[], niceToHaves: string[], areasFocus: string[], areasAvoid: string[], flexOrder: string[], exclude: { sharedOwnership: boolean, retirement: boolean, renovation: boolean, auction: string, leasehold: string }, notesForAI: string }} search
 * @property {{ horizonYears: number, growth5yPct: number, growthAnnualPct: number, newBuildPremiumPct: number, useMine: boolean }} resale
 * @property {{ research: boolean }} ai
 * @property {{ frequency: 'weekly' | 'daily' | 'off' }} refresh  how often to re-check homes added by link
 */

export const PROFILE_VERSION = 1;
export const BUILD_AGE_PREFS = ['new_only', 'new_or_near_new', 'no_work_needed', 'any'];
export const BUILD_AGE_PREF_LABELS = {
  new_only: 'New builds only',
  new_or_near_new: 'New or near-new; older only if it needs no work',
  no_work_needed: 'Any age, as long as it needs no work',
  any: 'Any age or condition',
};
export const FLAG_CHOICES = ['allow', 'flag', 'exclude'];
export const REFRESH_FREQUENCIES = ['weekly', 'daily', 'off'];

/** Illustrative rates only. Every user should replace them with their broker's quotes. */
export const EXAMPLE_RATE_BANDS = [
  { maxLtv: 60, rate: 5.2 },
  { maxLtv: 75, rate: 5.4 },
  { maxLtv: 85, rate: 5.7 },
  { maxLtv: 90, rate: 6.0 },
  { maxLtv: 95, rate: 6.4 },
];

/** @type {Profile} */
export const DEFAULT_PROFILE = {
  version: PROFILE_VERSION,
  currency: 'GBP',
  move: { destination: '', officeDaysPerWeek: 3, workingWeeksPerYear: 46, idealCommuteMin: 45, maxCommuteMin: 60 },
  budget: { target: 0, max: 0, stretch: 0, monthlyCeiling: 0 },
  sale: { selling: false, expectedPrice: 0, mortgageBalance: 0, agentFeePct: 1.2, agentFeeVat: true, legalFees: 1500, otherCosts: 0 },
  cash: { savings: 0, buyingCosts: 5000 },
  mortgage: { termYears: 30, rateBands: EXAMPLE_RATE_BANDS },
  tax: { region: 'england-ni', buyerStatus: 'mover', nonResident: false, customBands: [] },
  search: {
    propertyTypes: ['detached', 'semi_detached', 'terraced', 'end_terrace', 'bungalow', 'chalet_bungalow', 'townhouse', 'flat', 'maisonette'],
    minBedrooms: 1,
    buildAge: 'any',
    mustHaves: [],
    niceToHaves: [],
    areasFocus: [],
    areasAvoid: [],
    flexOrder: [],
    exclude: { sharedOwnership: false, retirement: false, renovation: false, auction: 'flag', leasehold: 'flag' },
    notesForAI: '',
  },
  resale: { horizonYears: 10, growth5yPct: 10, growthAnnualPct: 2.5, newBuildPremiumPct: 8, useMine: false },
  ai: { research: false },
  refresh: { frequency: 'weekly' },
};

/**
 * A fictional buyer, used for the demo and the evals. Not a real person.
 * @type {Profile}
 */
export const EXAMPLE_PROFILE = {
  ...DEFAULT_PROFILE,
  move: { destination: 'Manchester Piccadilly station', officeDaysPerWeek: 3, workingWeeksPerYear: 46, idealCommuteMin: 45, maxCommuteMin: 60 },
  budget: { target: 325000, max: 360000, stretch: 380000, monthlyCeiling: 1600 },
  sale: { selling: true, expectedPrice: 240000, mortgageBalance: 150000, agentFeePct: 1.2, agentFeeVat: true, legalFees: 1200, otherCosts: 0 },
  cash: { savings: 15000, buyingCosts: 4500 },
  search: {
    ...DEFAULT_PROFILE.search,
    propertyTypes: ['detached', 'semi_detached', 'bungalow', 'chalet_bungalow'],
    minBedrooms: 3,
    buildAge: 'no_work_needed',
    mustHaves: ['Garden big enough for children to play', 'Off-street parking'],
    niceToHaves: ['A room that works as a home office', 'Walking distance to a station'],
    areasFocus: ['Stockport', 'Sale', 'Altrincham'],
    flexOrder: ['Commute up to 70 minutes', 'Budget up to the stretch figure'],
    exclude: { sharedOwnership: true, retirement: true, renovation: true, auction: 'flag', leasehold: 'flag' },
    notesForAI: 'We cycle a lot, so a garage or secure shed for bikes matters.',
  },
};

/** @param {Record<string, Schema>} properties @returns {Schema} */
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
/** @param {number} minimum @param {number} maximum @returns {Schema} */
const num = (minimum, maximum) => ({ type: 'number', minimum, maximum });
/** @param {number} maxItems @param {number} maxLength @returns {Schema} */
const strList = (maxItems, maxLength) => ({ type: 'array', maxItems, items: { type: 'string', maxLength } });
const MONEY = num(0, 100000000);

/** @type {Schema} */
export const PROFILE_SCHEMA = obj({
  version: num(1, 100),
  currency: { type: 'string', enum: ['GBP', 'EUR', 'USD'] },
  move: obj({
    destination: { type: 'string', maxLength: 160 },
    officeDaysPerWeek: num(0, 7),
    workingWeeksPerYear: num(1, 52),
    idealCommuteMin: num(0, 300),
    maxCommuteMin: num(0, 300),
  }),
  budget: obj({ target: MONEY, max: MONEY, stretch: MONEY, monthlyCeiling: MONEY }),
  sale: obj({
    selling: { type: 'boolean' },
    expectedPrice: MONEY,
    mortgageBalance: MONEY,
    agentFeePct: num(0, 10),
    agentFeeVat: { type: 'boolean' },
    legalFees: MONEY,
    otherCosts: MONEY,
  }),
  cash: obj({ savings: MONEY, buyingCosts: MONEY }),
  mortgage: obj({
    termYears: num(1, 40),
    rateBands: { type: 'array', maxItems: 8, items: obj({ maxLtv: num(1, 100), rate: num(0, 25) }) },
  }),
  tax: obj({
    region: { type: 'string', enum: REGION_KEYS },
    buyerStatus: { type: 'string', enum: BUYER_STATUSES },
    nonResident: { type: 'boolean' },
    customBands: {
      type: 'array',
      maxItems: 10,
      items: obj({ upTo: { anyOf: [MONEY, { type: 'null' }] }, rate: num(0, 1) }),
    },
  }),
  search: obj({
    propertyTypes: { type: 'array', maxItems: 12, items: { type: 'string', enum: PROPERTY_TYPES } },
    minBedrooms: num(0, 30),
    buildAge: { type: 'string', enum: BUILD_AGE_PREFS },
    mustHaves: strList(15, 200),
    niceToHaves: strList(15, 200),
    areasFocus: strList(20, 120),
    areasAvoid: strList(20, 120),
    flexOrder: strList(8, 200),
    exclude: obj({
      sharedOwnership: { type: 'boolean' },
      retirement: { type: 'boolean' },
      renovation: { type: 'boolean' },
      auction: { type: 'string', enum: FLAG_CHOICES },
      leasehold: { type: 'string', enum: FLAG_CHOICES },
    }),
    notesForAI: { type: 'string', maxLength: 1500 },
  }),
  resale: obj({
    horizonYears: num(1, 30),
    growth5yPct: num(-50, 100),
    growthAnnualPct: num(-10, 20),
    newBuildPremiumPct: num(-50, 50),
    useMine: { type: 'boolean' },
  }),
  ai: obj({ research: { type: 'boolean' } }),
  refresh: obj({ frequency: { type: 'string', enum: REFRESH_FREQUENCIES } }),
});

const isPlainObject = (/** @type {unknown} */ v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Recursively fill gaps in `input` from `base`. Arrays and values from input win.
 * @param {any} base
 * @param {any} input
 * @returns {any}
 */
function fillFrom(base, input) {
  if (!isPlainObject(base) || !isPlainObject(input)) return input === undefined ? structuredClone(base) : input;
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(base)) out[key] = fillFrom(base[key], input[key]);
  for (const key of Object.keys(input)) if (!(key in out)) out[key] = input[key];
  return out;
}

/**
 * Bring any saved or imported profile up to the current shape and validate it.
 * Missing fields take default values, so older saved profiles keep working.
 * @param {unknown} input
 * @returns {{ ok: boolean, profile: Profile, errors: string[], warnings: string[] }}
 */
export function normaliseProfile(input) {
  const merged = fillFrom(DEFAULT_PROFILE, isPlainObject(input) ? input : {});
  merged.version = PROFILE_VERSION;
  const result = validate(PROFILE_SCHEMA, merged);
  if (!result.ok) return { ok: false, profile: structuredClone(DEFAULT_PROFILE), errors: result.errors, warnings: result.warnings };
  const profile = /** @type {Profile} */ (result.value);
  profile.mortgage.rateBands.sort((a, b) => a.maxLtv - b.maxLtv);
  const bands = profile.tax.customBands;
  if (bands.length) bands[bands.length - 1].upTo = null;
  return { ok: true, profile, errors: [], warnings: result.warnings };
}

/**
 * What still needs filling in before assessments are meaningful.
 * @param {Profile} p
 */
export function missingProfileItems(p) {
  /** @type {string[]} */
  const missing = [];
  if (!p.move.destination.trim()) missing.push('Where you will commute to');
  if (!(p.budget.max > 0)) missing.push('Your maximum budget');
  if (!(p.budget.monthlyCeiling > 0)) missing.push('Your monthly mortgage ceiling');
  if (!p.search.propertyTypes.length) missing.push('At least one type of home');
  return missing;
}

/**
 * The minimum the AI needs to judge fit. Leaves out sale price, mortgage balance,
 * savings and other personal finances; sends a derived price limit instead.
 * @param {Profile} p
 */
export function criteriaForAI(p) {
  const ex = p.search.exclude;
  /** @type {string[]} */
  const exclusions = [];
  /** @type {string[]} */
  const flagsWanted = [];
  if (ex.sharedOwnership) exclusions.push('Shared ownership');
  if (ex.retirement) exclusions.push('Retirement or age-restricted homes');
  if (ex.renovation) exclusions.push('Homes that need renovation or modernisation');
  if (ex.auction === 'exclude') exclusions.push('Auction sales');
  if (ex.auction === 'flag') flagsWanted.push('Auction sales, including the Modern Method of Auction');
  if (ex.leasehold === 'exclude') exclusions.push('Leasehold homes');
  if (ex.leasehold === 'flag') flagsWanted.push('Leasehold tenure');
  return {
    currency: p.currency,
    destination: p.move.destination,
    officeDaysPerWeek: p.move.officeDaysPerWeek,
    idealCommuteMin: p.move.idealCommuteMin,
    maxCommuteMin: p.move.maxCommuteMin,
    budget: {
      target: p.budget.target,
      max: p.budget.max,
      stretch: p.budget.stretch,
      affordableAtCeiling: maxPriceForMonthly(p),
    },
    propertyTypes: p.search.propertyTypes,
    minBedrooms: p.search.minBedrooms,
    buildAge: p.search.buildAge,
    mustHaves: p.search.mustHaves,
    niceToHaves: p.search.niceToHaves,
    exclusions,
    flagsWanted,
    areasFocus: p.search.areasFocus,
    areasAvoid: p.search.areasAvoid,
    flexOrder: p.search.flexOrder,
    notesForAI: p.search.notesForAI,
  };
}
