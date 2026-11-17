// @ts-check
/**
 * The assessment pipeline:
 *   1. get the listing text (pasted, or fetched safely from a link);
 *   2. optionally research the area with web search (Anthropic only);
 *   3. ask for a structured assessment that must match the schema;
 *   4. validate it, and if it doesn't fit, show the model the problems and retry;
 *   5. drop any source links the model could not have read;
 *   6. return the assessment with full provenance (model, prompt version, usage).
 * The buyer's hard rules and all money maths run afterwards, in the browser.
 */
import { randomBytes } from 'node:crypto';
import { AppError } from '../errors.js';
import { toWireSchema } from '../../shared/validate.js';
import { ASSESSMENT_SCHEMA, SCHEMA_VERSION, validateAssessment } from '../../shared/schema.js';
import { buildAssessmentMessage, buildResearchMessage } from './prompts.js';
import { verifySources } from './sources.js';

const WIRE_SCHEMA = toWireSchema(ASSESSMENT_SCHEMA);
export const MAX_LISTING_CHARS = 40000;
const MIN_LISTING_CHARS = 80;
const MAX_ATTEMPTS = 3;

/**
 * Pull a JSON object out of model text, tolerating code fences.
 * @param {string} text
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function parseJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, error: '$: the answer did not contain a JSON object' };
  try {
    return { ok: true, value: JSON.parse(trimmed.slice(start, end + 1)) };
  } catch {
    return { ok: false, error: '$: the answer was not valid JSON' };
  }
}

/**
 * @param {{ inputTokens: number, outputTokens: number }} usage
 * @param {{ inputPerMTok: number, outputPerMTok: number }} pricing
 */
export function estimateCost(usage, pricing) {
  if (!pricing.inputPerMTok && !pricing.outputPerMTok) return null;
  const usd = (usage.inputTokens / 1e6) * pricing.inputPerMTok + (usage.outputTokens / 1e6) * pricing.outputPerMTok;
  return Math.round(usd * 10000) / 10000;
}

/**
 * @typedef {object} AssessInput
 * @property {{ url: string, text: string }} listing
 * @property {any} criteria   already validated against CRITERIA_SCHEMA
 * @property {{ research: boolean }} options
 */

/**
 * @param {{
 *   provider: import('./providers/types.js').Provider,
 *   config: import('../config.js').Config,
 *   prompts: { assess: import('./prompts.js').Prompt, research: import('./prompts.js').Prompt },
 *   fetchListing: (url: string) => Promise<{ finalUrl: string, title: string, text: string }>,
 *   log: import('../logger.js').Logger,
 *   now?: () => Date,
 * }} deps
 */
