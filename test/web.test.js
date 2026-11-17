import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAmount, money, moneyShort, signedPct, minutesRange } from '../src/shared/format.js';
import { manualAssessment } from '../src/shared/manual.js';
import { validateAssessment } from '../src/shared/schema.js';
import { DEMO_LISTINGS } from '../src/web/js/demo-listings.js';
import { sampleAssessment } from './fixtures/assessment.js';

/** Minimal browser globals so the store can run under Node. */
let store;
before(async () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  globalThis.window = globalThis;
  store = await import('../src/web/js/store.js');
});

test('amounts typed by people are parsed', () => {
  assert.equal(parseAmount('£550,000'), 550000);
  assert.equal(parseAmount('550k'), 550000);
  assert.equal(parseAmount('1.2m'), 1200000);
  assert.equal(parseAmount(' 12.40 '), 12.4);
  assert.equal(parseAmount(''), null);
  assert.ok(Number.isNaN(parseAmount('lots')));
  assert.ok(Number.isNaN(parseAmount('-5')));
});

test('formatting', () => {
  assert.equal(money(325000), '£325,000');
  assert.equal(moneyShort(325000), '£325k');
  assert.equal(moneyShort(1250000), '£1.25m');
  assert.equal(signedPct(12.4), '+12%');
  assert.equal(signedPct(-3), '−3%');
  assert.equal(minutesRange(40, 50), '40–50 min');
  assert.equal(minutesRange(null, null), 'Not estimated');
});

test('homes entered by hand produce valid assessments', () => {
  const a = manualAssessment({ title: 'Plot 4', address: '', url: '', price: 300000, priceMax: null, propertyType: 'castle', bedrooms: 3, minutesMin: 40, minutesMax: null, farePerDay: null, notes: '', destination: 'Leeds' });
  const r = validateAssessment(a);
  assert.deepEqual(r.errors, []);
  assert.equal(r.value.listing.propertyType, 'unknown');
  assert.equal(r.value.commute.minutesMax, 40);
});

test('demo listings match the example files', () => {
  for (const d of DEMO_LISTINGS) {
    assert.equal(d.text, readFileSync(new URL(`../examples/listings/${d.file}`, import.meta.url), 'utf8'), d.file);
  }
});

test('export and import round trip', () => {
  const id = store.addHome({ assessment: sampleAssessment(), meta: { model: 'm' }, listingText: 'x', source: { type: 'pasted', url: '' } });
  store.setStatus(id, 'Shortlisted');
  store.addNote(id, 'Lovely garden');
  const json = store.exportJson();
  store.clearAll();
  assert.equal(Object.keys(store.getState().homes).length, 0);
  const r = store.importJson(json);
  assert.equal(r.ok, true, r.message);
  assert.equal(store.trackOf(id).status, 'Shortlisted');
  assert.equal(store.trackOf(id).notes[0].text, 'Lovely garden');
});

test('imports are treated as untrusted and checked', () => {
  assert.equal(store.importJson('not json').ok, false);
  assert.equal(store.importJson(JSON.stringify({ app: 'something-else' })).ok, false);
  const bad = sampleAssessment();
  bad.verdict = 'buy it now';
  const file = {
    app: 'nestworth',
    profile: {},
    homes: [
      { id: 'good-1', assessment: sampleAssessment(), overrides: { price: 1, propertyType: 'flat', evil: '<script>' } },
      { id: 'bad-1', assessment: bad },
      { id: '../../etc', assessment: sampleAssessment() },
    ],
    track: { 'good-1': { status: 'Hacked', myRating: 99, reasons: ['cost', 'nonsense'], notes: [{ text: 'ok' }, { nope: 1 }] }, 'missing': { status: 'Viewed' } },
  };
  const r = store.importJson(JSON.stringify(file));
  assert.equal(r.ok, true);
  assert.match(r.message, /skipped 2/);
  const s = store.getState();
  assert.deepEqual(Object.keys(s.homes), ['good-1']);
  assert.deepEqual(s.homes['good-1'].overrides, { price: 1, propertyType: 'flat' });
  const t = store.trackOf('good-1');
  assert.equal(t.status, '');
  assert.equal(t.myRating, null);
  assert.deepEqual(t.reasons, ['cost']);
  assert.equal(t.notes.length, 1);
  assert.equal(s.track.missing, undefined);
});
