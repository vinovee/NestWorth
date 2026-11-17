import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactContactDetails } from '../src/shared/redact.js';

test('phone numbers and email addresses are removed', () => {
  const r = redactContactDetails('Call 0161 496 0731, +44 (0)20 7946 0018 or (0161) 496-0000, or email viewings@sampleford-homes.example today.');
  assert.equal(r.text, 'Call [phone number removed], [phone number removed] or [phone number removed], or email [email address removed] today.');
  assert.equal(r.phones, 3);
  assert.equal(r.emails, 1);
  assert.equal(redactContactDetails('Mobile: 07700 900123').text, 'Mobile: [phone number removed]');
});

test('prices, sizes, dates, references and the next line are left alone', () => {
  const keep = [
    'Offers over £318,000, or £1,050,000 for the plot.',
    'Living room 4.90m x 3.60m (16\'1" x 11\'10"). About 915 sq ft, 0.25 acres.',
    'Completed 2021-06-30; EPC certificate 0123-4567-8901-2345-6789.',
    'Open 09:00 to 17:30. Postcode SF4 2QT. 0.5 miles to the station.',
  ];
  for (const text of keep) {
    const r = redactContactDetails(text);
    assert.equal(r.text, text, text);
    assert.equal(r.phones + r.emails, 0);
  }
  const twoLines = redactContactDetails('Tel 0161 496 0731\n3 bedrooms');
  assert.equal(twoLines.text, 'Tel [phone number removed]\n3 bedrooms', 'never swallows the next line');
});
