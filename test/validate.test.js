import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, toWireSchema } from '../src/shared/validate.js';

const schema = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 5 },
    kind: { type: 'string', enum: ['Detached House', 'flat'] },
    score: { type: 'number', minimum: 0, maximum: 10 },
    beds: { anyOf: [{ type: 'integer', minimum: 0, maximum: 30 }, { type: 'null' }] },
    tags: { type: 'array', maxItems: 2, items: { type: 'string' } },
    ok: { type: 'boolean' },
  },
  required: ['name', 'kind', 'score', 'beds', 'tags', 'ok'],
  additionalProperties: false,
};

test('valid input passes and is cleaned', () => {
  const r = validate(schema, { name: '  Oak ', kind: 'detached house', score: 7.5, beds: null, tags: ['a'], ok: true });
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'Oak');
  assert.equal(r.value.kind, 'Detached House', 'enum matching ignores case and returns the canonical value');
  assert.equal(r.value.beds, null);
});

test('small problems are repaired with warnings', () => {
  const r = validate(schema, { name: 'Oakfield', kind: 'flat', score: 12, beds: 2.6, tags: ['a', 'b', 'c'], ok: false, extra: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'Oakf…');
  assert.equal(r.value.score, 10);
  assert.equal(r.value.beds, 3);
  assert.deepEqual(r.value.tags, ['a', 'b']);
  assert.equal('extra' in r.value, false);
  assert.equal(r.warnings.length, 5);
});

test('structural problems are errors', () => {
  const r = validate(schema, { name: 3, kind: 'castle', score: 'high', beds: 'two', tags: 'a' });
  assert.equal(r.ok, false);
  const text = r.errors.join('\n');
  for (const bit of ['$.name', '$.kind', '$.score', '$.beds', '$.tags', '$.ok: is required']) assert.match(text, new RegExp(bit.replace(/[$.]/g, '\\$&')));
  assert.equal(validate(schema, null).ok, false);
  assert.equal(validate(schema, []).ok, false);
});

test('NaN and Infinity are rejected', () => {
  assert.equal(validate({ type: 'number' }, Number.NaN).ok, false);
  assert.equal(validate({ type: 'number' }, Infinity).ok, false);
});

test('wire schema keeps structure and moves limits into descriptions', () => {
  const wire = toWireSchema(schema);
  const json = JSON.stringify(wire);
  for (const key of ['minimum', 'maximum', 'maxLength', 'maxItems']) assert.equal(json.includes(`"${key}"`), false, key);
  assert.equal(wire.additionalProperties, false);
  assert.match(wire.properties.score.description, /between 0 and 10/);
  assert.match(wire.properties.tags.description, /at most 2 items/);
});
