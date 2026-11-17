// @ts-check
/**
 * Fetches a listing page safely:
 * - public addresses only, checked when connecting (so DNS tricks can't redirect
 *   the request to a private address after the URL was checked);
 * - every redirect re-checked; at most a few hops;
 * - robots.txt respected;
 * - size and time limits; HTML and plain text only.
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import zlib from 'node:zlib';
import { AppError } from '../errors.js';
import { checkListingUrl, isBlockedAddress } from './ip.js';
import { parseRobots, isAllowed } from './robots.js';
import { htmlToText } from './html-to-text.js';

/**
 * @typedef {object} FetcherOptions
 * @property {string} userAgent
 * @property {number} [timeoutMs]
 * @property {number} [maxBytes]
 * @property {number} [maxRedirects]
 * @property {number} [robotsCacheMs]
 * @property {typeof dns.lookup} [lookup]
 * @property {boolean} [unsafeAllowPrivateForTests] never set this in production
 */

/**
 * @param {FetcherOptions} options
 */
export function createListingFetcher(options) {
  const {
    userAgent,
    timeoutMs = 15000,
    maxBytes = 3_000_000,
    maxRedirects = 4,
    robotsCacheMs = 60 * 60 * 1000,
    lookup = dns.lookup,
    unsafeAllowPrivateForTests = false,
  } = options;
  const productToken = userAgent.split('/')[0].trim() || 'NestWorthBot';
  const urlOpts = { allowPrivate: unsafeAllowPrivateForTests, allowAnyPort: unsafeAllowPrivateForTests };
  /** @type {Map<string, { at: number, groups: import('./robots.js').RobotsGroup[] | null }>} */
  const robotsCache = new Map();

  /**
   * DNS lookup that refuses private addresses at connection time.
   * @param {string} hostname
   * @param {any} opts
   * @param {(err: Error | null, address?: any, family?: number) => void} callback
   */
  function safeLookup(hostname, opts, callback) {
    lookup(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = /** @type {dns.LookupAddress[]} */ (/** @type {unknown} */ (addresses));
      if (!list.length) return callback(Object.assign(new Error('No addresses'), { code: 'ENOTFOUND' }));
      if (!unsafeAllowPrivateForTests && list.some((a) => isBlockedAddress(a.address))) {
        return callback(Object.assign(new Error('Blocked address'), { code: 'EBLOCKED' }));
      }
      if (opts && opts.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  }

  /**
   * One GET request with limits. Does not follow redirects.
   * @param {URL} url
   * @param {string} accept
   * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: Buffer }>}
   */
  function get(url, accept) {
    const mod = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = mod.request(
        url,
        {
          method: 'GET',
          lookup: /** @type {any} */ (safeLookup),
          timeout: timeoutMs,
          headers: {
            'user-agent': userAgent,
            accept,
            'accept-language': 'en-GB,en;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
          },
        },
        (res) => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400) {
            res.resume();
            resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
            return;
          }
          /** @type {NodeJS.ReadableStream} */
          let stream = res;
          const enc = String(res.headers['content-encoding'] || '').toLowerCase();
          if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
          else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
          else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
          /** @type {Buffer[]} */
          const chunks = [];
          let size = 0;
          stream.on('data', (/** @type {Buffer} */ chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              req.destroy(new AppError(413, 'PAGE_TOO_LARGE', 'That page is too large to read. Paste the listing text instead.'));
              return;
            }
            chunks.push(chunk);
          });
          stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
          stream.on('error', reject);
        },
      );
      const overall = setTimeout(() => req.destroy(new AppError(504, 'FETCH_TIMEOUT', 'The website took too long to answer. Paste the listing text instead.')), timeoutMs * 2);
      req.on('timeout', () => req.destroy(new AppError(504, 'FETCH_TIMEOUT', 'The website took too long to answer. Paste the listing text instead.')));
      req.on('error', (err) => reject(mapNetworkError(err)));
      req.on('close', () => clearTimeout(overall));
      req.end();
    });
  }

  /**
   * @param {URL} url
   */
  async function robotsAllows(url) {
    const cached = robotsCache.get(url.origin);
    /** @type {import('./robots.js').RobotsGroup[] | null} */
    let groups;
    if (cached && Date.now() - cached.at < robotsCacheMs) {
      groups = cached.groups;
    } else {
      groups = null; // null = could not read robots.txt: treat as disallowed (RFC 9309)
      try {
        let target = new URL('/robots.txt', url.origin);
        for (let hop = 0; hop < 5; hop++) {
          const res = await get(target, 'text/plain');
          if (res.status >= 300 && res.status < 400 && res.headers.location) {
            target = checkListingUrl(new URL(res.headers.location, target).toString(), urlOpts);
            continue;
          }
          if (res.status >= 200 && res.status < 300) groups = parseRobots(res.body.toString('utf8').slice(0, 512000));
          else if (res.status >= 400 && res.status < 500) groups = []; // no robots.txt: allowed
          break;
        }
      } catch (err) {
        // A blocked or unknown host is the real problem; report that, not robots.txt.
        if (err instanceof AppError && (err.code === 'URL_BLOCKED' || err.code === 'URL_NOT_FOUND')) throw err;
        groups = null;
      }
      robotsCache.set(url.origin, { at: Date.now(), groups });
    }
    if (groups === null) return false;
    return isAllowed(groups, productToken, `${url.pathname}${url.search}`);
  }

  /**
   * @param {string} rawUrl
   * @returns {Promise<{ finalUrl: string, title: string, text: string }>}
   */
  return async function fetchListing(rawUrl) {
    let url = checkListingUrl(rawUrl, urlOpts);
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (!(await robotsAllows(url))) {
        throw new AppError(403, 'ROBOTS_DISALLOWED', 'This website asks automated tools not to read this page. Open the listing yourself, copy the description and paste it in instead.');
      }
      const res = await get(url, 'text/html,application/xhtml+xml,text/plain;q=0.8');
      if (res.status >= 300 && res.status < 400) {
        if (!res.headers.location) throw new AppError(502, 'FETCH_FAILED', 'The website sent an empty redirect.');
        url = checkListingUrl(new URL(res.headers.location, url).toString(), urlOpts);
        continue;
      }
      if ([401, 403, 429].includes(res.status)) {
        throw new AppError(502, 'FETCH_REFUSED', 'The website refused the request; it may block automated tools. Paste the listing text instead.');
      }
      if (res.status === 404 || res.status === 410) throw new AppError(404, 'LISTING_GONE', 'That page wasn’t found. The listing may have been removed.');
      if (res.status < 200 || res.status >= 300) throw new AppError(502, 'FETCH_FAILED', `The website returned an error (${res.status}). Paste the listing text instead.`);

      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (!/text\/html|application\/xhtml\+xml|text\/plain/.test(type)) {
        throw new AppError(415, 'UNSUPPORTED_CONTENT', 'That link isn’t a web page the app can read. For a PDF brochure, copy its text instead.');
      }
      const charset = /charset=["']?([\w-]+)/.exec(type)?.[1] || 'utf-8';
      let decoded;
      try {
        decoded = new TextDecoder(charset).decode(res.body);
      } catch {
        decoded = new TextDecoder('utf-8').decode(res.body);
      }
      if (type.includes('text/plain')) return { finalUrl: url.toString(), title: '', text: decoded.slice(0, 60000) };
      const { title, text } = htmlToText(decoded);
      return { finalUrl: url.toString(), title, text };
    }
    throw new AppError(502, 'TOO_MANY_REDIRECTS', 'The link redirected too many times.');
  };
}

/** @param {any} err */
function mapNetworkError(err) {
  if (err instanceof AppError) return err;
  if (err && err.code === 'EBLOCKED') return new AppError(400, 'URL_BLOCKED', 'That link points to a private or local address, so it can’t be read.');
  if (err && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN')) return new AppError(400, 'URL_NOT_FOUND', 'Couldn’t find that website. Check the link.');
  return new AppError(502, 'FETCH_FAILED', 'Couldn’t read that page. Paste the listing text instead.', { cause: err });
}
