// @ts-check
/**
 * Facts in NestWorth that go out of date, and when each was last checked.
 * The weekly Maintenance workflow (scripts/maintenance.js) opens an issue when one
 * is due. When you re-check something, update its date here in the same pull
 * request as the change.
 */
import { RULES_LAST_CHECKED } from './tax-rules.js';

/**
 * @typedef {object} ReviewItem
 * @property {string} id
 * @property {string} what
 * @property {string[]} where        files to update
 * @property {string} lastChecked   ISO date
 * @property {number} [maxAgeDays]  due this many days after lastChecked
 * @property {string} [dueBy]       or due on this ISO date
 * @property {string} how
 */

/** @type {ReviewItem[]} */
export const REVIEW_ITEMS = [
  {
    id: 'purchase-tax',
    what: 'Purchase tax rates, bands and surcharges (SDLT, LBTT and LTT)',
    where: ['src/shared/tax-rules.js', 'docs/finance-and-tax.md'],
    lastChecked: RULES_LAST_CHECKED,
    maxAgeDays: 90,
    how: 'Check GOV.UK, Revenue Scotland and the Welsh Revenue Authority, especially after a Budget. Add a worked example from the official source as a test.',
  },
  {
    id: 'ai-defaults',
    what: 'Default AI model, API version and token prices',
    where: ['src/server/config.js', '.env.example', 'docs/configuration.md', 'README.md (Costs)'],
    lastChecked: '2026-11-17',
    maxAgeDays: 90,
    how: 'Check the provider’s models, deprecation notices and pricing. Run `npm run eval` against a new default model before switching.',
  },
  {
    id: 'ai-compliance',
    what: 'AI regulation and standards mapping (EU AI Act, UK data protection, NIST AI RMF, OWASP Top 10 for LLM Applications)',
    where: ['docs/compliance.md', 'docs/responsible-ai.md'],
    lastChecked: '2026-11-17',
    maxAgeDays: 180,
    how: 'Look for new obligations, guidance or editions, then update the mapping and its dates.',
  },
  {
    id: 'node-support',
    what: 'Minimum Node.js version (Node.js 22 reaches end of life on 30 April 2027)',
    where: ['package.json (engines)', '.github/workflows/ci.yml', 'README.md'],
    lastChecked: '2026-11-17',
    dueBy: '2027-03-31',
    how: 'Raise `engines.node`, drop the old version from the CI matrix and update the README.',
  },
];

const DAY = 86400000;

/**
 * When an item next needs reviewing, as an ISO date.
 * @param {ReviewItem} item
 */
export function nextReview(item) {
  const due = item.dueBy ? Date.parse(item.dueBy) : Date.parse(item.lastChecked) + (item.maxAgeDays ?? 365) * DAY;
  return Number.isFinite(due) ? new Date(due).toISOString().slice(0, 10) : '';
}

/**
 * Items due for review on a given day.
 * @param {Date} [today]
 * @param {ReviewItem[]} [items]
 * @returns {{ item: ReviewItem, dueOn: string, daysOverdue: number }[]}
 */
export function overdueItems(today = new Date(), items = REVIEW_ITEMS) {
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  /** @type {{ item: ReviewItem, dueOn: string, daysOverdue: number }[]} */
  const out = [];
  for (const item of items) {
    const dueOn = nextReview(item);
    const due = Date.parse(dueOn);
    if (dueOn && t >= due) out.push({ item, dueOn, daysOverdue: Math.floor((t - due) / DAY) });
  }
  return out;
}
