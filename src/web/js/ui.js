// @ts-check
/** Shared screen state and small UI services (navigation, toasts, dialog). */
import { $, h, mount, announce, icon } from './dom.js';

/** @typedef {import('./api.js').Health} Health */

const PREFS_KEY = 'nestworth/ui';

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}
const prefs = loadPrefs();

export const ui = {
  /** @type {Health | null} */
  health: null,
  /** @type {string} */
  healthError: '',
  route: 'dashboard',
  /** @type {string | null} */
  currentId: null,
  tab: typeof prefs.tab === 'string' ? prefs.tab : 'active',
  sort: typeof prefs.sort === 'string' ? prefs.sort : 'fit',
  verdict: typeof prefs.verdict === 'string' ? prefs.verdict : 'all',
  /** @type {(() => void) | null} */
  rerender: null,
  /** Scroll to the card after the next render (set when opening a specific home). */
  scrollToCard: false,
};

export function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ tab: ui.tab, sort: ui.sort, verdict: ui.verdict }));
  } catch {
    // storage blocked: preferences won't persist
  }
}

/** @param {string} hash e.g. "#/homes/abc" */
export function go(hash) {
  if (location.hash === hash) ui.rerender?.();
  else location.hash = hash;
}

let toastTimer = 0;
/**
 * @param {string} message
 * @param {{ label: string, run: () => void }[]} [actions]
 */
export function toast(message, actions = []) {
  const el = $('toast');
  window.clearTimeout(toastTimer);
  mount(el,
    h('span', { class: 'tm' }, message),
    ...actions.map((a) => h('button', { type: 'button', onclick: () => { hideToast(); a.run(); } }, a.label)),
    h('button', { type: 'button', class: 'tx', 'aria-label': 'Dismiss', onclick: hideToast }, icon('close')));
  el.hidden = false;
  announce(message);
  toastTimer = window.setTimeout(hideToast, 7000);
}
export function hideToast() {
  window.clearTimeout(toastTimer);
  $('toast').hidden = true;
}

/**
 * Open the shared modal dialog with a title, content and optional footer.
 * @param {string} title
 * @param {(Node | null)[]} content
 * @param {{ onClose?: () => void, wide?: boolean }} [opts]
 */
export function openDialog(title, content, opts = {}) {
  const dlg = /** @type {HTMLDialogElement} */ ($('dialog'));
  dlg.classList.toggle('wide', Boolean(opts.wide));
  mount(dlg,
    h('div', { class: 'sheet-head' },
      h('h2', { id: 'dialogTitle' }, title),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => closeDialog() }, 'Close')),
    h('div', { class: 'sheet-body' }, ...content));
  dlg.onclose = () => opts.onClose?.();
  if (!dlg.open) dlg.showModal();
  const first = /** @type {HTMLElement | null} */ (dlg.querySelector('.sheet-body input, .sheet-body textarea, .sheet-body select, .sheet-body button'));
  first?.focus();
  return dlg;
}
export function closeDialog() {
  const dlg = /** @type {HTMLDialogElement} */ ($('dialog'));
  if (dlg.open) dlg.close();
}

/** Ordinal: 1st, 2nd, 3rd. */
export function ordinal(/** @type {number} */ n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
