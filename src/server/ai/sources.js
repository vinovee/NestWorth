// @ts-check
/**
 * Citation check: an assessment may only cite pages the system actually gave the
 * model (the listing URL and pages returned by web search). Anything else is a
 * possible hallucination and is removed.
 */

/** @param {string} raw */
export function normaliseUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

/**
 * @param {{ title: string, url: string }[]} sources
 * @param {string[]} allowedUrls
 * @param {{ url: string, title: string } | null} [listing] always listed first if given
 */
export function verifySources(sources, allowedUrls, listing = null) {
  const allowed = new Set(allowedUrls.map(normaliseUrl).filter(Boolean));
  /** @type {{ title: string, url: string }[]} */
  const kept = [];
  const seen = new Set();
  let removed = 0;
  if (listing && normaliseUrl(listing.url)) {
    kept.push({ title: listing.title || 'The listing', url: listing.url });
    seen.add(normaliseUrl(listing.url));
  }
  for (const s of sources) {
    const n = normaliseUrl(s.url);
    if (n && seen.has(n)) continue;
    if (n && allowed.has(n)) {
      kept.push({ title: s.title || s.url, url: s.url });
      seen.add(n);
    } else {
      removed++;
    }
  }
  return { kept, removed };
}
