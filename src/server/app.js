// @ts-check
/**
 * The HTTP application: two API routes plus the static web app.
 *
 *   GET  /api/health   what this server can do (provider, model, research, auth)
 *   POST /api/assess   assess one listing against the criteria sent with it
 *   POST /api/refresh  re-read a listing link; assess it again only if it changed
 *
 * The server is stateless: it keeps no listings, profiles or results. Each request
 * carries what it needs and the browser stores the answer.
 */
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { AppError, isAppError } from './errors.js';
import { setSecurityHeaders, sendJson, readJsonBody, clientKey } from './http.js';
import { createRateLimiter, createDailyCap, createConcurrencyGate } from './rate-limit.js';
import { createStaticHandler } from './static.js';
import { createAssessor, createRefresher } from './ai/assess.js';
import { loadPrompts } from './ai/prompts.js';
import { validate } from '../shared/validate.js';
import { CRITERIA_SCHEMA } from '../shared/schema.js';
import { LISTING_STATUSES } from '../shared/fingerprint.js';

const MAX_BODY_BYTES = 512 * 1024;

/** @type {import('../shared/validate.js').Schema} */
const OPTIONS = {
  type: 'object',
  properties: { research: { type: 'boolean' } },
  required: ['research'],
  additionalProperties: false,
};

/** @type {import('../shared/validate.js').Schema} */
const ASSESS_REQUEST = {
  type: 'object',
  properties: {
    listing: {
      type: 'object',
      properties: { url: { type: 'string', maxLength: 2048 }, text: { type: 'string', maxLength: 60000 } },
      required: ['url', 'text'],
      additionalProperties: false,
    },
    criteria: CRITERIA_SCHEMA,
    options: OPTIONS,
  },
  required: ['listing', 'criteria', 'options'],
  additionalProperties: false,
};

/** @type {import('../shared/validate.js').Schema} */
const REFRESH_REQUEST = {
  type: 'object',
  properties: {
    listing: {
      type: 'object',
      properties: { url: { type: 'string', maxLength: 2048 } },
      required: ['url'],
      additionalProperties: false,
    },
    previous: {
      type: 'object',
      properties: {
        price: { anyOf: [{ type: 'number', minimum: 0, maximum: 1e9 }, { type: 'null' }] },
        status: { type: 'string', enum: LISTING_STATUSES },
      },
      required: ['price', 'status'],
      additionalProperties: false,
    },
    criteria: CRITERIA_SCHEMA,
    options: OPTIONS,
  },
  required: ['listing', 'previous', 'criteria', 'options'],
  additionalProperties: false,
};

const DAILY_LIMIT_MESSAGE = 'This server has reached its daily limit of assessments. Try again tomorrow.';

/**
 * What gets logged about an assessment: usage and timing, never content.
 * @param {any} meta
 */
const usageLog = (meta) => ({
  provider: meta.provider,
  model: meta.model,
  ms: meta.durationMs,
  inputTokens: meta.usage.inputTokens,
  outputTokens: meta.usage.outputTokens,
  webSearches: meta.usage.webSearches,
  costUsd: meta.estimatedCostUsd,
  research: meta.research.used,
  warnings: meta.warnings.length,
  contactDetailsRemoved: meta.privacy.contactDetailsRemoved,
});

