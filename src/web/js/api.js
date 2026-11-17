// @ts-check
/** Talking to this app's own server. The optional access token lives only for this browser tab. */

const TOKEN_KEY = 'nestworth/token';

export class ApiError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] */
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

/** @param {string} token */
export function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: the token simply won't persist
  }
}

/**
 * @typedef {object} Health
 * @property {boolean} ok
 * @property {string} version
 * @property {string} provider
 * @property {string} model
 * @property {boolean} demo
 * @property {boolean} webResearch
 * @property {boolean} listingFetch
 * @property {boolean} authRequired
 * @property {string} promptVersion
 */

/** @returns {Promise<Health>} */
export async function health() {
  let res;
  try {
    res = await fetch('/api/health', { headers: { accept: 'application/json' } });
  } catch {
    throw new ApiError('NETWORK', 'Couldn’t reach the app server. Is it running?');
  }
  if (!res.ok) throw new ApiError(`HTTP_${res.status}`, `The server answered with an error (${res.status}).`, res.status);
  return res.json();
}

/**
 * @param {{ listing: { url: string, text: string }, criteria: unknown, options: { research: boolean } }} payload
 * @param {AbortSignal} [signal]
 */
export function assess(payload, signal) {
  return post('/api/assess', payload, signal);
}

/**
 * Re-read a listing link. The server only assesses it again if the price or
 * availability differs from `previous`.
 * @param {{ listing: { url: string }, previous: { price: number | null, status: string }, criteria: unknown, options: { research: boolean } }} payload
 * @param {AbortSignal} [signal]
 */
export function refresh(payload, signal) {
  return post('/api/refresh', payload, signal);
}

/**
 * @param {string} path
 * @param {unknown} payload
 * @param {AbortSignal} [signal]
 */
async function post(path, payload, signal) {
  /** @type {Record<string, string>} */
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), signal });
  } catch {
    if (signal?.aborted) throw new ApiError('CANCELLED', 'Cancelled.');
    throw new ApiError('NETWORK', 'Couldn’t reach the app server. Is it still running?');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error?.code || `HTTP_${res.status}`, body?.error?.message || `The server answered with an error (${res.status}).`, res.status);
  }
  return body;
}
