// @ts-check
/**
 * Turns a listing web page into plain text for the model. Keeps the title, meta
 * descriptions and any JSON-LD structured data (property portals often put the
 * price, address and floor area there), then the visible text.
 */

const ENTITIES = /** @type {Record<string, string>} */ ({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€', ndash: '–',
  mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sup2: '²', frac12: '½',
  deg: '°', times: '×', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
});

/** @param {string} s */
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

/** @param {string} s */
const squash = (s) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * @param {string} html
 * @param {{ maxChars?: number }} [opts]
 * @returns {{ title: string, text: string }}
 */
export function htmlToText(html, opts = {}) {
  const maxChars = opts.maxChars ?? 60000;
  const title = squash(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');

  /** @type {string[]} */
  const meta = [];
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const name = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() || '';
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || '';
    if (content && /^(description|og:title|og:description|twitter:description)$/.test(name)) {
      meta.push(`${name}: ${squash(content)}`);
    }
  }

  /** @type {string[]} */
  const structured = [];
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const raw = m[1].trim();
    try {
      structured.push(JSON.stringify(JSON.parse(raw)));
    } catch {
      structured.push(raw.replace(/\s+/g, ' '));
    }
  }

  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|dd|dt|header|footer|main|aside|blockquote|figure|figcaption|nav)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<(td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  /** @type {string[]} */
  const lines = [];
  for (const line of decodeEntities(body).split('\n')) {
    const clean = line.replace(/[ \t\f\v\u00a0]+/g, ' ').trim();
    if (clean && clean !== '•' && clean !== lines[lines.length - 1]) lines.push(clean);
  }

  const parts = [];
  if (title) parts.push(`Page title: ${title}`);
  if (meta.length) parts.push(meta.join('\n'));
  if (structured.length) parts.push(`Structured data on the page:\n${structured.join('\n').slice(0, 12000)}`);
  parts.push(`Page text:\n${lines.join('\n')}`);
  let text = parts.join('\n\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n[Trimmed]`;
  return { title, text };
}
