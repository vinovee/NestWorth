// @ts-check
/**
 * Deterministic money maths. The AI never does arithmetic in this app: it extracts
 * facts and gives judgement, and every number a buyer relies on comes from here.
 * Everything is a pure function, so it runs the same in the browser, on the server
 * and in tests.
 */
import { TAX_REGIONS } from './tax-rules.js';

/** @typedef {import('./tax-rules.js').Band} Band */
/** @typedef {import('./profile.js').Profile} Profile */

const VAT_RATE = 0.2;

/** Round down to whole pounds, as UK property taxes are. */
const floorPounds = (/** @type {number} */ n) => Math.floor(n + 1e-6);

/**
 * Tax on a price under progressive bands.
 * @param {number} price
 * @param {Band[]} bands
 * @param {number} [addRate] points added to every band's rate, as a fraction
 */
export function progressiveTax(price, bands, addRate = 0) {
  /** @type {{ from: number, to: number | null, rate: number, amount: number, tax: number }[]} */
  const lines = [];
  let total = 0;
  let from = 0;
  for (const band of bands) {
    if (price <= from) break;
    const top = band.upTo === null ? price : Math.min(price, band.upTo);
    const amount = Math.max(0, top - from);
    const rate = band.rate + addRate;
    const tax = amount * rate;
    lines.push({ from, to: band.upTo, rate, amount, tax });
    total += tax;
    if (band.upTo === null) break;
    from = band.upTo;
  }
  return { total, lines };
}

/**
 * @typedef {object} TaxResult
 * @property {number} total        tax payable on completion
 * @property {number} base         tax before any higher-rate surcharge
 * @property {number} surcharge    higher-rate element included in total
 * @property {number} reclaimable  part of the surcharge that can usually be reclaimed later
 * @property {string} label
 * @property {string[]} notes
 */

/**
 * Residential purchase tax for a price and buyer situation.
 * @param {number} price
 * @param {{ region: string, buyerStatus: string, nonResident?: boolean, customBands?: Band[] }} opts
 * @returns {TaxResult}
 */
export function propertyTax(price, opts) {
  /** @type {TaxResult} */
  const none = { total: 0, base: 0, surcharge: 0, reclaimable: 0, label: 'No purchase tax', notes: [] };
  if (!(price > 0) || opts.region === 'none') return none;

  if (opts.region === 'custom') {
    const bands = opts.customBands || [];
    const total = floorPounds(progressiveTax(price, bands).total);
    return { total, base: total, surcharge: 0, reclaimable: 0, label: 'Your custom tax bands', notes: [] };
  }

  const rules = TAX_REGIONS[opts.region];
  if (!rules) throw new Error(`Unknown tax region: ${opts.region}`);

  /** @type {string[]} */
  const notes = [];
  const status = opts.buyerStatus;
  const nonRes = opts.nonResident && rules.nonResident ? rules.nonResident.addRate : 0;

  let baseBands = rules.standard;
  if (status === 'first-time') {
    const ftb = rules.firstTimeBuyer;
    if (ftb && (ftb.maxPrice === null || price <= ftb.maxPrice)) {
      baseBands = ftb.bands;
      notes.push('First-time buyer relief applied.');
    } else if (ftb) {
      notes.push(`First-time buyer relief stops above £${ftb.maxPrice?.toLocaleString('en-GB')}, so standard rates apply.`);
    } else {
      notes.push(`${rules.name} has no first-time buyer relief.`);
    }
  }
  const base = progressiveTax(price, baseBands, nonRes).total;

  let surcharge = 0;
  const higher = status === 'additional' || status === 'mover-overlap';
  const extra = rules.additional;
  if (higher && extra && price >= extra.minPrice) {
    if (extra.kind === 'add-to-bands') {
      surcharge = progressiveTax(price, rules.standard, nonRes + extra.addRate).total - base;
    } else if (extra.kind === 'flat-on-price') {
      surcharge = price * extra.rate;
    } else {
      surcharge = progressiveTax(price, extra.bands).total - base;
    }
  }
  if (status === 'mover-overlap' && surcharge > 0) {
    notes.push('Includes the higher rates because you would still own your current home at completion. This part can usually be reclaimed if you sell your previous main home within the time limit; your conveyancer can confirm.');
  }
  if (status === 'additional' && surcharge > 0) notes.push('Higher rates for an additional property apply.');
  if (nonRes) notes.push('Includes the non-UK resident surcharge.');

  const total = floorPounds(base + surcharge);
  return {
    total,
    base: floorPounds(base),
    surcharge: total - floorPounds(base),
    reclaimable: status === 'mover-overlap' ? total - floorPounds(base) : 0,
    label: rules.tax,
    notes,
  };
}

/**
 * Monthly payment on a capital-and-interest (repayment) mortgage.
 * @param {number} principal
 * @param {number} annualRatePct e.g. 5.5 for 5.5%
 * @param {number} years
 */
