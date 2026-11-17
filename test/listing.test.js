import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isBlockedAddress, checkListingUrl } from '../src/server/listing/ip.js';
import { parseRobots, isAllowed } from '../src/server/listing/robots.js';
import { htmlToText, decodeEntities } from '../src/server/listing/html-to-text.js';
import { createListingFetcher } from '../src/server/listing/fetch.js';

test('private, local and special addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'not-an-ip']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '151.101.1.69', '172.32.0.1', '2a00:1450:4009:81f::200e']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('listing URLs are checked before any network access', () => {
  assert.equal(checkListingUrl('https://www.example.com/listing/1#photos').toString(), 'https://www.example.com/listing/1');
  for (const bad of ['ftp://example.com/x', 'javascript:alert(1)', 'https://user:pw@example.com/', 'http://localhost/', 'http://intranet/', 'http://printer.local/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'https://example.com:8443/', 'not a url']) {
    assert.throws(() => checkListingUrl(bad), (e) => ['BAD_URL', 'URL_BLOCKED'].includes(e.code), bad);
  }
});

test('robots.txt: groups, wildcards, anchors, longest match', () => {
  const groups = parseRobots([
    'User-agent: *',
    'Disallow: /private/',
    'Allow: /private/listings/',
    'Disallow: /*.pdf$',
    '',
    'User-agent: NestWorthBot',
    'User-agent: OtherBot',
    'Disallow: /search',
    '# comment',
  ].join('\n'));
  assert.equal(groups.length, 2);
  assert.equal(isAllowed(groups, 'NestWorthBot', '/private/x'), true, 'specific group replaces *');
  assert.equal(isAllowed(groups, 'NestWorthBot', '/search?q=1'), false);
  assert.equal(isAllowed(groups, 'SomeoneElse', '/private/x'), false);
  assert.equal(isAllowed(groups, 'SomeoneElse', '/private/listings/1'), true, 'longer allow wins');
  assert.equal(isAllowed(groups, 'SomeoneElse', '/brochure.pdf'), false);
  assert.equal(isAllowed(groups, 'SomeoneElse', '/brochure.pdf?x'), true, '$ anchors the end');
  assert.equal(isAllowed([], 'Any', '/x'), true);
  assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow: /'), 'Any', '/robots.txt'), true);
  assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow:'), 'Any', '/x'), true, 'empty disallow allows all');
});

test('HTML becomes readable text with structured data kept', () => {
  const html = `<!doctype html><html><head><title>Oak Lane &amp; more</title>
    <meta name="description" content="3 bed semi &ndash; £330,000">
    <script type="application/ld+json">{"@type":"Residence","price":"330000"}</script>
    <style>.x{}</style><script>alert(1)</script></head>
    <body><h1>Oak&nbsp;Lane</h1><p>Guide price &pound;330,000</p><ul><li>Driveway</li><li>Garden</li></ul>
    <!-- hidden --><noscript>nope</noscript></body></html>`;
  const { title, text } = htmlToText(html);
  assert.equal(title, 'Oak Lane & more');
  assert.match(text, /description: 3 bed semi – £330,000/);
  assert.match(text, /"price":"330000"/);
  assert.match(text, /Guide price £330,000/);
  assert.match(text, /• Driveway/);
  assert.doesNotMatch(text, /alert|nope|hidden|\.x\{\}/);
  assert.equal(decodeEntities('&#163;1&#x2013;2 &unknown;'), '£1–2 &unknown;');
});

/** A local website for fetch tests. */
async function withSite(routes, fn) {
  const server = http.createServer((req, res) => {
    const route = routes[req.url];
    if (!route) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.writeHead(route.status || 200, route.headers || { 'content-type': 'text/html; charset=utf-8' });
    res.end(route.body || '');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('fetcher reads a page, follows a redirect and respects robots.txt', async () => {
  await withSite({
    '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /blocked' },
    '/old': { status: 301, headers: { location: '/listing' } },
    '/listing': { body: '<title>Oak Lane</title><p>Guide price £330,000</p>' },
    '/blocked': { body: 'secret' },
    '/pdf': { headers: { 'content-type': 'application/pdf' }, body: '%PDF' },
  }, async (base) => {
    const fetchListing = createListingFetcher({ userAgent: 'NestWorthBot/test', unsafeAllowPrivateForTests: true });
    const page = await fetchListing(`${base}/old`);
    assert.equal(page.finalUrl, `${base}/listing`);
    assert.equal(page.title, 'Oak Lane');
    assert.match(page.text, /£330,000/);
    await assert.rejects(fetchListing(`${base}/blocked`), { code: 'ROBOTS_DISALLOWED' });
    await assert.rejects(fetchListing(`${base}/pdf`), { code: 'UNSUPPORTED_CONTENT' });
    await assert.rejects(fetchListing(`${base}/missing`), { code: 'LISTING_GONE' });
  });
});

test('fetcher refuses local addresses without the test escape hatch', async () => {
  const fetchListing = createListingFetcher({ userAgent: 'NestWorthBot/test' });
  await assert.rejects(fetchListing('http://127.0.0.1/'), { code: 'URL_BLOCKED' });
});

test('fetcher refuses hostnames that resolve to private addresses (DNS rebinding)', async () => {
  const lookup = (host, opts, cb) => cb(null, [{ address: '10.0.0.5', family: 4 }]);
  const fetchListing = createListingFetcher({ userAgent: 'NestWorthBot/test', lookup });
  await assert.rejects(fetchListing('https://listing.example.com/1'), { code: 'URL_BLOCKED' });
});
