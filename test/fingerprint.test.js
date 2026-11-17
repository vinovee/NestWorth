import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listingFingerprint, describeChanges, isFingerprint } from '../src/shared/fingerprint.js';

const LISTING = readFileSync(new URL('../examples/listings/oak-lane-new-semi.txt', import.meta.url), 'utf8');

test('a fingerprint takes the first price and the availability', () => {
  assert.deepEqual(listingFingerprint(LISTING), { price: 330000, status: 'available' });
  assert.deepEqual(listingFingerprint('Guide price £1,250,000. UNDER OFFER.'), { price: 1250000, status: 'under_offer' });
  assert.deepEqual(listingFingerprint('Sold STC. Was £299,950'), { price: 299950, status: 'sold' });
  assert.equal(listingFingerprint('Asking £450000, sale agreed').status, 'sold');
  assert.equal(listingFingerprint('Price on application').price, null);
  assert.equal(listingFingerprint('£325,000 · © 2026 Example Homes. All rights reserved.').status, 'available', 'footer is not a reservation');
  assert.equal(listingFingerprint('Reserved: £325,000').status, 'under_offer');
  assert.equal(listingFingerprint('Save £5,000 on fees, now £319,995').price, 319995, 'small amounts are skipped');
});

test('changes are described in plain English', () => {
  const was = { price: 350000, status: 'available' };
  assert.deepEqual(describeChanges(was, { price: 350000, status: 'available' }), []);
  assert.deepEqual(describeChanges(was, { price: 335000, status: 'available' }), ['The price dropped from £350,000 to £335,000.']);
  assert.deepEqual(describeChanges(was, { price: 360000, status: 'under_offer' }), [
    'The price went up from £350,000 to £360,000.',
    'It’s now marked as under offer or reserved.',
  ]);
  assert.deepEqual(describeChanges({ price: null, status: 'sold' }, { price: 300000, status: 'available' }), [
    'The listing now shows a price of £300,000.',
    'It’s no longer marked as under offer or sold.',
  ]);
  assert.ok(isFingerprint(was));
  assert.equal(isFingerprint({ price: '1', status: 'available' }), false);
  assert.equal(isFingerprint({ price: null, status: 'gone' }), false);
});
