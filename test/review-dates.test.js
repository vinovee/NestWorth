import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_ITEMS, overdueItems, nextReview } from '../src/shared/review-dates.js';

const item = (over) => ({ id: 'x', what: 'Something', where: ['a.js'], how: 'Check it.', lastChecked: '2026-01-01', ...over });

test('review items are due after their maximum age or on their due date', () => {
  const aged = item({ maxAgeDays: 30 });
  assert.equal(nextReview(aged), '2026-01-31');
  assert.deepEqual(overdueItems(new Date('2026-01-30T12:00:00Z'), [aged]), []);
  const due = overdueItems(new Date('2026-02-02T08:00:00Z'), [aged]);
  assert.equal(due.length, 1);
  assert.equal(due[0].daysOverdue, 2);

  const fixed = item({ dueBy: '2027-03-31' });
  assert.equal(nextReview(fixed), '2027-03-31');
  assert.equal(overdueItems(new Date('2027-03-31T00:00:00Z'), [fixed]).length, 1, 'due on the day itself');
});

test('every built-in review item is well formed and not already overdue at release', () => {
  for (const r of REVIEW_ITEMS) {
    assert.ok(r.id && r.what && r.how && r.where.length, r.id);
    assert.ok(nextReview(r), `${r.id} has a next review date`);
  }
  assert.deepEqual(overdueItems(new Date('2026-11-17T00:00:00Z')).map((o) => o.item.id), []);
});
