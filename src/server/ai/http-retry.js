// @ts-check
/**
 * POST JSON to a model provider with timeouts and retries. Retries only what is
 * worth retrying (network errors, 429 rate limits, 5xx and overloaded responses),
 * with exponential backoff and jitter, and honours Retry-After.
 */
import { AppError } from '../errors.js';

/**
 * @typedef {object} PostOptions
 * @property {string} url
 * @property {Record<string, string>} headers
 * @property {unknown} body
 * @property {number} timeoutMs
 * @property {number} maxRetries
 * @property {string} providerLabel   e.g. "Anthropic"
 * @property {AbortSignal} [signal]
 * @property {typeof fetch} [fetchImpl]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {import('../logger.js').Logger} [log]
 */

const defaultSleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {number} attempt */
const backoff = (attempt) => Math.min(30000, 1000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);

/** @param {string | null} header */
function retryAfterMs(header) {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.min(60000, Math.max(0, secs * 1000));
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(60000, Math.max(0, at - Date.now())) : null;
}

/**
 * @param {PostOptions} o
 * @returns {Promise<any>}
 */
export async function postJson(o) {
  const fetchImpl = o.fetchImpl || fetch;
  const sleep = o.sleep || defaultSleep;
  for (let attempt = 0; ; attempt++) {
    const signals = [AbortSignal.timeout(o.timeoutMs)];
    if (o.signal) signals.push(o.signal);
    /** @type {Response} */
    let res;
    try {
      res = await fetchImpl(o.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...o.headers },
        body: JSON.stringify(o.body),
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      if (o.signal?.aborted) throw new AppError(499, 'CANCELLED', 'The request was cancelled.');
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      if (attempt < o.maxRetries && !timedOut) {
        o.log?.warn('provider network error, retrying', { provider: o.providerLabel, attempt });
        await sleep(backoff(attempt));
        continue;
      }
      throw new AppError(504, timedOut ? 'AI_TIMEOUT' : 'AI_UNREACHABLE',
        timedOut ? `${o.providerLabel} took too long to answer. Try again in a moment.` : `Couldn’t reach ${o.providerLabel}. Check the server’s internet connection.`,
        { retryable: true, cause: err });
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch (err) {
        throw new AppError(502, 'AI_BAD_RESPONSE', `${o.providerLabel} sent a response that wasn’t JSON.`, { cause: err });
      }
    }

    const text = await res.text().catch(() => '');
    const retryable = res.status === 408 || res.status === 409 || res.status === 429 || res.status >= 500;
    if (retryable && attempt < o.maxRetries) {
      const wait = retryAfterMs(res.headers.get('retry-after')) ?? backoff(attempt);
      o.log?.warn('provider error, retrying', { provider: o.providerLabel, status: res.status, attempt, waitMs: Math.round(wait) });
      await sleep(wait);
      continue;
    }
    o.log?.error('provider error', { provider: o.providerLabel, status: res.status, body: text.slice(0, 2000) });
    throw providerError(o.providerLabel, res.status, text);
  }
}

/**
 * @param {string} label
 * @param {number} status
 * @param {string} text
 */
function providerError(label, status, text) {
  let detail = '';
  try {
    const j = JSON.parse(text);
    detail = String(j?.error?.message || j?.message || '').slice(0, 300);
  } catch {
    // not JSON: keep the generic message
  }
  if (status === 401) return new AppError(502, 'AI_AUTH', `${label} rejected the API key. Check the key in your .env file.`);
  if (status === 403) return new AppError(502, 'AI_FORBIDDEN', `${label} refused the request for this API key.${detail ? ` (${detail})` : ''}`);
  if (status === 404) return new AppError(502, 'AI_MODEL_NOT_FOUND', `${label} couldn’t find the model. Check the model name in your .env file.${detail ? ` (${detail})` : ''}`);
  if (status === 413) return new AppError(413, 'AI_TOO_LARGE', 'The listing is too long for the AI. Paste a shorter description.');
  if (status === 429) return new AppError(503, 'AI_RATE_LIMITED', `${label} is rate-limiting this API key. Wait a minute and try again.`, { retryable: true });
  if (status >= 500) return new AppError(503, 'AI_UNAVAILABLE', `${label} is having problems. Try again in a few minutes.`, { retryable: true });
  return new AppError(502, 'AI_BAD_REQUEST', `${label} rejected the request${detail ? `: ${detail}` : '.'}`);
}
