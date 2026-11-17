// @ts-check
/** Things you can do to a home from more than one screen. */
import { h } from './dom.js';
import { ui, toast, go, openDialog, closeDialog } from './ui.js';
import {
  getState, trackOf, setStatus, undoStatus, setReasons, removeHome, setOverrides, replaceAssessment,
  RULED_OUT, REASONS,
} from './store.js';
import { TABS, tabFor, listHomes } from './derive.js';
import { criteriaForAI } from '../../shared/profile.js';
import { PROPERTY_TYPES, PROPERTY_TYPE_LABELS } from '../../shared/schema.js';
import * as api from './api.js';
import { parseAmount } from '../../shared/format.js';

/** @param {string} id */
const nameOf = (id) => getState().homes[id]?.assessment.listing.title || 'This home';

/** Open a home's card, switching tab or filter if needed so it's visible. */
export function viewHome(/** @type {string} */ id) {
  const status = trackOf(id).status;
  const tab = TABS.find((t) => t.key === ui.tab) || TABS[0];
  if (!tab.has(status)) ui.tab = tabFor(status);
  if (!listHomes(ui.tab, ui.verdict, ui.sort).some((x) => x.id === id)) ui.verdict = 'all';
  ui.currentId = id;
  ui.scrollToCard = true;
  go(`#/homes/${encodeURIComponent(id)}`);
}

/**
 * @param {string} id
 * @param {string} status
 */
export function changeStatus(id, status) {
  if (!getState().homes[id]) return;
  const before = trackOf(id).status;
  if (status === before) return;
  if (status === RULED_OUT) {
    openReasonDialog(id, 'ruleout');
    return;
  }
  const undo = setStatus(id, status);
  const dest = TABS.find((t) => t.key === tabFor(status))?.label || 'Active';
  toast(before === RULED_OUT ? `${nameOf(id)} restored to ${dest}.` : `${nameOf(id)} moved to ${dest}.`, [
    { label: 'Undo', run: () => undoStatus(id, undo) },
    { label: 'View', run: () => viewHome(id) },
  ]);
}

/** @param {string} id */
export function restore(id) {
  const prev = trackOf(id).prevStatus;
  changeStatus(id, prev && prev !== RULED_OUT ? prev : '');
}

/**
 * Ask why a home is being ruled out (or edit the reason later).
 * @param {string} id
 * @param {'ruleout' | 'edit'} mode
 * @param {string[]} [preselect] reasons to tick if none are saved yet
 */
export function openReasonDialog(id, mode, preselect = []) {
  const t = trackOf(id);
  const picked = new Set(t.reasons.length ? t.reasons : preselect);
  const text = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: 'reasonText', rows: 3, maxlength: 2000, placeholder: 'For example: small garden, kitchen too narrow, price won’t come down…' }));
  text.value = t.reasonText;
  const tags = REASONS.map(([key, label]) => h('button', {
    type: 'button',
    class: 'rtag',
    aria: { pressed: String(picked.has(key)) },
    onclick: (/** @type {Event} */ e) => {
      if (picked.has(key)) picked.delete(key);
      else picked.add(key);
      /** @type {HTMLElement} */ (e.currentTarget).setAttribute('aria-pressed', String(picked.has(key)));
    },
  }, label));
  const save = () => {
    setReasons(id, [...picked], text.value.trim());
    closeDialog();
    if (mode === 'ruleout' && trackOf(id).status !== RULED_OUT) {
      const undo = setStatus(id, RULED_OUT);
      toast(`${nameOf(id)} moved to Archived.`, [{ label: 'Undo', run: () => undoStatus(id, undo) }]);
    } else {
      toast(`Reason saved for ${nameOf(id)}.`);
    }
  };
  openDialog(mode === 'ruleout' ? `Rule out ${nameOf(id)}?` : `Why you ruled out ${nameOf(id)}`, [
    h('p', { class: 'muted' }, mode === 'ruleout'
      ? 'Pick what applies and add a line if you like. It moves to Archived, and you can restore it later.'
      : 'Pick what applies and add a line in your own words.'),
    h('div', { class: 'rtags', role: 'group', 'aria-label': 'Reasons' }, ...tags),
    h('label', { class: 'flabel', for: 'reasonText' }, 'In your own words (optional)'),
    text,
    h('button', { type: 'button', class: 'btn primary block', onclick: save }, mode === 'ruleout' ? 'Rule out' : 'Save reason'),
  ]);
}

