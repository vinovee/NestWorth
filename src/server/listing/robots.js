// @ts-check
/**
 * robots.txt support following RFC 9309: user-agent groups, Allow and Disallow,
 * the * wildcard and the $ end anchor, longest match wins and Allow wins ties.
 * Respecting robots.txt is part of being a good citizen; many property portals
 * also forbid automated access in their terms, so the app always offers
 * "paste the listing text" as the alternative.
 */

/** @typedef {{ agents: string[], rules: { allow: boolean, path: string }[] }} RobotsGroup */

/**
 * @param {string} text
 * @returns {RobotsGroup[]}
 */
export function parseRobots(text) {
  /** @type {RobotsGroup[]} */
  const groups = [];
  /** @type {RobotsGroup | null} */
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (!current) continue;
      if (!value) continue; // "Disallow:" with no path allows everything
      current.rules.push({ allow: key === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

/** @param {string} s */
const escapeRegex = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} pattern
 * @param {string} path
 */
function matches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = `^${body.split('*').map(escapeRegex).join('.*')}${anchored ? '$' : ''}`;
  return new RegExp(source).test(path);
}

/**
 * @param {RobotsGroup[]} groups
 * @param {string} productToken e.g. "NestWorthBot"
 * @param {string} pathAndQuery e.g. "/property/123?x=1"
 */
export function isAllowed(groups, productToken, pathAndQuery) {
  if (pathAndQuery === '/robots.txt') return true;
  const token = productToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && (a === token || token.includes(a))));
  const relevant = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  /** @type {{ allow: boolean, path: string } | null} */
  let best = null;
  for (const rule of relevant.flatMap((g) => g.rules)) {
    if (!matches(rule.path, pathAndQuery)) continue;
    const len = rule.path.replace(/\$$/, '').length;
    const bestLen = best ? best.path.replace(/\$$/, '').length : -1;
    if (!best || len > bestLen || (len === bestLen && rule.allow && !best.allow)) best = rule;
  }
  return best ? best.allow : true;
}
