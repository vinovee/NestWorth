// @ts-check
/** HTTP helpers: security headers, JSON responses and bounded body reading. */
import { AppError } from './errors.js';

/** @typedef {import('node:http').IncomingMessage} Req */
/** @typedef {import('node:http').ServerResponse} Res */

/**
 * A strict Content Security Policy: no inline scripts or styles, no third-party
 * origins. The browser can only talk to this server.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @param {Res} res */
export function setSecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
}

/**
 * @param {Res} res
 * @param {number} status
 * @param {unknown} body
 */
export function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Read and parse a JSON body, refusing anything too large or not JSON.
 * @param {Req} req
 * @param {number} maxBytes
 * @returns {Promise<unknown>}
 */
export async function readJsonBody(req, maxBytes) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Requests must be sent as JSON.');
  }
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > maxBytes) throw new AppError(413, 'TOO_LARGE', 'That request is too large. Shorten the listing text and try again.');

  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError(413, 'TOO_LARGE', 'That request is too large. Shorten the listing text and try again.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'BAD_JSON', 'The request body is not valid JSON.');
  }
}

/**
 * The client address for rate limiting.
 * @param {Req} req
 * @param {boolean} trustProxy only trust X-Forwarded-For behind a proxy you control
 */
export function clientKey(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}