/** Correct the AI's key facts by hand. Your values win until you reset them. */
export function openEditFacts(/** @type {string} */ id) {
  const home = getState().homes[id];
  if (!home) return;
  const a = home.assessment;
  const o = home.overrides || {};
  const ai = /** @type {Record<string, any>} */ ({
    price: a.listing.price, priceMax: a.listing.priceMax, bedrooms: a.listing.bedrooms,
    minutesMin: a.commute.minutesMin, minutesMax: a.commute.minutesMax, farePerDay: a.commute.farePerDay,
  });
  const fields = /** @type {[string, string, string][]} */ ([
    ['price', 'Price (or lowest of a range)', 'numeric'],
    ['priceMax', 'Top of the price range', 'numeric'],
    ['bedrooms', 'Bedrooms', 'numeric'],
    ['minutesMin', 'Commute, shortest typical (minutes)', 'numeric'],
    ['minutesMax', 'Commute, longest typical (minutes)', 'numeric'],
    ['farePerDay', 'Fares per office day (return)', 'decimal'],
  ]);
  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {};
  const rows = fields.map(([key, label, mode]) => {
    const input = /** @type {HTMLInputElement} */ (h('input', {
      id: `ef-${key}`, inputmode: mode, autocomplete: 'off',
      placeholder: ai[key] === null || ai[key] === undefined ? 'Not stated' : `AI: ${ai[key]}`,
    }));
    if (key in o) input.value = String(o[key]);
    inputs[key] = input;
    return h('div', { class: 'field' }, h('label', { class: 'flabel', for: `ef-${key}` }, label), input);
  });
  const typeSel = /** @type {HTMLSelectElement} */ (h('select', { id: 'ef-type' },
    h('option', { value: '' }, `As assessed (${/** @type {Record<string, string>} */ (PROPERTY_TYPE_LABELS)[a.listing.propertyType]})`),
    ...PROPERTY_TYPES.map((t) => h('option', { value: t }, /** @type {Record<string, string>} */ (PROPERTY_TYPE_LABELS)[t]))));
  typeSel.value = o.propertyType || '';
  const error = h('p', { class: 'error', role: 'alert', hidden: true });

  const save = () => {
    /** @type {Record<string, any>} */
    const next = {};
    for (const [key] of fields) {
      const v = parseAmount(inputs[key].value);
      if (Number.isNaN(v)) {
        error.textContent = `Check “${fields.find((f) => f[0] === key)?.[1]}”: use a number such as 550000 or 550k.`;
        error.hidden = false;
        inputs[key].focus();
        return;
      }
      if (v !== null) next[key] = v;
    }
    if (typeSel.value) next.propertyType = typeSel.value;
    setOverrides(id, next);
    closeDialog();
    toast(Object.keys(next).length ? 'Your corrections are saved. Costs and rules are updated.' : 'Back to the assessed values.');
  };

  openDialog('Correct the facts', [
    h('p', { class: 'muted' }, 'If the listing or a viewing shows the AI got something wrong, correct it here. Leave a box empty to use the assessed value. Costs, rules and verdicts update straight away.'),
    ...rows,
    h('div', { class: 'field' }, h('label', { class: 'flabel', for: 'ef-type' }, 'Type of home'), typeSel),
    error,
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', onclick: save }, 'Save corrections'),
      h('button', { type: 'button', class: 'btn', onclick: () => { setOverrides(id, {}); closeDialog(); toast('Back to the assessed values.'); } }, 'Reset all')),
  ]);
}

/** Run the AI again on the saved listing, against your current criteria. */
export async function reassess(/** @type {string} */ id) {
  const home = getState().homes[id];
  if (!home) return;
  const text = home.listingText || '';
  const url = home.source.url || '';
  if (!text && !url) {
    toast('There’s no saved listing text or link to assess again.');
    return;
  }
  const profile = getState().profile;
  toast('Assessing again…');
  try {
    const out = await api.assess({
      listing: { url, text },
      criteria: criteriaForAI(profile),
      options: { research: Boolean(profile.ai.research && ui.health?.webResearch) },
    });
    replaceAssessment(id, { assessment: out.assessment, meta: out.meta, listingText: out.listingText });
    toast(`${out.assessment.listing.title} has been assessed again.`);
  } catch (err) {
    toast(err instanceof api.ApiError ? err.message : 'Something went wrong. Try again.');
  }
}

export function confirmDelete(/** @type {string} */ id) {
  const name = nameOf(id);
  openDialog(`Delete ${name}?`, [
    h('p', null, 'This removes the home, its assessment and your notes from this browser. If you only want it out of the way, rule it out instead: it keeps the reason and you can restore it.'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn danger', onclick: () => { removeHome(id); closeDialog(); toast(`${name} deleted.`); go('#/homes'); } }, 'Delete'),
      h('button', { type: 'button', class: 'btn', onclick: () => closeDialog() }, 'Cancel')),
  ]);
}
