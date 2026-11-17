import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { createLogger } from '../src/server/logger.js';
import { createMockProvider } from '../src/server/ai/providers/mock.js';
import { criteriaForAI, EXAMPLE_PROFILE } from '../src/shared/profile.js';

const LISTING = readFileSync(new URL('../examples/listings/oak-lane-new-semi.txt', import.meta.url), 'utf8');
const body = (over = {}) => JSON.stringify({ listing: { url: '', text: LISTING }, criteria: criteriaForAI(EXAMPLE_PROFILE), options: { research: false }, ...over });

/** Start an app on a random port. */
async function start(env) {
  const { config, errors } = loadConfig({ LLM_PROVIDER: 'mock', ...env }, []);
  assert.deepEqual(errors, []);
  const app = createApp({ config, provider: createMockProvider(), fetchListing: async () => { throw new Error('no fetch in tests'); }, log: createLogger('silent') });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

let open;
let locked;
let strict;
before(async () => {
  open = await start({ RATE_LIMIT_PER_10_MIN: '100' });
  locked = await start({ APP_ACCESS_TOKEN: 'correct-horse-battery-staple' });
  strict = await start({ RATE_LIMIT_PER_10_MIN: '2' });
});
after(() => {
  open.server.close();
  locked.server.close();
  strict.server.close();
});

const post = (base, payload, headers = {}) =>
  fetch(`${base}/api/assess`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: payload });

test('health reports capabilities', async () => {
  const res = await fetch(`${open.base}/api/health`);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.demo, true);
  assert.equal(j.authRequired, false);
  assert.equal(j.promptVersion, 'assess-listing@1');
});

test('the web app is served with strict security headers', async () => {
  const res = await fetch(`${open.base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  const shared = await fetch(`${open.base}/shared/finance.js`);
  assert.equal(shared.status, 200);
  assert.match(shared.headers.get('content-type'), /text\/javascript/);
  const etag = shared.headers.get('etag');
  const again = await fetch(`${open.base}/shared/finance.js`, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
});

test('path traversal and unknown files are refused', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/shared/../server/config.js', '/shared/%2e%2e/server/config.js', '/.env', '/nope.html', '/js/../../../package.json']) {
    const res = await fetch(`${open.base}${p}`);
    assert.equal(res.status, 404, p);
  }
});

test('an assessment round trip works in demo mode', async () => {
  const res = await post(open.base, body());
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.assessment.listing.price, 330000);
  assert.equal(j.assessment.listing.propertyType, 'semi_detached');
  assert.equal(j.meta.provider, 'demo');
  assert.ok(res.headers.get('x-request-id'));
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('bad requests get clear errors', async () => {
  let res = await post(open.base, 'not json');
  assert.equal(res.status, 400);
  res = await fetch(`${open.base}/api/assess`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: body() });
  assert.equal(res.status, 415);
  res = await post(open.base, JSON.stringify({ listing: { url: '', text: LISTING } }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /criteria/);
  res = await post(open.base, body(), { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  res = await post(open.base, body(), { 'sec-fetch-site': 'cross-site' });
  assert.equal(res.status, 403);
  res = await fetch(`${open.base}/api/assess`);
  assert.equal(res.status, 405);
  res = await fetch(`${open.base}/api/nothing`);
  assert.equal(res.status, 404);
});

test('rate limiting protects the AI budget', async () => {
  assert.equal((await post(strict.base, body())).status, 200);
  assert.equal((await post(strict.base, body())).status, 200);
  const third = await post(strict.base, body());
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get('retry-after')) > 0);
});

test('an access token is required when configured', async () => {
  assert.equal((await fetch(`${locked.base}/api/health`)).status, 200, 'health stays open');
  assert.equal((await post(locked.base, body())).status, 401);
  assert.equal((await post(locked.base, body(), { authorization: 'Bearer wrong-token-value' })).status, 401);
  assert.equal((await post(locked.base, body(), { authorization: 'Bearer correct-horse-battery-staple' })).status, 200);
});