/** @param {string} a @param {string} b */
function safeEqual(a, b) {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * @param {{
 *   config: import('./config.js').Config,
 *   provider: import('./ai/providers/types.js').Provider,
 *   fetchListing: (url: string) => Promise<{ finalUrl: string, title: string, text: string }>,
 *   log: import('./logger.js').Logger,
 *   now?: () => Date,
 * }} deps
 */
export function createApp(deps) {
  const { config, provider, log } = deps;
  const prompts = loadPrompts(config.paths.prompts);
  const assess = createAssessor({ provider, config, prompts, fetchListing: deps.fetchListing, log, now: deps.now });
  const refresh = createRefresher({ provider, config, prompts, fetchListing: deps.fetchListing, log, now: deps.now });
  const limiter = createRateLimiter(config.rateLimit);
  const daily = createDailyCap(config.dailyLimit);
  const gate = createConcurrencyGate(config.maxConcurrent);
  const serveStatic = createStaticHandler({ web: config.paths.web, shared: config.paths.shared });

  /**
   * @param {import('node:http').IncomingMessage} req
   */
  function checkAuth(req) {
    if (!config.accessToken) return;
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !safeEqual(token, config.accessToken)) {
      throw new AppError(401, 'UNAUTHORISED', 'This server needs an access token. Enter it on the Profile page, under “AI and this server”.');
    }
  }

  /**
   * Block cross-site requests: the API is only for this app's own pages.
   * @param {import('node:http').IncomingMessage} req
   */
  function checkSameOrigin(req) {
    const site = String(req.headers['sec-fetch-site'] || '');
    if (site && site !== 'same-origin' && site !== 'none') throw new AppError(403, 'CROSS_SITE', 'Cross-site requests are not allowed.');
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try {
        host = new URL(origin).host;
      } catch {
        // malformed Origin: treated as cross-site below
      }
      const allowed = [req.headers.host];
      if (config.trustProxy) allowed.push(String(req.headers['x-forwarded-host'] || '').split(',')[0].trim());
      if (!host || !allowed.includes(host)) throw new AppError(403, 'CROSS_SITE', 'Cross-site requests are not allowed.');
    }
  }

  /**
   * What every POST route checks first: same origin, the access token, the rate
   * limit, then a JSON body that must match the schema.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {import('../shared/validate.js').Schema} schema
   */
  async function readGuardedBody(req, res, schema) {
    checkSameOrigin(req);
    checkAuth(req);
    const limit = limiter.take(clientKey(req, config.trustProxy));
    if (!limit.ok) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      throw new AppError(429, 'RATE_LIMITED', `Too many requests in a short time. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minute(s).`);
    }
    const body = await readJsonBody(req, MAX_BODY_BYTES);
    const checked = validate(schema, body);
    if (!checked.ok) throw new AppError(400, 'BAD_REQUEST', `The request was not valid: ${checked.errors.slice(0, 3).join('; ')}`);
    return checked.value;
  }

  /**
   * Run work inside the concurrency limit, cancelling it if the browser goes away.
   * @template T
   * @param {import('node:http').ServerResponse} res
   * @param {(signal: AbortSignal) => Promise<T>} work
   * @returns {Promise<T>}
   */
  async function gated(res, work) {
    if (!gate.tryEnter()) throw new AppError(503, 'BUSY', 'The server is busy with other assessments. Try again in a minute.', { retryable: true });
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', onClose);
    try {
      return await work(controller.signal);
    } finally {
      res.off('close', onClose);
      gate.leave();
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   * @param {string} requestId
   */
  async function handleApi(req, res, url, requestId) {
    if (url.pathname === '/api/health') {
      if (req.method !== 'GET') throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      sendJson(res, 200, {
        ok: true,
        version: config.version,
        provider: provider.name,
        model: provider.model,
        demo: provider.name === 'demo',
        webResearch: config.webResearch && provider.capabilities.webSearch,
        listingFetch: config.allowListingFetch,
        authRequired: Boolean(config.accessToken),
        promptVersion: prompts.assess.version,
      });
      return;
    }

    if (url.pathname === '/api/assess') {
      if (req.method !== 'POST') throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      const input = await readGuardedBody(req, res, ASSESS_REQUEST);
      if (!daily.take()) throw new AppError(429, 'DAILY_LIMIT', DAILY_LIMIT_MESSAGE);
      const out = await gated(res, (signal) => assess(input, { requestId, signal }));
      log.info('assessment complete', { requestId, ...usageLog(out.meta) });
      sendJson(res, 200, out);
      return;
    }

    if (url.pathname === '/api/refresh') {
      if (req.method !== 'POST') throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      const input = await readGuardedBody(req, res, REFRESH_REQUEST);
      if (!config.allowListingFetch) throw new AppError(400, 'FETCH_DISABLED', 'This server doesn’t read links, so homes can’t be re-checked.');
      const beforeAi = () => {
        if (!daily.take()) throw new AppError(429, 'DAILY_LIMIT', DAILY_LIMIT_MESSAGE);
      };
      const out = await gated(res, (signal) => refresh(/** @type {any} */ (input), { requestId, signal, beforeAi }));
      log.info('refresh complete', { requestId, changed: out.changed, gone: out.gone, ...('meta' in out && out.meta ? usageLog(out.meta) : {}) });
      sendJson(res, 200, out);
      return;
    }

    throw new AppError(404, 'NOT_FOUND', 'Not found.');
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  return async function handler(req, res) {
    const requestId = randomUUID();
    const started = Date.now();
    setSecurityHeaders(res);
    res.setHeader('X-Request-Id', requestId);
    let path = '/';
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      path = url.pathname;
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url, requestId);
      else await serveStatic(req, res, url);
    } catch (err) {
      if (isAppError(err)) {
        const e = /** @type {AppError} */ (err);
        if (e.status >= 500) log.warn('request failed', { requestId, code: e.code, status: e.status });
        sendJson(res, e.status, { error: { code: e.code, message: e.message, retryable: e.retryable, requestId } });
      } else {
        log.error('unexpected error', { requestId, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), stack: err instanceof Error ? err.stack : undefined });
        sendJson(res, 500, { error: { code: 'INTERNAL', message: 'Something went wrong on the server. Try again; if it keeps happening, check the server log.', retryable: true, requestId } });
      }
    } finally {
      log.debug('request', { requestId, method: req.method, path, status: res.statusCode, ms: Date.now() - started });
    }
  };
}
