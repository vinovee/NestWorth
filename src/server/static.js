// @ts-check
/**
 * Serves the web app and the shared modules it imports. Only files inside the two
 * roots, and only known file types, can be served.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * @param {{ web: string, shared: string }} roots
 */
export function createStaticHandler(roots) {
  const web = path.resolve(roots.web);
  const shared = path.resolve(roots.shared);

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   */
  return async function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      throw new AppError(400, 'BAD_PATH', 'Bad path.');
    }
    if (pathname.includes('\0')) throw new AppError(400, 'BAD_PATH', 'Bad path.');

    let root = web;
    let rel = pathname;
    if (pathname.startsWith('/shared/')) {
      root = shared;
      rel = pathname.slice('/shared'.length);
    }
    if (rel === '/' || rel === '') rel = '/index.html';

    const file = path.resolve(root, `.${rel}`);
    if (!file.startsWith(root + path.sep)) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    const type = /** @type {Record<string, string>} */ (TYPES)[path.extname(file).toLowerCase()];
    if (!type) throw new AppError(404, 'NOT_FOUND', 'Not found.');

    let info;
    try {
      info = await stat(file);
    } catch {
      throw new AppError(404, 'NOT_FOUND', 'Not found.');
    }
    if (!info.isFile()) throw new AppError(404, 'NOT_FOUND', 'Not found.');

    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(info.size));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    /** @type {Promise<void>} */
    const done = new Promise((resolve, reject) => {
      const stream = createReadStream(file);
      stream.on('error', reject);
      stream.on('end', () => resolve());
      stream.pipe(res);
    });
    await done;
  };
}
