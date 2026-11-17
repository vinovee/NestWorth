import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSESSMENT_SCHEMA, CRITERIA_SCHEMA, validateAssessment } from '../src/shared/schema.js';
import { toWireSchema, countUnions, countOptional, validate } from '../src/shared/validate.js';
import { criteriaForAI, EXAMPLE_PROFILE } from '../src/shared/profile.js';
import { sampleAssessment } from './fixtures/assessment.js';

test('assessment schema stays inside structured-output limits', () => {
  assert.ok(countUnions(ASSESSMENT_SCHEMA) <= 16, 'at most 16 union-typed parameters');
  assert.equal(countOptional(ASSESSMENT_SCHEMA), 0, 'every property is required');
  const wire = JSON.stringify(toWireSchema(ASSESSMENT_SCHEMA));
  assert.equal(/"(minimum|maximum|maxLength|maxItems)"/.test(wire), false);
});

test('every object in the wire schema forbids extra keys', () => {
  const visit = (s) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(visit);
    }
    if (s.items) visit(s.items);
    if (s.anyOf) s.anyOf.forEach(visit);
  };
  visit(toWireSchema(ASSESSMENT_SCHEMA));
});

test('a sample assessment validates', () => {
  const r = validateAssessment(sampleAssessment());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('reversed ranges are repaired', () => {
  const a = sampleAssessment();
  a.listing.price = 400000;
  a.listing.priceMax = 350000;
  a.commute.minutesMin = 60;
  a.commute.minutesMax = null;
  const r = validateAssessment(a);
  assert.equal(r.ok, true);
  assert.equal(r.value.listing.price, 350000);
  assert.equal(r.value.listing.priceMax, 400000);
  assert.equal(r.value.commute.minutesMax, 60);
});

test('missing sections are reported', () => {
  const a = sampleAssessment();
  delete a.flags;
  a.verdict = 'buy it now';
  const r = validateAssessment(a);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith('$.flags')));
  assert.ok(r.errors.some((e) => e.startsWith('$.verdict')));
});

test('criteria sent to the AI validate and leave out personal finances', () => {
  const c = criteriaForAI(EXAMPLE_PROFILE);
  const r = validate(CRITERIA_SCHEMA, c);
  assert.deepEqual(r.errors, []);
  const json = JSON.stringify(c);
  for (const secret of ['mortgageBalance', 'savings', 'expectedPrice', '150000', '240000']) assert.equal(json.includes(secret), false, secret);
  assert.ok(c.budget.affordableAtCeiling > 0);
});
