import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseProfile, DEFAULT_PROFILE, EXAMPLE_PROFILE, missingProfileItems } from '../src/shared/profile.js';

test('defaults and the example are valid profiles', () => {
  assert.equal(normaliseProfile(DEFAULT_PROFILE).ok, true);
  const ex = normaliseProfile(EXAMPLE_PROFILE);
  assert.deepEqual(ex.errors, []);
  assert.deepEqual(missingProfileItems(ex.profile), []);
});

test('an empty or partial profile is filled from defaults', () => {
  const r = normaliseProfile({ budget: { max: 400000 } });
  assert.equal(r.ok, true);
  assert.equal(r.profile.budget.max, 400000);
  assert.equal(r.profile.move.officeDaysPerWeek, 3);
  assert.ok(missingProfileItems(r.profile).includes('Where you will commute to'));
  assert.equal(normaliseProfile(null).ok, true);
});

test('bad values are rejected; small ones repaired', () => {
  assert.equal(normaliseProfile({ tax: { region: 'atlantis' } }).ok, false);
  assert.equal(normaliseProfile({ budget: { max: 'lots' } }).ok, false);
  const r = normaliseProfile({ move: { officeDaysPerWeek: 9 } });
  assert.equal(r.ok, true);
  assert.equal(r.profile.move.officeDaysPerWeek, 7);
});

test('normalising does not mutate the shared defaults', () => {
  const before = JSON.stringify(DEFAULT_PROFILE);
  const r = normaliseProfile({});
  r.profile.search.mustHaves.push('x');
  r.profile.mortgage.rateBands[0].rate = 99;
  assert.equal(JSON.stringify(DEFAULT_PROFILE), before);
});

test('custom tax bands always end open-ended; rate bands are sorted', () => {
  const r = normaliseProfile({
    tax: { region: 'custom', customBands: [{ upTo: 100000, rate: 0 }, { upTo: 200000, rate: 0.05 }] },
    mortgage: { termYears: 25, rateBands: [{ maxLtv: 90, rate: 6 }, { maxLtv: 60, rate: 5 }] },
  });
  assert.equal(r.ok, true);
  assert.equal(r.profile.tax.customBands.at(-1).upTo, null);
  assert.equal(r.profile.mortgage.rateBands[0].maxLtv, 60);
});