export function createAssessor(deps) {
  const { provider, config, prompts, fetchListing, log } = deps;
  const now = deps.now || (() => new Date());

  /**
   * @param {AssessInput} input
   * @param {{ requestId?: string, signal?: AbortSignal }} [ctx]
   */
  return async function assess(input, ctx = {}) {
    const started = Date.now();
    /** @type {string[]} */
    const warnings = [];
    const pasted = input.listing.text.trim();
    let text = pasted;
    let sourceUrl = input.listing.url.trim();
    let title = '';

    if (!text) {
      if (!sourceUrl) throw new AppError(400, 'NO_LISTING', 'Paste the listing text or add a link to it.');
      if (!config.allowListingFetch) throw new AppError(400, 'FETCH_DISABLED', 'This server doesn’t read links. Paste the listing text instead.');
      const page = await fetchListing(sourceUrl);
      text = page.text;
      sourceUrl = page.finalUrl;
      title = page.title;
    } else if (sourceUrl) {
      try {
        const u = new URL(sourceUrl);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad protocol');
      } catch {
        sourceUrl = '';
        warnings.push('The link wasn’t a valid web address, so it was left out.');
      }
    }
    if (text.length < MIN_LISTING_CHARS) {
      throw new AppError(422, 'LISTING_TOO_SHORT', 'There’s too little listing text to assess. Paste the full description, including the price and rooms.');
    }
    if (text.length > MAX_LISTING_CHARS) {
      text = text.slice(0, MAX_LISTING_CHARS);
      warnings.push('The listing was long, so only the first part was assessed.');
    }

    const today = now();
    const todayText = today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const nonce = randomBytes(6).toString('hex');
    const usage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
    /** @param {{ inputTokens: number, outputTokens: number, webSearches?: number }} u */
    const addUsage = (u) => {
      usage.inputTokens += u.inputTokens || 0;
      usage.outputTokens += u.outputTokens || 0;
      usage.webSearches += u.webSearches || 0;
    };

    /** @type {{ notes: string, sources: { url: string, title: string }[] } | null} */
    let research = null;
    if (input.options.research) {
      if (!config.webResearch || !provider.capabilities.webSearch) {
        warnings.push('Web research is switched off on this server, so the assessment uses the listing only.');
      } else {
        try {
          const r = await provider.generate({
            system: prompts.research.text,
            messages: [{ role: 'user', content: buildResearchMessage({ listingText: text, listingUrl: sourceUrl, destination: input.criteria.destination, today: todayText, nonce }) }],
            maxTokens: Math.min(config.maxTokens, 8000),
            webSearch: { maxUses: config.anthropic.webSearchMaxUses },
            signal: ctx.signal,
          });
          addUsage(r.usage);
          if (r.stopReason === 'refusal' || !r.text.trim()) warnings.push('The research step returned nothing, so the assessment uses the listing only.');
          else research = { notes: r.text.trim().slice(0, 8000), sources: r.sources.slice(0, 30) };
        } catch (err) {
          if (ctx.signal?.aborted) throw err;
          log.warn('research failed', { requestId: ctx.requestId, code: /** @type {any} */ (err)?.code });
          warnings.push('Web research failed, so the assessment uses the listing only.');
        }
      }
    }

    /** @type {{ role: 'user' | 'assistant', content: string }[]} */
    const messages = [{
      role: 'user',
      content: buildAssessmentMessage({ listingText: text, listingUrl: sourceUrl, criteria: input.criteria, research, today: todayText, nonce }),
    }];
    let maxTokens = config.maxTokens;
    /** @type {import('./providers/types.js').GenerateResult | null} */
    let result = null;
    /** @type {import('../../shared/validate.js').ValidationResult | null} */
    let validation = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const r = await provider.generate({ system: prompts.assess.text, messages, schema: WIRE_SCHEMA, schemaName: 'home_assessment', maxTokens, signal: ctx.signal });
      addUsage(r.usage);
      result = r;
      if (r.stopReason === 'refusal') {
        throw new AppError(422, 'AI_REFUSED', 'The AI declined to assess this text. Check it is a property listing and try again.');
      }
      if (r.stopReason === 'max_tokens') {
        log.warn('assessment cut off, retrying with a larger budget', { requestId: ctx.requestId, attempt, maxTokens });
        maxTokens = Math.min(maxTokens * 2, 64000);
        continue;
      }
      const parsed = parseJson(r.text);
      validation = parsed.ok ? validateAssessment(parsed.value) : { ok: false, value: null, errors: [parsed.error], warnings: [] };
      if (validation.ok) break;
      const problems = validation.errors.slice(0, 10).join('\n');
      log.warn('assessment failed validation', { requestId: ctx.requestId, attempt, errors: validation.errors.slice(0, 10) });
      messages.push(
        { role: 'assistant', content: r.text.slice(0, 30000) || '(empty answer)' },
        { role: 'user', content: `That answer doesn't match the required schema:\n${problems}\nReturn the complete, corrected JSON object only.` },
      );
    }
    if (!validation || !validation.ok || !result) {
      throw new AppError(502, 'AI_INVALID_OUTPUT', 'The AI’s answer wasn’t in the expected format, even after retrying. Try again, or use a more capable model.');
    }

    const assessment = validation.value;
    const allowed = [sourceUrl, ...(research ? research.sources.map((s) => s.url) : [])].filter(Boolean);
    const { kept, removed } = verifySources(assessment.sources, allowed, sourceUrl ? { url: sourceUrl, title: title || 'The listing' } : null);
    assessment.sources = kept;
    if (removed) warnings.push(`${removed} source link${removed === 1 ? ' was' : 's were'} removed because the AI hadn’t been given ${removed === 1 ? 'it' : 'them'}.`);

    return {
      assessment,
      listingText: text.slice(0, 30000),
      meta: {
        provider: provider.name,
        model: result.model,
        promptVersion: prompts.assess.version,
        researchPromptVersion: research ? prompts.research.version : null,
        schemaVersion: SCHEMA_VERSION,
        assessedAt: today.toISOString(),
        durationMs: Date.now() - started,
        source: { type: pasted ? 'pasted' : 'link', url: sourceUrl, title },
        research: { used: Boolean(research), sources: research ? research.sources : [] },
        usage,
        estimatedCostUsd: estimateCost(usage, config.pricing),
        repairs: validation.warnings.length,
        warnings,
      },
    };
  };
}
