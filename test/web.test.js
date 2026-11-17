import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAmount, money, moneyShort, signedPct, minutesRange } from '../src/shared/format.js';
import { manualAssessment } from '../src/shared/manual.js';
import { validateAssessment } from '../src/shared/schema.js';
import { DEMO_LISTINGS } from '../src/web/js/demo-listings.js';
import { sampleAssessment } from './fixtures/assessment.js';
import { dueHomes, canRefresh, RULED_OUT_STATUS, REFRESH_EVERY_MS } from '../src/web/js/schedule.js';

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

test('scheduled refresh picks only active homes added by link that are due', () => {
  assert.equal(RULED_OUT_STATUS, store.RULED_OUT, 'schedule.js and store.js agree on "Ruled out"');
  const day = REFRESH_EVERY_MS.daily;
  const now = Date.parse('2026-11-20T12:00:00Z');
  const ago = (days) => new Date(now - days * day).toISOString();
  const home = (id, over) => ({ id, createdAt: ago(30), source: { type: 'link', url: `https://www.example.com/${id}` }, meta: { assessedAt: ago(30) }, ...over });
  const state = {
    profile: { refresh: { frequency: 'weekly' } },
    homes: {
      due: home('due', { refresh: { checkedAt: ago(8), result: 'unchanged' } }),
      oldest: home('oldest', {}),
      recent: home('recent', { refresh: { checkedAt: ago(2), result: 'unchanged' } }),
      gone: home('gone', { refresh: { checkedAt: ago(9), result: 'gone' } }),
      pasted: home('pasted', { source: { type: 'pasted', url: 'https://www.example.com/p' } }),
      ruled: home('ruled', {}),
    },
    track: { ruled: { status: 'Ruled out' } },
  };
  assert.deepEqual(dueHomes(state, now).map((x) => x.id), ['oldest', 'due'], 'oldest first; recent, gone, pasted and ruled-out skipped');
  assert.deepEqual(dueHomes(state, now, true).map((x) => x.id).sort(), ['due', 'gone', 'oldest', 'recent'], '"Check now" includes recent and gone, never pasted or ruled out');
  assert.deepEqual(dueHomes({ ...state, profile: { refresh: { frequency: 'off' } } }, now), []);
  assert.deepEqual(dueHomes({ ...state, profile: { refresh: { frequency: 'daily' } } }, now).map((x) => x.id), ['oldest', 'due', 'recent']);
  assert.equal(canRefresh({ source: { type: 'link', url: '' } }, ''), false);
});

test('refresh results are saved, survive export and keep your own data', () => {
  store.clearAll();
  const id = store.addHome({ assessment: sampleAssessment(), meta: { model: 'm', assessedAt: '2026-11-17T10:00:00Z' }, listingText: 'Oak Lane £330,000', source: { type: 'link', url: 'https://www.example.com/1' } });
  store.setStatus(id, 'Shortlisted');
  store.addNote(id, 'Ask about the shed');
  store.setOverrides(id, { bedrooms: 4 });

  store.recordRefresh(id, { result: 'unchanged', checkedAt: '2026-11-18T09:00:00Z', fingerprint: { price: 330000, status: 'available' } });
  let home = store.getState().homes[id];
  assert.equal(home.refresh.result, 'unchanged');
  assert.deepEqual(home.meta.fingerprint, { price: 330000, status: 'available' });

  const next = sampleAssessment();
  next.listing.price = 315000;
  store.applyRefreshUpdate(id, { checkedAt: '2026-11-19T09:00:00Z', changes: ['The price dropped from £330,000 to £315,000.'], assessment: next, meta: { model: 'm2' }, listingText: 'Oak Lane £315,000' });
  home = store.getState().homes[id];
  assert.equal(home.assessment.listing.price, 315000);
  assert.deepEqual(home.refresh.lastChange, { at: '2026-11-19T09:00:00Z', kind: 'updated', changes: ['The price dropped from £330,000 to £315,000.'] });
  assert.equal(store.trackOf(id).status, 'Shortlisted', 'status kept');
  assert.equal(store.trackOf(id).notes.length, 1, 'notes kept');
  assert.deepEqual(home.overrides, { bedrooms: 4 }, 'your corrections kept');

  store.recordRefresh(id, { result: 'failed', checkedAt: '2026-11-20T09:00:00Z', message: 'The website refused the request.' });
  assert.equal(store.getState().homes[id].refresh.lastChange.kind, 'updated', 'a failed check keeps the last change');

  const json = store.exportJson();
  store.clearAll();
  assert.equal(store.importJson(json).ok, true);
  const back = store.getState().homes[id].refresh;
  assert.equal(back.result, 'failed');
  assert.equal(back.lastChange.changes[0], 'The price dropped from £330,000 to £315,000.');

  const tampered = JSON.parse(json);
  tampered.homes[0].refresh = { checkedAt: 5, result: 'hacked' };
  store.importJson(JSON.stringify(tampered));
  assert.equal(store.getState().homes[id].refresh, undefined, 'invalid refresh data is dropped');
});
