// @ts-check
/**
 * Tiny DOM helpers. Text always goes in as text nodes, never as HTML, so nothing
 * from a listing or an AI answer can inject markup or script. Styles are set
 * through the CSSOM, which the Content Security Policy allows.
 */

/** @typedef {Node | string | number | null | undefined | false} Child */

/**
 * Create an element.
 *   h('button', { class: 'btn', onclick: fn, aria: { pressed: 'true' } }, 'Save')
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...(Child | Child[])} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props || {});
  append(el, children);
  return el;
}

/**
 * Create an SVG element.
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...(Child | Child[])} children
 * @returns {SVGElement}
 */
export function s(tag, attrs, ...children) {
  const el = /** @type {SVGElement} */ (document.createElementNS('http://www.w3.org/2000/svg', tag));
  applyProps(el, attrs || {});
  append(el, children);
  return el;
}

/**
 * @param {Element} el
 * @param {Record<string, any>} props
 */
function applyProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value));
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'style') Object.assign(/** @type {HTMLElement} */ (el).style, value);
    else if (key === 'vars') for (const [k, v] of Object.entries(value)) /** @type {HTMLElement} */ (el).style.setProperty(k, String(v));
    else if (key === 'dataset') Object.assign(/** @type {HTMLElement} */ (el).dataset, value);
    else if (key === 'aria') for (const [k, v] of Object.entries(value)) el.setAttribute(`aria-${k}`, String(v));
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'value' && 'value' in el) /** @type {HTMLInputElement} */ (el).value = String(value);
    else if (key === 'checked' && 'checked' in el) /** @type {HTMLInputElement} */ (el).checked = Boolean(value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
}

/**
 * @param {Node} parent
 * @param {(Child | Child[])[]} children
 */
function append(parent, children) {
  for (const c of children.flat(3)) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

/**
 * Replace an element's contents.
 * @param {Element} el
 * @param {...(Child | Child[])} children
 */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** @param {string} id */
export function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/** Announce a message to screen readers. */
export function announce(/** @type {string} */ message) {
  const live = document.getElementById('live');
  if (live) {
    live.textContent = '';
    window.setTimeout(() => {
      live.textContent = message;
    }, 50);
  }
}

/** A collapsible section built on <details>, so it works without script too. */
export function fold(/** @type {string} */ title, /** @type {string} */ summary, /** @type {(Child | Child[])[]} */ body, open = false, cls = 'blk') {
  return h('details', { class: cls, open },
    h('summary', null, h('span', { class: 'ft' }, title), summary ? h('span', { class: 'fs' }, summary) : null, icon('chevron')),
    h('div', { class: 'fb' }, ...body));
}

const ICONS = {
  chevron: 'm4 6 4 4 4-4',
  external: 'M6 3h7v7M13 3 4 12',
  left: 'M10 3 5 8l5 5',
  right: 'm6 3 5 5-5 5',
  plus: 'M8 3v10M3 8h10',
  check: 'm3.5 8.5 3 3 6-7',
  close: 'm4 4 8 8M12 4l-8 8',
  sort: 'M5 13V3M5 3 2.5 5.5M5 3l2.5 2.5M11 3v10m0 0-2.5-2.5M11 13l2.5-2.5',
};

/**
 * @param {keyof typeof ICONS} name
 */
export function icon(name) {
  return s('svg', { class: `icon icon-${name}`, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
    s('path', { d: ICONS[name], stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

/** An external link that opens safely in a new tab. */
export function extLink(/** @type {string} */ href, /** @type {string} */ label, cls = 'tlink') {
  let safe = '';
  try {
    const u = new URL(href);
    if (u.protocol === 'https:' || u.protocol === 'http:') safe = u.toString();
  } catch {
    safe = '';
  }
  if (!safe) return null;
  return h('a', { class: cls, href: safe, target: '_blank', rel: 'noopener noreferrer' }, label, icon('external'));
}
