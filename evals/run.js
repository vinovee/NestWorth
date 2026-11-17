// @ts-check
/**
 * Evaluation harness. Runs every case in evals/cases.json through the same
 * pipeline the server uses, then checks extraction, flags and the final verdict
 * (after the buyer's rules). Run it before changing a prompt, the schema or the
 * model, and compare the saved results.
 *
 *   npm run eval              uses the provider in your .env (costs a little)
 *   npm run eval:mock         uses demo mode; runs in CI
 *   node evals/run.js --case prompt-injection --repeat 3
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, loadConfig } from '../src/server/config.js';
import { createLogger } from '../src/server/logger.js';
import { createProvider } from '../src/server/ai/providers/index.js';
import { createAssessor } from '../src/server/ai/assess.js';
import { loadPrompts } from '../src/server/ai/prompts.js';
import { criteriaForAI, EXAMPLE_PROFILE } from '../src/shared/profile.js';
import { purchaseFinance } from '../src/shared/finance.js';
import { applyPolicy } from '../src/shared/policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (/** @type {string} */ name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

loadDotEnv();
const providerOverride = arg('--provider');
const env = { ...process.env, ...(providerOverride ? { LLM_PROVIDER: providerOverride } : {}), HOST: '127.0.0.1' };
const { config, errors } = loadConfig(env, []);
if (errors.length) {
  for (const e of errors) process.stderr.write(`Configuration problem: ${e}\n`);
  process.exit(1);
}
const log = createLogger('silent');
const provider = createProvider(config, { log });
const assess = createAssessor({
  provider,
  config,
  prompts: loadPrompts(config.paths.prompts),
  fetchListing: async () => {
    throw new Error('Evals use local listing files only.');
  },
  log,
});

/** @type {{ id: string, listing: string, why: string, expect: Record<string, any> }[]} */
let cases = JSON.parse(readFileSync(path.join(ROOT, 'evals', 'cases.json'), 'utf8'));
if (arg('--case')) cases = cases.filter((c) => c.id === arg('--case'));
const repeat = Math.max(1, Number(arg('--repeat') || 1));
const profile = EXAMPLE_PROFILE;
const criteria = criteriaForAI(profile);

/**
 * @param {any} a assessment
 * @param {Record<string, any>} x expectations
 */
function check(a, x) {
  /** @type {string[]} */
  const failures = [];
  const L = a.listing;
  const fin = L.price === null ? null : purchaseFinance(L.price, profile);
  const policy = applyPolicy(a.verdict, {
    price: L.price, propertyType: L.propertyType, bedrooms: L.bedrooms, buildAge: L.buildAge,
    minutesMin: a.commute.minutesMin, minutesMax: a.commute.minutesMax, flags: a.flags, areaFeel: a.areaFeel.kind,
  }, profile, fin);

  if ('price' in x && L.price !== x.price) failures.push(`price ${L.price} ≠ ${x.price}`);
  if ('priceMax' in x && L.priceMax !== x.priceMax) failures.push(`priceMax ${L.priceMax} ≠ ${x.priceMax}`);
  if (x.propertyType && !x.propertyType.includes(L.propertyType)) failures.push(`type ${L.propertyType} not in ${x.propertyType.join('/')}`);
  if ('bedrooms' in x && L.bedrooms !== x.bedrooms) failures.push(`bedrooms ${L.bedrooms} ≠ ${x.bedrooms}`);
  for (const f of x.flagsTrue || []) if (a.flags[f] !== true) failures.push(`flag ${f} should be true`);
  for (const f of x.flagsFalse || []) if (a.flags[f] !== false) failures.push(`flag ${f} should be false`);
  if (x.finalVerdictIn && !x.finalVerdictIn.includes(policy.verdict)) failures.push(`final verdict ${policy.verdict} not in ${x.finalVerdictIn.join('/')}`);
  if ('overallAtMost' in x && a.ratings.overall > x.overallAtMost) failures.push(`overall rating ${a.ratings.overall} > ${x.overallAtMost}`);
  if (x.policyNoteMatches && !policy.notes.some((n) => new RegExp(x.policyNoteMatches, 'i').test(n.text))) failures.push(`no rule note matching /${x.policyNoteMatches}/`);
  return { failures, verdict: policy.verdict, aiVerdict: a.verdict };
}

/** @type {any[]} */
const results = [];
let failed = 0;
process.stdout.write(`\nEvals: ${cases.length} case(s) × ${repeat}, provider ${provider.name}, model ${provider.model}\n\n`);
for (const c of cases) {
  const text = readFileSync(path.join(ROOT, c.listing), 'utf8');
  for (let run = 1; run <= repeat; run++) {
    const started = Date.now();
    try {
      const out = await assess({ listing: { url: '', text }, criteria, options: { research: false } });
      const r = check(out.assessment, c.expect);
      const pass = r.failures.length === 0;
      if (!pass) failed++;
      results.push({ id: c.id, run, pass, ...r, ms: Date.now() - started, usage: out.meta.usage, costUsd: out.meta.estimatedCostUsd });
      process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${c.id}${repeat > 1 ? ` #${run}` : ''}  (AI: ${r.aiVerdict} → final: ${r.verdict}, ${Date.now() - started} ms)\n`);
      for (const f of r.failures) process.stdout.write(`        - ${f}\n`);
    } catch (err) {
      failed++;
      const e = /** @type {any} */ (err);
      results.push({ id: c.id, run, pass: false, failures: [`error ${e.code || ''} ${e.message}`] });
      process.stdout.write(`ERROR ${c.id}: ${e.code || ''} ${e.message}\n`);
    }
  }
}

const total = results.length;
const tokens = results.reduce((n, r) => n + ((r.usage?.inputTokens || 0) + (r.usage?.outputTokens || 0)), 0);
process.stdout.write(`\n${total - failed}/${total} passed${tokens ? `, ${tokens.toLocaleString('en-GB')} tokens` : ''}\n`);

const outDir = path.join(ROOT, 'evals', 'results');
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${provider.name}.json`);
writeFileSync(file, JSON.stringify({ provider: provider.name, model: provider.model, at: new Date().toISOString(), results }, null, 2));
process.stdout.write(`Saved ${path.relative(ROOT, file)}\n\n`);
process.exit(failed ? 1 : 0);
