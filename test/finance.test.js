import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  propertyTax, monthlyRepayment, rateForLtv, equityFromSale, purchaseFinance,
  maxPriceForMonthly, maxPriceForDeposit, sensitivities, commuteMonthly, resaleProjection,
} from '../src/shared/finance.js';
import { EXAMPLE_PROFILE } from '../src/shared/profile.js';

const tax = (price, region, buyerStatus, nonResident = false) =>
  propertyTax(price, { region, buyerStatus, nonResident, customBands: [] });

test('SDLT standard rates (England and Northern Ireland, from 1 April 2025)', () => {
  assert.equal(tax(125000, 'england-ni', 'mover').total, 0);
  assert.equal(tax(300000, 'england-ni', 'mover').total, 5000);
  assert.equal(tax(550000, 'england-ni', 'mover').total, 17500);
  assert.equal(tax(575000, 'england-ni', 'mover').total, 18750);
  assert.equal(tax(650000, 'england-ni', 'mover').total, 22500);
  assert.equal(tax(1000000, 'england-ni', 'mover').total, 43750);
  assert.equal(tax(2000000, 'england-ni', 'mover').total, 153750);
});

test('SDLT first-time buyer relief up to £500,000', () => {
  assert.equal(tax(300000, 'england-ni', 'first-time').total, 0);
  assert.equal(tax(450000, 'england-ni', 'first-time').total, 7500);
  assert.equal(tax(500000, 'england-ni', 'first-time').total, 10000);
  const over = tax(500001, 'england-ni', 'first-time');
  assert.equal(over.total, 15000);
  assert.match(over.notes.join(' '), /stops above/);
});

test('SDLT higher rates: additional property and overlap with the old home', () => {
  // GOV.UK worked example: £300,000 additional property = £20,000.
  assert.equal(tax(300000, 'england-ni', 'additional').total, 20000);
  const overlap = tax(550000, 'england-ni', 'mover-overlap');
  assert.equal(overlap.total, 45000);
  assert.equal(overlap.base, 17500);
  assert.equal(overlap.reclaimable, 27500);
  assert.equal(tax(39000, 'england-ni', 'additional').surcharge, 0, 'no surcharge under £40,000');
});

test('SDLT non-UK resident surcharge adds 2 points to every band', () => {
  assert.equal(tax(300000, 'england-ni', 'mover', true).total, 11000);
});

test('LBTT (Scotland) including first-time buyer relief and ADS', () => {
  assert.equal(tax(550000, 'scotland', 'mover').total, 28350);
  assert.equal(tax(550000, 'scotland', 'first-time').total, 27750);
  assert.equal(tax(300000, 'scotland', 'additional').total, 4600 + 24000);
});

test('LTT (Wales) main and higher residential rates', () => {
  assert.equal(tax(225000, 'wales', 'mover').total, 0);
  assert.equal(tax(300000, 'wales', 'mover').total, 4500);
  assert.equal(tax(300000, 'wales', 'additional').total, 19950);
  assert.match(tax(300000, 'wales', 'first-time').notes.join(' '), /no first-time buyer relief/);
});

test('custom bands and no tax', () => {
  const custom = propertyTax(200000, { region: 'custom', buyerStatus: 'mover', customBands: [{ upTo: 100000, rate: 0 }, { upTo: null, rate: 0.1 }] });
  assert.equal(custom.total, 10000);
  assert.equal(propertyTax(200000, { region: 'none', buyerStatus: 'mover' }).total, 0);
  assert.throws(() => propertyTax(1, { region: 'atlantis', buyerStatus: 'mover' }));
});

test('monthly repayment matches the standard formula', () => {
  assert.equal(Math.round(monthlyRepayment(100000, 6, 25) * 100) / 100, 644.3);
  assert.equal(monthlyRepayment(120000, 0, 10), 1000);
  assert.equal(monthlyRepayment(0, 5, 25), 0);
});

test('rate bands pick the smallest band that covers the LTV', () => {
  const bands = [{ maxLtv: 95, rate: 6.4 }, { maxLtv: 60, rate: 5.2 }, { maxLtv: 75, rate: 5.4 }];
  assert.equal(rateForLtv(50, bands)?.rate, 5.2);
  assert.equal(rateForLtv(60, bands)?.rate, 5.2);
  assert.equal(rateForLtv(60.01, bands)?.rate, 5.4);
  assert.equal(rateForLtv(96, bands), null);
});

test('equity from a sale includes agent fee with VAT and legal costs', () => {
  const r = equityFromSale({ selling: true, expectedPrice: 240000, mortgageBalance: 150000, agentFeePct: 1.2, agentFeeVat: true, legalFees: 1200, otherCosts: 0 });
  assert.equal(Math.round(r.fee), 3456);
  assert.equal(Math.round(r.equity), 85344);
  assert.equal(equityFromSale({ ...EXAMPLE_PROFILE.sale, selling: false }).equity, 0);
});

test('purchase finance for the example buyer', () => {
  const f = purchaseFinance(325000, EXAMPLE_PROFILE);
  assert.equal(Math.round(f.cash), 100344);
  assert.equal(f.tax.total, 6250);
  assert.equal(Math.round(f.deposit), 89594);
  assert.equal(f.rate, 5.4);
  assert.ok(Math.abs(f.monthly - 1322) <= 1, `monthly was ${f.monthly}`);
  assert.ok(f.overCeiling < 0);
});

test('purchase finance when cash cannot cover tax and costs', () => {
  const broke = structuredClone(EXAMPLE_PROFILE);
  broke.sale.selling = false;
  broke.cash.savings = 1000;
  const f = purchaseFinance(325000, broke);
  assert.ok(f.deposit < 0);
  assert.equal(f.monthly, null);
});

test('price limits are consistent with the monthly ceiling and deposit', () => {
  const max = maxPriceForMonthly(EXAMPLE_PROFILE);
  assert.ok(max > 300000 && max < 600000, `max was ${max}`);
  assert.ok(purchaseFinance(max, EXAMPLE_PROFILE).monthly <= 1600);
  const above = purchaseFinance(max + 2000, EXAMPLE_PROFILE).monthly;
  assert.ok(above === null || above > 1600);
  const dep = maxPriceForDeposit(EXAMPLE_PROFILE, 10);
  assert.ok(purchaseFinance(dep, EXAMPLE_PROFILE).depositPct >= 10);
  assert.ok(purchaseFinance(dep + 2000, EXAMPLE_PROFILE).depositPct < 10);
  assert.equal(maxPriceForMonthly({ ...EXAMPLE_PROFILE, budget: { ...EXAMPLE_PROFILE.budget, monthlyCeiling: 0 } }), null);
});

test('sensitivities move in the expected directions', () => {
  const s = sensitivities(EXAMPLE_PROFILE, 325000);
  assert.ok(s.priceMinus10k < 0);
  assert.ok(s.salePlus10k < 0);
  assert.ok(s.ratePlusHalf > 0);
});

test('commute cost and resale projection', () => {
  assert.equal(commuteMonthly(10, 3, 46), 115);
  assert.equal(commuteMonthly(null, 3, 46), null);
  const r = resaleProjection(300000, { newBuildPremiumPct: 10, growth5yPct: 10, growthAnnualPct: 3 }, [5, 10]);
  assert.equal(Math.round(r.dayOne), 270000);
  assert.equal(Math.round(r.points[0].value), 297000);
  assert.equal(Math.round(r.points[1].value), 344304);
});
