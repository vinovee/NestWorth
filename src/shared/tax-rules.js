// @ts-check
/**
 * Residential property purchase taxes for the UK nations.
 *
 * This file is data, not logic. When a government changes its rates, update the
 * bands here, change `effectiveFrom`, set RULES_LAST_CHECKED and add a test case.
 * Rates are fractions (0.05 = 5%). A band with `upTo: null` has no upper limit.
 *
 * Sources (checked 17 November 2026):
 * - England and Northern Ireland, SDLT: rates from 1 April 2025; first-time buyer
 *   relief to £500,000; higher rates for additional dwellings 5 points from
 *   31 October 2024; non-UK resident surcharge 2 points.
 * - Scotland, LBTT: residential bands unchanged since 1 April 2021 and kept for
 *   2026-27; first-time buyer relief raises the nil band to £175,000; Additional
 *   Dwelling Supplement 8% of the price from 5 December 2024.
 * - Wales, LTT: main residential bands from 10 October 2022, unchanged for
 *   2026-27; higher residential rates from 11 December 2024; no first-time buyer relief.
 */

/** @typedef {{ upTo: number | null, rate: number }} Band */

/**
 * @typedef {object} TaxRegion
 * @property {string} name
 * @property {string} tax
 * @property {string} effectiveFrom
 * @property {string[]} sources
 * @property {Band[]} standard
 * @property {{ maxPrice: number | null, bands: Band[] } | null} firstTimeBuyer
 * @property {{ kind: 'add-to-bands', addRate: number, minPrice: number }
 *   | { kind: 'flat-on-price', rate: number, minPrice: number }
 *   | { kind: 'own-bands', bands: Band[], minPrice: number } | null} additional
 * @property {{ addRate: number } | null} nonResident
 */

export const RULES_LAST_CHECKED = '2026-11-17';

/** @type {Record<string, TaxRegion>} */
export const TAX_REGIONS = {
  'england-ni': {
    name: 'England and Northern Ireland',
    tax: 'Stamp Duty Land Tax (SDLT)',
    effectiveFrom: '2025-04-01',
    sources: [
      'https://www.gov.uk/government/publications/budget-2025-overview-of-tax-legislation-and-rates-ootlar/annex-a-rates-and-allowances',
      'https://www.gov.uk/guidance/stamp-duty-land-tax-relief-for-land-or-property-transactions',
      'https://www.gov.uk/guidance/stamp-duty-land-tax-buying-an-additional-residential-property',
    ],
    standard: [
      { upTo: 125000, rate: 0 },
      { upTo: 250000, rate: 0.02 },
      { upTo: 925000, rate: 0.05 },
      { upTo: 1500000, rate: 0.1 },
      { upTo: null, rate: 0.12 },
    ],
    firstTimeBuyer: {
      maxPrice: 500000,
      bands: [
        { upTo: 300000, rate: 0 },
        { upTo: 500000, rate: 0.05 },
      ],
    },
    additional: { kind: 'add-to-bands', addRate: 0.05, minPrice: 40000 },
    nonResident: { addRate: 0.02 },
  },
  scotland: {
    name: 'Scotland',
    tax: 'Land and Buildings Transaction Tax (LBTT)',
    effectiveFrom: '2021-04-01',
    sources: [
      'https://revenue.scot/taxes/land-buildings-transaction-tax/residential-property',
      'https://revenue.scot/taxes/land-buildings-transaction-tax/lbtt-updates',
      'https://www.gov.scot/publications/scottish-budget-2026-2027/pages/4/',
    ],
    standard: [
      { upTo: 145000, rate: 0 },
      { upTo: 250000, rate: 0.02 },
      { upTo: 325000, rate: 0.05 },
      { upTo: 750000, rate: 0.1 },
      { upTo: null, rate: 0.12 },
    ],
    firstTimeBuyer: {
      maxPrice: null,
      bands: [
        { upTo: 175000, rate: 0 },
        { upTo: 250000, rate: 0.02 },
        { upTo: 325000, rate: 0.05 },
        { upTo: 750000, rate: 0.1 },
        { upTo: null, rate: 0.12 },
      ],
    },
    additional: { kind: 'flat-on-price', rate: 0.08, minPrice: 40000 },
    nonResident: null,
  },
  wales: {
    name: 'Wales',
    tax: 'Land Transaction Tax (LTT)',
    effectiveFrom: '2022-10-10',
    sources: ['https://www.gov.wales/land-transaction-tax-rates-and-bands'],
    standard: [
      { upTo: 225000, rate: 0 },
      { upTo: 400000, rate: 0.06 },
      { upTo: 750000, rate: 0.075 },
      { upTo: 1500000, rate: 0.1 },
      { upTo: null, rate: 0.12 },
    ],
    firstTimeBuyer: null,
    additional: {
      kind: 'own-bands',
      minPrice: 40000,
      bands: [
        { upTo: 180000, rate: 0.05 },
        { upTo: 250000, rate: 0.085 },
        { upTo: 400000, rate: 0.1 },
        { upTo: 750000, rate: 0.125 },
        { upTo: 1500000, rate: 0.15 },
        { upTo: null, rate: 0.17 },
      ],
    },
    nonResident: null,
  },
};

/** Region keys the app accepts, including the two that need no rule data. */
export const REGION_KEYS = [...Object.keys(TAX_REGIONS), 'custom', 'none'];

/**
 * Buyer situations, in plain words.
 * - first-time: has never owned a home anywhere.
 * - mover: replacing a main home that is sold on or before completion.
 * - mover-overlap: replacing a main home that is still owned at completion. The
 *   surcharge is paid up front and can usually be reclaimed once the old home sells.
 * - additional: a second home or buy-to-let; the surcharge is not reclaimable.
 */
export const BUYER_STATUSES = ['first-time', 'mover', 'mover-overlap', 'additional'];
