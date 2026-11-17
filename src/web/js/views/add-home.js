// @ts-check
/** Adding a home: by link, by pasting the listing, or by hand. */
import { h, mount, $ } from '../dom.js';
import { ui, go, toast, openDialog, closeDialog } from '../ui.js';
import { getState, addHome, setProfile } from '../store.js';
import { viewHome } from '../actions.js';
import * as api from '../api.js';
import { criteriaForAI, missingProfileItems, EXAMPLE_PROFILE } from '../../../shared/profile.js';
import { manualAssessment } from '../../../shared/manual.js';
import { validateAssessment, PROPERTY_TYPES, PROPERTY_TYPE_LABELS } from '../../../shared/schema.js';
import { DEMO_LISTINGS } from '../demo-listings.js';
import { parseAmount } from '../../../shared/format.js';

const FETCH_PROBLEMS = new Set(['ROBOTS_DISALLOWED', 'FETCH_REFUSED', 'FETCH_FAILED', 'FETCH_TIMEOUT', 'UNSUPPORTED_CONTENT', 'PAGE_TOO_LARGE', 'LISTING_GONE', 'FETCH_DISABLED', 'TOO_MANY_REDIRECTS', 'URL_NOT_FOUND']);

/** @param {{ mode?: 'link' | 'paste' | 'manual', url?: string, text?: string }} [prefill] */
export function openAddHome(prefill = {}) {
  let mode = prefill.mode || (prefill.text ? 'paste' : 'link');
  const health = ui.health;
  const profile = getState().profile;
  const missing = missingProfileItems(profile);
  /** @type {AbortController | null} */
  let running = null;

  const url = /** @type {HTMLInputElement} */ (h('input', { id: 'ahUrl', type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'https://…', value: prefill.url || '' }));
  const pasteUrl = /** @type {HTMLInputElement} */ (h('input', { id: 'ahPasteUrl', type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'https://… (optional)', value: prefill.url || '' }));
  const text = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: 'ahText', rows: 10, placeholder: 'Copy everything from the listing page: price, description, key features, floor plan details…' }));
  text.value = prefill.text || '';
  const research = /** @type {HTMLInputElement} */ (h('input', { id: 'ahResearch', type: 'checkbox', checked: profile.ai.research }));

  /** @type {Record<string, HTMLInputElement | HTMLSelectElement>} */
  const man = {
    title: /** @type {HTMLInputElement} */ (h('input', { id: 'mTitle', placeholder: 'e.g. 3-bed semi, Oak Lane' })),
    address: /** @type {HTMLInputElement} */ (h('input', { id: 'mAddress', placeholder: 'Street, town and postcode' })),
    url: /** @type {HTMLInputElement} */ (h('input', { id: 'mUrl', type: 'url', placeholder: 'https://… (optional)' })),
    price: /** @type {HTMLInputElement} */ (h('input', { id: 'mPrice', inputmode: 'numeric', placeholder: 'e.g. 350000 or 350k' })),
    bedrooms: /** @type {HTMLInputElement} */ (h('input', { id: 'mBeds', inputmode: 'numeric' })),
    minutes: /** @type {HTMLInputElement} */ (h('input', { id: 'mMins', inputmode: 'numeric', placeholder: 'Door to door, e.g. 45' })),
    fare: /** @type {HTMLInputElement} */ (h('input', { id: 'mFare', inputmode: 'decimal', placeholder: 'Return fare per office day' })),
    type: /** @type {HTMLSelectElement} */ (h('select', { id: 'mType' }, ...PROPERTY_TYPES.map((t) => h('option', { value: t }, /** @type {Record<string, string>} */ (PROPERTY_TYPE_LABELS)[t])))),
  };
  man.type.value = 'unknown';
  const manNotes = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: 'mNotes', rows: 3, placeholder: 'Anything you know about it' }));

  const field = (/** @type {string} */ id, /** @type {string} */ label, /** @type {Node} */ input, /** @type {string} */ hint = '') =>
    h('div', { class: 'field' }, h('label', { class: 'flabel', for: id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null);

  const panels = {
    link: h('div', null,
      field('ahUrl', 'Link to the listing', url, health && !health.listingFetch
        ? 'This server doesn’t read links. Paste the listing text instead.'
        : 'Many property sites don’t allow automated reading. If this one doesn’t, you’ll be asked to paste the text instead.')),
    paste: h('div', null,
      field('ahText', 'The listing text', text, 'Only the listing is sent to the AI, with your search criteria. Your finances stay in this browser.'),
      field('ahPasteUrl', 'Link to the listing (optional, for your reference)', pasteUrl)),
    manual: h('div', { class: 'grid2' },
      field('mTitle', 'Name', man.title), field('mAddress', 'Address', man.address), field('mUrl', 'Link', man.url),
      field('mPrice', 'Price', man.price), field('mType', 'Type of home', man.type), field('mBeds', 'Bedrooms', man.bedrooms),
      field('mMins', 'Commute (minutes)', man.minutes), field('mFare', 'Fares per office day', man.fare), field('mNotes', 'Notes', manNotes)),
  };

  const tabBtns = /** @type {Record<string, HTMLElement>} */ ({});
  const tabs = h('div', { class: 'seg small', role: 'group', 'aria-label': 'How to add the home' },
    ...(/** @type {[string, string][]} */ ([['link', 'Link'], ['paste', 'Paste text'], ['manual', 'By hand']])).map(([k, label]) => {
      tabBtns[k] = h('button', { type: 'button', class: 'segb', aria: { pressed: String(mode === k) }, onclick: () => setMode(/** @type {any} */ (k)) }, label);
      return tabBtns[k];
    }));
  const body = h('div', { class: 'ahbody' });
  const status = h('div', { class: 'ahstatus', role: 'status', 'aria-live': 'polite' });
  const submit = h('button', { type: 'button', class: 'btn primary block', onclick: () => run() }, 'Assess with AI');
  const researchRow = health?.webResearch ? h('label', { class: 'check' }, research, ' Also research the area on the web (slower, and uses web search credits)') : null;

  /** @param {'link' | 'paste' | 'manual'} next */
  function setMode(next) {
    mode = next;
    for (const [k, b] of Object.entries(tabBtns)) b.setAttribute('aria-pressed', String(k === mode));
    mount(body, panels[mode]);
    submit.textContent = mode === 'manual' ? 'Add home' : health?.demo ? 'Assess (demo mode)' : 'Assess with AI';
    if (researchRow) /** @type {HTMLElement} */ (researchRow).hidden = mode === 'manual';
    mount(status);
  }

  /** @param {string} message @param {Node[]} [extra] */
  function showError(message, extra = []) {
    mount(status, h('p', { class: 'error' }, message), ...extra);
  }

  async function run() {
    if (running) return;
    if (mode === 'manual') return addManual();
    const listing = mode === 'link' ? { url: url.value.trim(), text: '' } : { url: pasteUrl.value.trim(), text: text.value.trim() };
    if (mode === 'link' && !listing.url) return showError('Add the link to the listing.');
    if (mode === 'paste' && listing.text.length < 80) return showError('Paste the full listing text, including the price and the description.');
    const useResearch = Boolean(health?.webResearch && research.checked);
    running = new AbortController();
    submit.setAttribute('disabled', '');
    const steps = [mode === 'link' ? 'Reading the listing…' : 'Sending the listing…', ...(useResearch ? ['Researching the area…'] : []), 'Assessing it against your criteria…', 'Checking the answer…'];
    let i = 0;
    const cancel = h('button', { type: 'button', class: 'linkbtn', onclick: () => running?.abort() }, 'Cancel');
    const tick = () => mount(status, h('p', { class: 'progress' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), steps[Math.min(i, steps.length - 1)]), cancel);
    tick();
    const timer = window.setInterval(() => { i++; tick(); }, useResearch ? 9000 : 5000);
    try {
      const out = await api.assess({ listing, criteria: criteriaForAI(getState().profile), options: { research: useResearch } }, running.signal);
      const id = addHome({ assessment: out.assessment, meta: out.meta, listingText: out.listingText || listing.text, source: { type: out.meta.source.type, url: out.meta.source.url || listing.url } });
      closeDialog();
      toast(`Added ${out.assessment.listing.title} for review.`);
      viewHome(id);
    } catch (err) {
      const e = err instanceof api.ApiError ? err : new api.ApiError('UNKNOWN', 'Something went wrong. Try again.');
      if (e.code === 'CANCELLED') mount(status, h('p', { class: 'muted' }, 'Cancelled.'));
      else if (FETCH_PROBLEMS.has(e.code)) {
        showError(e.message, [h('button', { type: 'button', class: 'btn', onclick: () => { pasteUrl.value = url.value; setMode('paste'); text.focus(); } }, 'Paste the text instead')]);
      } else if (e.code === 'UNAUTHORISED') {
        showError(e.message, [h('button', { type: 'button', class: 'btn', onclick: () => { closeDialog(); go('#/profile'); } }, 'Enter the access token')]);
      } else showError(e.message);
    } finally {
      window.clearInterval(timer);
      running = null;
      submit.removeAttribute('disabled');
    }
  }

  function addManual() {
    const price = parseAmount(/** @type {HTMLInputElement} */ (man.price).value);
    const beds = parseAmount(/** @type {HTMLInputElement} */ (man.bedrooms).value);
    const mins = parseAmount(/** @type {HTMLInputElement} */ (man.minutes).value);
    const fare = parseAmount(/** @type {HTMLInputElement} */ (man.fare).value);
    for (const [v, name] of /** @type {[number | null, string][]} */ ([[price, 'price'], [beds, 'bedrooms'], [mins, 'commute'], [fare, 'fares']])) {
      if (Number.isNaN(v)) return showError(`Check the ${name}: use a number such as 350000 or 350k.`);
    }
    const title = man.title.value.trim();
    const address = man.address.value.trim();
    if (!title && !address) return showError('Give the home a name or an address.');
    let link = man.url.value.trim();
    try {
      if (link && !/^https?:$/.test(new URL(link).protocol)) link = '';
    } catch {
      link = '';
    }
    const assessment = manualAssessment({
      title, address, url: link, price, priceMax: null, propertyType: man.type.value, bedrooms: beds === null ? null : Math.round(beds),
      minutesMin: mins === null ? null : Math.round(mins), minutesMax: mins === null ? null : Math.round(mins), farePerDay: fare,
      notes: manNotes.value.trim(), destination: getState().profile.move.destination,
    });
    const checked = validateAssessment(assessment);
    if (!checked.ok) return showError('Some details aren’t valid. Check the numbers and try again.');
    const id = addHome({ assessment: checked.value, meta: { provider: 'manual', model: '', assessedAt: new Date().toISOString(), warnings: [] }, listingText: '', source: { type: 'manual', url: link } });
    closeDialog();
    toast(`Added ${checked.value.listing.title}.`);
    viewHome(id);
  }

  const notice = missing.length
    ? h('div', { class: 'notice' },
      h('p', null, `Your profile is missing: ${missing.join(', ').toLowerCase()}. The AI can still assess the listing, but it can’t judge it against those.`),
      h('button', { type: 'button', class: 'linkbtn', onclick: () => { closeDialog(); go('#/profile'); } }, 'Fill in my profile'))
    : null;
  const footer = h('p', { class: 'fine' }, health
    ? (health.demo
      ? 'Demo mode: assessments come from simple keyword rules, not AI.'
      : `NestWorth uses AI (${health.model}) to assess listings. The listing, with phone numbers and email addresses removed, and your search criteria are sent to ${health.provider}; your finances aren’t. AI can make mistakes, and you can correct any fact afterwards.`)
    : (ui.healthError || 'Checking the server…'));

  openDialog('Add a home', [notice, tabs, body, researchRow, status, submit, footer], {
    onClose: () => running?.abort(),
  });
  setMode(mode);
}

/** Load the fictional example buyer and assess the example listings. */
export async function loadDemo() {
  const state = getState();
  const demo = ui.health?.demo;
  const useExampleProfile = !state.profileSaved;
  if (!demo) {
    const ok = window.confirm(`This assesses ${DEMO_LISTINGS.length} fictional example listings with ${ui.health?.model || 'your AI provider'}, which uses a little AI credit. Continue?`);
    if (!ok) return;
  }
  if (useExampleProfile) setProfile(structuredClone(EXAMPLE_PROFILE));
  let added = 0;
  for (const [i, item] of DEMO_LISTINGS.entries()) {
    toast(`Assessing example ${i + 1} of ${DEMO_LISTINGS.length}…`);
    try {
      const out = await api.assess({ listing: { url: '', text: item.text }, criteria: criteriaForAI(getState().profile), options: { research: false } });
      addHome({ assessment: out.assessment, meta: out.meta, listingText: item.text, source: { type: 'demo', url: '' } });
      added++;
    } catch (err) {
      toast(err instanceof api.ApiError ? err.message : 'The example couldn’t be assessed.');
      break;
    }
  }
  if (added) {
    toast(`Added ${added} example home${added === 1 ? '' : 's'}${useExampleProfile ? ' and an example profile' : ''}. Replace them with your own whenever you like.`);
    go('#/dashboard');
  }
}

/** Keep the header button wired. */
export function wireAddButton() {
  $('addHomeBtn').addEventListener('click', () => openAddHome());
}
