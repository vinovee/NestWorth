// @ts-check
/**
 * The weekly maintenance report, run by .github/workflows/maintenance.yml.
 * Lists facts that are due for review and writes `overdue=true|false` to
 * $GITHUB_OUTPUT, so the workflow can open or update an issue.
 *
 *   npm run maintenance
 *   node scripts/maintenance.js --out report.md --today 2027-01-01
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { REVIEW_ITEMS, overdueItems, nextReview } from '../src/shared/review-dates.js';

const args = process.argv.slice(2);
const arg = (/** @type {string} */ name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const todayArg = arg('--today');
const today = todayArg ? new Date(`${todayArg}T00:00:00Z`) : new Date();
if (Number.isNaN(today.getTime())) {
  process.stderr.write('--today must be a date such as 2027-01-01\n');
  process.exit(2);
}

const overdue = overdueItems(today);
const lines = [`## Scheduled maintenance, ${today.toISOString().slice(0, 10)}`, ''];
if (overdue.length) {
  lines.push(`${overdue.length} item${overdue.length === 1 ? ' is' : 's are'} due for review:`, '');
  for (const { item, dueOn, daysOverdue } of overdue) {
    lines.push(
      `- [ ] **${item.what}**: last checked ${item.lastChecked}, due ${dueOn}${daysOverdue ? ` (${daysOverdue} days ago)` : ''}.`,
      `  ${item.how}`,
      `  Update ${item.where.map((w) => `\`${w}\``).join(', ')}, then the date in \`src/shared/review-dates.js\`.`,
    );
  }
} else {
  lines.push('Nothing is due for review.');
}
lines.push('', '| What | Last checked | Next review |', '| --- | --- | --- |');
for (const item of REVIEW_ITEMS) lines.push(`| ${item.what} | ${item.lastChecked} | ${nextReview(item)} |`);

const report = `${lines.join('\n')}\n`;
process.stdout.write(report);
const out = arg('--out');
if (out) writeFileSync(out, report);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `overdue=${overdue.length ? 'true' : 'false'}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
