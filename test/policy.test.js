import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPolicy } from '../src/shared/policy.js';
import { purchaseFinance } from '../src/shared/finance.js';
import { EXAMPLE_PROFILE } from '../src/shared/profile.js';

const flags = (over = {}) => ({
  auction: false, sharedOwnership: false, retirementOnly: false, needsRenovation: false,
  leasehold: false, underOfferOrSold: false, suspectedManipulation: false, ...over,
});
const facts = (over = {}) => ({
  price: 330000, propertyType: 'semi_detached', bedrooms: 3, buildAge: 'new_build',
  minutesMin: 35, minutesMax: 45, flags: flags(), areaFeel: 'quiet', ...over,
});
const run = (f, verdict = 'worth_viewing', profile = EXAMPLE_PROFILE) =>
  applyPolicy(verdict, f, profile, f.price === null ? null : purchaseFinance(f.price, profile));

test('a good fit keeps the AI verdict', () => {
  const r = run(facts());
  assert.equal(r.verdict, 'worth_viewing');
  assert.equal(r.lowered, false);
});

test('rules never raise the AI verdict', () => {
  assert.equal(run(facts(), 'dont_buy').verdict, 'dont_buy');
});

test('excluded categories fail', () => {
  assert.equal(run(facts({ flags: flags({ sharedOwnership: true }) })).verdict, 'dont_buy');
  assert.equal(run(facts({ flags: flags({ retirementOnly: true }) })).verdict, 'dont_buy');
  assert.equal(run(facts({ buildAge: 'older_needs_work' })).verdict, 'dont_buy');
  assert.equal(run(facts({ propertyType: 'flat' })).verdict, 'dont_buy');
  assert.equal(run(facts({ bedrooms: 2 })).verdict, 'dont_buy');
});

test('auctions are flagged, not excluded, by default', () => {
  const r = run(facts({ flags: flags({ auction: true }) }));
  assert.equal(r.verdict, 'worth_viewing');
  assert.ok(r.notes.some((n) => n.level === 'info' && /Auction/.test(n.text)));
  const strict = structuredClone(EXAMPLE_PROFILE);
  strict.search.exclude.auction = 'exclude';
  assert.equal(run(facts({ flags: flags({ auction: true }) }), 'worth_viewing', strict).verdict, 'dont_buy');
});

test('chalet bungalows count as bungalows; end terraces as terraces', () => {
  assert.equal(run(facts({ propertyType: 'chalet_bungalow' })).verdict, 'worth_viewing');
  const p = structuredClone(EXAMPLE_PROFILE);
  p.search.propertyTypes = ['terraced'];
  assert.equal(run(facts({ propertyType: 'end_terrace' }), 'worth_viewing', p).verdict, 'worth_viewing');
});

test('budget rules: over budget caps, over stretch fails, unknown price caps', () => {
  assert.equal(run(facts({ price: 370000 })).verdict, 'only_if_checks_pass');
  assert.equal(run(facts({ price: 390000 })).verdict, 'dont_buy');
  assert.equal(run(facts({ price: null })).verdict, 'only_if_checks_pass');
});

test('monthly ceiling caps the verdict', () => {
  const tight = structuredClone(EXAMPLE_PROFILE);
  tight.budget.monthlyCeiling = 1000;
  const r = run(facts(), 'worth_viewing', tight);
  assert.equal(r.verdict, 'only_if_checks_pass');
  assert.ok(r.notes.some((n) => /over your/.test(n.text)));
});

test('commute rules', () => {
  assert.equal(run(facts({ minutesMin: 50, minutesMax: 55 })).verdict, 'only_if_checks_pass', 'over ideal');
  assert.equal(run(facts({ minutesMin: 55, minutesMax: 75 })).verdict, 'only_if_checks_pass', 'typically over the limit');
  assert.equal(run(facts({ minutesMin: 65, minutesMax: 80 })).verdict, 'dont_buy', 'always over the limit');
  const unknown = run(facts({ minutesMin: null, minutesMax: null }));
  assert.equal(unknown.verdict, 'worth_viewing');
  assert.ok(unknown.notes.some((n) => n.level === 'info'));
});

test('suspected manipulation is capped and explained', () => {
  const r = run(facts({ flags: flags({ suspectedManipulation: true }) }));
  assert.equal(r.verdict, 'only_if_checks_pass');
  assert.equal(r.lowered, true);
});