export function monthlyRepayment(principal, annualRatePct, years) {
  if (!(principal > 0)) return 0;
  const n = Math.max(1, Math.round(years * 12));
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

/**
 * The rate for a loan-to-value, from bands like [{ maxLtv: 75, rate: 5.6 }].
 * Returns null when the LTV is above every band (deposit too small).
 * @param {number} ltvPct
 * @param {{ maxLtv: number, rate: number }[]} bands
 */
export function rateForLtv(ltvPct, bands) {
  const sorted = [...bands].sort((a, b) => a.maxLtv - b.maxLtv);
  return sorted.find((b) => ltvPct <= b.maxLtv + 1e-9) || null;
}

/**
 * Money released by selling the current home.
 * @param {Profile['sale']} sale
 */
export function equityFromSale(sale) {
  if (!sale.selling) return { equity: 0, fee: 0, costs: 0 };
  const fee = sale.expectedPrice * (sale.agentFeePct / 100) * (sale.agentFeeVat ? 1 + VAT_RATE : 1);
  const costs = fee + sale.legalFees + sale.otherCosts;
  return { equity: sale.expectedPrice - sale.mortgageBalance - costs, fee, costs };
}

/**
 * Cash available for a purchase before tax and buying costs.
 * @param {Profile} profile
 */
export function cashAvailable(profile) {
  const { equity } = equityFromSale(profile.sale);
  return { equity, savings: profile.cash.savings, total: equity + profile.cash.savings };
}

/**
 * @typedef {object} PurchaseFinance
 * @property {number} price
 * @property {number} cash          equity plus savings
 * @property {TaxResult} tax
 * @property {number} deposit       cash left after tax and buying costs
 * @property {number} depositPct
 * @property {number} loan
 * @property {number} ltvPct
 * @property {number | null} rate   null when no rate band covers the LTV
 * @property {number | null} monthly
 * @property {number | null} overCeiling  pounds a month over the ceiling (negative = under), null if no ceiling
 */

/**
 * Everything about paying for one home at one price.
 * @param {number} price
 * @param {Profile} profile
 * @param {{ saleDelta?: number, rateDelta?: number }} [tweak] for sensitivities
 * @returns {PurchaseFinance}
 */
export function purchaseFinance(price, profile, tweak = {}) {
  const sale = { ...profile.sale, expectedPrice: profile.sale.expectedPrice + (tweak.saleDelta || 0) };
  const cash = cashAvailable({ ...profile, sale }).total;
  const tax = propertyTax(price, profile.tax);
  const deposit = cash - tax.total - profile.cash.buyingCosts;
  const loan = Math.max(0, price - Math.max(0, deposit));
  const ltvPct = price > 0 ? (loan / price) * 100 : 0;
  const shortOfCosts = deposit < 0;
  const band = shortOfCosts ? null : rateForLtv(ltvPct, profile.mortgage.rateBands);
  const rate = band ? band.rate + (tweak.rateDelta || 0) : null;
  const monthly = rate === null ? null : Math.round(monthlyRepayment(loan, rate, profile.mortgage.termYears));
  const ceiling = profile.budget.monthlyCeiling;
  return {
    price,
    cash,
    tax,
    deposit,
    depositPct: price > 0 ? (deposit / price) * 100 : 0,
    loan,
    ltvPct,
    rate,
    monthly,
    overCeiling: ceiling > 0 && monthly !== null ? monthly - ceiling : null,
  };
}

/**
 * Largest price (to the nearest £1,000 below) that satisfies a test which gets
 * harder as the price rises.
 * @param {(price: number) => boolean} ok
 * @param {number} [hi]
 */
function maxPriceWhere(ok, hi = 20_000_000) {
  if (!ok(1000)) return 0;
  let lo = 1000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo / 1000) * 1000;
}

/**
 * Highest price that keeps the estimated mortgage at or under a monthly figure.
 * @param {Profile} profile
 * @param {number} [ceiling]
 */
export function maxPriceForMonthly(profile, ceiling = profile.budget.monthlyCeiling) {
  if (!(ceiling > 0)) return null;
  return maxPriceWhere((p) => {
    const f = purchaseFinance(p, profile);
    return f.monthly !== null && f.monthly <= ceiling;
  });
}

/**
 * Highest price at which the deposit is still at least a given share of the price.
 * @param {Profile} profile
 * @param {number} minDepositPct
 */
export function maxPriceForDeposit(profile, minDepositPct) {
  return maxPriceWhere((p) => purchaseFinance(p, profile).depositPct >= minDepositPct);
}

/**
 * How the monthly payment moves when the inputs move. Positive = costs more.
 * @param {Profile} profile
 * @param {number} price
 */
export function sensitivities(profile, price) {
  const now = purchaseFinance(price, profile).monthly;
  const diff = (/** @type {number | null} */ m) => (now === null || m === null ? null : m - now);
  return {
    priceMinus10k: diff(purchaseFinance(price - 10000, profile).monthly),
    salePlus10k: profile.sale.selling ? diff(purchaseFinance(price, profile, { saleDelta: 10000 }).monthly) : null,
    ratePlusHalf: diff(purchaseFinance(price, profile, { rateDelta: 0.5 }).monthly),
  };
}

/**
 * Commute fares spread over a month.
 * @param {number | null} farePerDay
 * @param {number} daysPerWeek
 * @param {number} weeksPerYear
 */
export function commuteMonthly(farePerDay, daysPerWeek, weeksPerYear) {
  if (farePerDay === null || !(farePerDay >= 0)) return null;
  return (farePerDay * daysPerWeek * weeksPerYear) / 12;
}

/**
 * Rough resale value path: a new-build premium comes off on day one, then
 * total growth over the first five years, then a steady annual rate.
 * These are estimates to compare homes, not valuations.
 * @param {number} price
 * @param {{ newBuildPremiumPct: number, growth5yPct: number, growthAnnualPct: number }} a
 * @param {number[]} years
 */
export function resaleProjection(price, a, years) {
  const dayOne = price * (1 - a.newBuildPremiumPct / 100);
  const at5 = dayOne * (1 + a.growth5yPct / 100);
  const valueAt = (/** @type {number} */ y) =>
    y <= 5 ? dayOne * Math.pow(1 + a.growth5yPct / 100, y / 5) : at5 * Math.pow(1 + a.growthAnnualPct / 100, y - 5);
  return {
    dayOne,
    points: years.map((y) => {
      const value = valueAt(y);
      return { years: y, value, changePct: price > 0 ? (value / price - 1) * 100 : 0 };
    }),
  };
}
