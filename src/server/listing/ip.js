// @ts-check
/**
 * Server-side request forgery (SSRF) protection. The listing fetcher may only reach
 * public internet addresses on standard web ports, never this machine, the local
 * network or cloud metadata services.
 */
import net from 'node:net';
import { AppError } from '../errors.js';

// Two separate lists: a BlockList holding an IPv4-mapped IPv6 rule would match
// every IPv4 address, so mapped addresses are handled by hand below.
const v4 = new net.BlockList();
for (const [address, prefix] of /** @type {[string, number][]} */ ([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
])) v4.addSubnet(address, prefix, 'ipv4');
const v6 = new net.BlockList();
for (const [address, prefix] of /** @type {[string, number][]} */ ([
  ['::', 127], // :: and ::1
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], // NAT64 can reach internal IPv4
  ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], // discard, Teredo, docs, 6to4
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], // unique local, link-local, multicast
])) v6.addSubnet(address, prefix, 'ipv6');

/**
 * The eight 16-bit groups of an IPv6 address.
 * @param {string} ip
 */
function hextets(ip) {
  let s = ip.toLowerCase().split('%')[0];
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    s = `${s.slice(0, -dotted[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.includes('::') ? s.split('::') : [s, null];
  const h = head ? head.split(':') : [];
  const t = tail === null ? [] : tail.split(':');
  const fill = tail === null ? [] : Array(Math.max(0, 8 - h.length - t.length)).fill('0');
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16));
}

/**
 * True if an IP address is not a public unicast address.
 * @param {string} ip
 */
export function isBlockedAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return v4.check(ip, 'ipv4');
  if (family === 6) {
    const h = hextets(ip);
    const mapped = h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff;
    if (mapped) return true; // IPv4-mapped: never needed for public hostnames
    return v6.check(ip, 'ipv6');
  }
  return true;
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

/**
 * Parse and check a listing URL before any network access.
 * @param {string} raw
 * @param {{ allowPrivate?: boolean, allowAnyPort?: boolean }} [opts] test-only escape hatches
 * @returns {URL}
 */
export function checkListingUrl(raw, opts = {}) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new AppError(400, 'BAD_URL', 'That doesn’t look like a web address. Copy the full link, starting with https://.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError(400, 'BAD_URL', 'Only web links (https:// or http://) can be read.');
  }
  if (url.username || url.password) throw new AppError(400, 'BAD_URL', 'Links with a username or password can’t be read.');
  if (url.port && !['80', '443'].includes(url.port) && !opts.allowAnyPort) {
    throw new AppError(400, 'BAD_URL', 'Only links on standard web ports can be read.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!opts.allowPrivate) {
    if (net.isIP(host)) {
      if (isBlockedAddress(host)) throw new AppError(400, 'URL_BLOCKED', 'That link points to a private or local address, so it can’t be read.');
    } else if (host === 'localhost' || !host.includes('.') || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
      throw new AppError(400, 'URL_BLOCKED', 'That link points to a private or local address, so it can’t be read.');
    }
  }
  url.hash = '';
  return url;
}
