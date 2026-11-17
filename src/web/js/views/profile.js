// @ts-check
/** Your inputs. Everything the app needs to know about you, kept in this browser. */
import { h, mount } from '../dom.js';
import { ui, toast, openDialog, closeDialog, go } from '../ui.js';
import { getState, setProfile, exportJson, importJson, clearAll } from '../store.js';
import * as api from '../api.js';
import { normaliseProfile, missingProfileItems, BUILD_AGE_PREFS, BUILD_AGE_PREF_LABELS, EXAMPLE_PROFILE } from '../../../shared/profile.js';
import { PROPERTY_TYPES, PROPERTY_TYPE_LABELS } from '../../../shared/schema.js';
import { TAX_REGIONS, BUYER_STATUSES, RULES_LAST_CHECKED } from '../../../shared/tax-rules.js';
import { cashAvailable, equityFromSale, maxPriceForMonthly, maxPriceForDeposit, purchaseFinance } from '../../../shared/finance.js';
import { money, shortDate, parseAmount } from '../../../shared/format.js';

/** @typedef {import('../../../shared/profile.js').Profile} Profile */

/** A working copy, so half-typed values don't fight the saved profile. */
/** @type {Profile} */
let draft;
/** @type {HTMLElement | null} */
let summaryEl = null;

const BUYER_LABELS = /** @type {Record<string, string>} */ ({
  'first-time': 'First-time buyer (never owned a home)',
  mover: 'Moving home: my current home sells on or before completion',
  'mover-overlap': 'Moving home: I’ll still own my current home at completion',
  additional: 'Buying an additional property (second home or buy-to-let)',
});
const FLAG_LABELS = /** @type {Record<string, string>} */ ({ allow: 'Allow', flag: 'Allow, but flag it', exclude: 'Exclude' });

/** @param {string} path @returns {any} */
const get = (path) => path.split('.').reduce((o, k) => /** @type {any} */ (o)?.[k], draft);
/** @param {string} path @param {any} value */
function set(path, value) {
  const keys = path.split('.');
  /** @type {any} */
  let o = draft;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
}

/** Validate the draft and save it if it's valid. */
function commit() {
  const r = normaliseProfile(draft);
  if (r.ok) setProfile(r.profile);
  refreshSummary();
}

/**
 * @param {string} path
 * @param {string} label
 * @param {{ kind?: 'money' | 'number' | 'text' | 'pct', hint?: string, placeholder?: string, suffix?: string }} [o]
 */
function input(path, label, o = {}) {
  const kind = o.kind || 'number';
  const id = `p-${path.replace(/\./g, '-')}`;
  const el = /** @type {HTMLInputElement} */ (h('input', {
    id,
    inputmode: kind === 'text' ? undefined : kind === 'pct' ? 'decimal' : 'numeric',
    autocomplete: 'off',
    placeholder: o.placeholder,
    value: kind === 'text' ? get(path) : String(get(path) ?? ''),
  }));
  const err = h('p', { class: 'error small', hidden: true });
  el.addEventListener('input', () => {
    if (kind === 'text') {
      set(path, el.value);
      commit();
      return;
    }
    const v = parseAmount(el.value);
    if (v === null || Number.isNaN(v)) {
      err.textContent = v === null ? '' : 'Use a number, such as 350000 or 350k.';
      err.hidden = v === null;
      if (v === null) {
        set(path, 0);
        commit();
      }
      return;
    }
    err.hidden = true;
    set(path, v);
    commit();
  });
  el.addEventListener('change', () => {
    if (kind !== 'text') el.value = String(get(path) ?? '');
  });
  return h('div', { class: 'field' },
    h('label', { class: 'flabel', for: id }, label, o.suffix ? h('span', { class: 'muted' }, ` (${o.suffix})`) : null),
    el, err, o.hint ? h('p', { class: 'hint' }, o.hint) : null);
}

/** @param {string} path @param {string} label @param {(on: boolean) => void} [after] */
function checkbox(path, label, after) {
  const el = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: get(path) }));
  el.addEventListener('change', () => {
    set(path, el.checked);
    commit();
    after?.(el.checked);
  });
  return h('label', { class: 'check' }, el, ` ${label}`);
}

/** @param {string} path @param {string} label @param {[string, string][]} options @param {(v: string) => void} [after] */
function select(path, label, options, after) {
  const id = `p-${path.replace(/\./g, '-')}`;
  const el = /** @type {HTMLSelectElement} */ (h('select', { id }, ...options.map(([v, t]) => h('option', { value: v }, t))));
  el.value = get(path);
  el.addEventListener('change', () => {
    set(path, el.value);
    commit();
    after?.(el.value);
  });
  return h('div', { class: 'field' }, h('label', { class: 'flabel', for: id }, label), el);
}

/** A list edited as one item per line. */
function lines(/** @type {string} */ path, /** @type {string} */ label, /** @type {string} */ placeholder, hint = '') {
  const id = `p-${path.replace(/\./g, '-')}`;
  const el = /** @type {HTMLTextAreaElement} */ (h('textarea', { id, rows: 3, placeholder }));
  el.value = (get(path) || []).join('\n');
  el.addEventListener('input', () => {
    set(path, el.value.split('\n').map((s) => s.trim()).filter(Boolean));
    commit();
  });
  return h('div', { class: 'field' }, h('label', { class: 'flabel', for: id }, label, h('span', { class: 'muted' }, ' (one per line)')), el, hint ? h('p', { class: 'hint' }, hint) : null);
}

/** Editable rows of numbers, such as mortgage rate bands. */
function rowsEditor(/** @type {string} */ path, /** @type {{ key: string, label: string, blankIsNull?: boolean, scale?: number }[]} */ cols, /** @type {Record<string, any>} */ blank) {
  const box = h('div', { class: 'rows' });
  const draw = () => {
    /** @type {Record<string, any>[]} */
    const rows = get(path);
    mount(box,
      ...rows.map((row, i) => h('div', { class: 'rowedit' },
        ...cols.map((c) => {
          const shown = row[c.key] === null ? '' : String(Math.round(row[c.key] * (c.scale || 1) * 1000) / 1000);
          const el = /** @type {HTMLInputElement} */ (h('input', { inputmode: 'decimal', 'aria-label': `${c.label}, row ${i + 1}`, value: shown, placeholder: c.blankIsNull ? 'No limit' : '' }));
          el.addEventListener('input', () => {
            const v = parseAmount(el.value);
            if (Number.isNaN(v)) return;
            row[c.key] = v === null ? (c.blankIsNull ? null : 0) : v / (c.scale || 1);
            commit();
          });
          return h('label', { class: 'mini' }, h('span', null, c.label), el);
        }),
        h('button', { type: 'button', class: 'linkbtn danger', onclick: () => { rows.splice(i, 1); commit(); draw(); } }, 'Remove'))),
      rows.length < 8 ? h('button', { type: 'button', class: 'btn small', onclick: () => { rows.push(structuredClone(blank)); commit(); draw(); } }, 'Add a row') : null);
  };
  draw();
  return box;
}

/** @param {string} title @param {string} intro @param {(Node | null)[]} body */
function section(title, intro, body) {
  return h('section', { class: 'panel form' }, h('h3', null, title), intro ? h('p', { class: 'muted' }, intro) : null, ...body);
}

/** @param {HTMLElement} main */
export function renderProfile(main) {
  draft = structuredClone(getState().profile);

  // Selling: hide the details when not selling
  const saleDetails = h('div', { class: 'grid2' },
    input('sale.expectedPrice', 'Expected sale price', { kind: 'money' }),
    input('sale.mortgageBalance', 'Mortgage left to repay', { kind: 'money', hint: 'Ask your lender for a redemption figure, including any early repayment charge.' }),
    input('sale.agentFeePct', 'Estate agent fee', { kind: 'pct', suffix: '% of the sale price' }),
    input('sale.legalFees', 'Legal fees for the sale', { kind: 'money' }),
    input('sale.otherCosts', 'Other selling costs', { kind: 'money', hint: 'For example an early repayment charge or removals.' }),
    h('div', { class: 'field' }, checkbox('sale.agentFeeVat', 'Add VAT (20%) to the agent fee')));
  saleDetails.hidden = !draft.sale.selling;

  const customBands = h('div', { class: 'field' }, h('p', { class: 'flabel' }, 'Your tax bands'),
    rowsEditor('tax.customBands', [{ key: 'upTo', label: 'Up to', blankIsNull: true }, { key: 'rate', label: 'Rate %', scale: 100 }], { upTo: null, rate: 0 }));
  customBands.hidden = draft.tax.region !== 'custom';
  const nonRes = h('div', { class: 'field' }, checkbox('tax.nonResident', 'I’m not a UK resident (adds 2% in England and Northern Ireland)'));
  nonRes.hidden = draft.tax.region !== 'england-ni';

  const types = h('fieldset', { class: 'field' }, h('legend', { class: 'flabel' }, 'Types of home you’d consider'),
    h('div', { class: 'checks' }, ...PROPERTY_TYPES.filter((t) => !['other', 'unknown'].includes(t)).map((t) => {
      const el = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: draft.search.propertyTypes.includes(t) }));
      el.addEventListener('change', () => {
        const set_ = new Set(draft.search.propertyTypes);
        if (el.checked) set_.add(t);
        else set_.delete(t);
        draft.search.propertyTypes = PROPERTY_TYPES.filter((x) => set_.has(x));
        commit();
      });
      return h('label', { class: 'check' }, el, ` ${/** @type {Record<string, string>} */ (PROPERTY_TYPE_LABELS)[t]}`);
    })));

  const tokenInput = /** @type {HTMLInputElement} */ (h('input', { id: 'p-token', type: 'password', autocomplete: 'off', value: api.getToken() }));
  const health = ui.health;
  const server = section('AI and this server', 'What the server this page came from can do.', [
    health
      ? h('dl', { class: 'lv' },
        h('div', null, h('dt', null, 'AI'), h('dd', null, health.demo ? 'Demo mode: keyword rules, not AI. Set an API key on the server for real assessments.' : `${health.provider}, model ${health.model}`)),
        h('div', null, h('dt', null, 'Web research'), h('dd', null, health.webResearch ? 'Available' : 'Off on this server')),
        h('div', null, h('dt', null, 'Reading links'), h('dd', null, health.listingFetch ? 'Yes, where websites allow it' : 'Off: paste listing text instead')),
        h('div', null, h('dt', null, 'Prompt'), h('dd', null, health.promptVersion)))
      : h('p', { class: 'error' }, ui.healthError || 'Couldn’t reach the server.'),
    health?.webResearch ? checkbox('ai.research', 'Research the area on the web by default (slower; uses web search credits)') : null,
    health?.authRequired ? h('div', { class: 'field' },
      h('label', { class: 'flabel', for: 'p-token' }, 'Access token'),
      tokenInput,
      h('p', { class: 'hint' }, 'This server needs a token before it will run assessments. It’s kept for this browser tab only.'),
      h('button', { type: 'button', class: 'btn small', onclick: () => { api.setToken(tokenInput.value.trim()); toast('Access token saved for this tab.'); } }, 'Save token')) : null,
  ]);

  const fileInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'application/json,.json', hidden: true }));
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const result = importJson(await file.text());
    toast(result.message);
    fileInput.value = '';
    if (result.ok) go('#/dashboard');
  });
  const data = section('Your data', 'Everything is stored in this browser only. Export a copy to back it up or move it to another device.', [
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: download }, 'Export my data'),
      h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, 'Import a file'),
      h('button', { type: 'button', class: 'btn danger', onclick: confirmClear }, 'Delete everything'),
      fileInput),
    h('p', { class: 'fine' }, 'Importing replaces what’s here now. An export includes your profile, homes and notes, so keep it somewhere private.'),
  ]);

  summaryEl = h('aside', { class: 'panel summary', 'aria-live': 'polite' });

  mount(main,
    h('div', { class: 'profile-head' },
      h('h2', null, 'Your profile'),
      h('p', { class: 'muted' }, 'These inputs drive every verdict and every number. Changes save as you type and update all your homes at once.'),
      !getState().profileSaved ? h('button', { type: 'button', class: 'btn ghost small', onclick: () => { setProfile(structuredClone(EXAMPLE_PROFILE)); renderProfile(main); toast('Loaded a fictional example profile. Change anything you like.'); } }, 'Start from an example') : null),
    summaryEl,
    section('Your move', 'Where you’ll travel to, and how often.', [
      input('move.destination', 'Where will you commute to?', { kind: 'text', placeholder: 'e.g. Leeds station, or an office postcode', hint: 'A station or postcode works best for commute estimates.' }),
      h('div', { class: 'grid2' },
        input('move.officeDaysPerWeek', 'Office days a week'),
        input('move.workingWeeksPerYear', 'Working weeks a year'),
        input('move.idealCommuteMin', 'Ideal commute', { suffix: 'minutes, door to door' }),
        input('move.maxCommuteMin', 'Longest commute you’d accept', { suffix: 'minutes' })),
    ]),
    section('Budget', 'Prices are checked against these, and homes above your stretch figure are marked “Don’t buy”.', [
      h('div', { class: 'grid2' },
        input('budget.target', 'Target price', { kind: 'money' }),
        input('budget.max', 'Maximum budget', { kind: 'money' }),
        input('budget.stretch', 'Stretch, only for the right home', { kind: 'money' }),
        input('budget.monthlyCeiling', 'Comfortable monthly mortgage ceiling', { kind: 'money' })),
    ]),
    section('Selling your current home', 'If you’re selling, the money released becomes part of your deposit.', [
      checkbox('sale.selling', 'I’m selling a home to fund this purchase', (on) => { saleDetails.hidden = !on; }),
      saleDetails,
    ]),
    section('Cash and buying costs', '', [
      h('div', { class: 'grid2' },
        input('cash.savings', 'Savings towards the deposit', { kind: 'money' }),
        input('cash.buyingCosts', 'Buying costs', { kind: 'money', hint: 'Legal fees, searches, survey, mortgage fees and moving. Not purchase tax, which is worked out for you.' })),
    ]),
    section('Mortgage', 'Rates usually depend on your loan-to-value (LTV). The rates below are illustrative only: replace them with quotes from your broker.', [
      input('mortgage.termYears', 'Term', { suffix: 'years' }),
      h('div', { class: 'field' }, h('p', { class: 'flabel' }, 'Rates by loan-to-value'),
        rowsEditor('mortgage.rateBands', [{ key: 'maxLtv', label: 'Up to LTV %' }, { key: 'rate', label: 'Rate %' }], { maxLtv: 80, rate: 5.5 })),
    ]),
    section('Purchase tax', `Rates for the UK nations were last checked on ${shortDate(RULES_LAST_CHECKED)}. Always confirm with your conveyancer.`, [
      select('tax.region', 'Where you’re buying', [...Object.entries(TAX_REGIONS).map(([k, r]) => /** @type {[string, string]} */ ([k, `${r.name}: ${r.tax}`])), ['custom', 'Somewhere else: my own bands'], ['none', 'No purchase tax']], (v) => {
        customBands.hidden = v !== 'custom';
        nonRes.hidden = v !== 'england-ni';
      }),
      select('tax.buyerStatus', 'Your situation', BUYER_STATUSES.map((s) => /** @type {[string, string]} */ ([s, BUYER_LABELS[s]]))),
      nonRes,
      customBands,
    ]),
    section('What you’re looking for', 'The AI checks every listing against these, and your hard rules are applied in code on top.', [
      types,
      h('div', { class: 'grid2' },
        input('search.minBedrooms', 'Minimum bedrooms'),
        select('search.buildAge', 'Age and condition', BUILD_AGE_PREFS.map((k) => /** @type {[string, string]} */ ([k, /** @type {Record<string, string>} */ (BUILD_AGE_PREF_LABELS)[k]])))),
      lines('search.mustHaves', 'Must-haves', 'e.g. Room for a garden office'),
      lines('search.niceToHaves', 'Nice-to-haves', 'e.g. Walking distance to a station'),
      h('fieldset', { class: 'field' }, h('legend', { class: 'flabel' }, 'Exclusions'),
        checkbox('search.exclude.sharedOwnership', 'Exclude shared ownership'),
        checkbox('search.exclude.retirement', 'Exclude retirement and age-restricted homes'),
        checkbox('search.exclude.renovation', 'Exclude homes that need renovation')),
      h('div', { class: 'grid2' },
        select('search.exclude.auction', 'Auction sales', Object.entries(FLAG_LABELS)),
        select('search.exclude.leasehold', 'Leasehold homes', Object.entries(FLAG_LABELS))),
      lines('search.areasFocus', 'Areas you’re focusing on', 'e.g. Didsbury'),
      lines('search.areasAvoid', 'Areas you’ve ruled out', ''),
      lines('search.flexOrder', 'If nothing fits, what you’d flex first', 'e.g. A longer commute, up to 70 minutes', 'In order. The AI takes this into account when it weighs trade-offs.'),
      h('div', { class: 'field' },
        h('label', { class: 'flabel', for: 'p-notes' }, 'Anything else the AI should know'),
        (() => {
          const el = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: 'p-notes', rows: 3, maxlength: 1500, placeholder: 'e.g. We work from home two days a week, so a quiet room matters.' }));
          el.value = draft.search.notesForAI;
          el.addEventListener('input', () => { draft.search.notesForAI = el.value; commit(); });
          return el;
        })(),
        h('p', { class: 'hint' }, 'This text is sent to the AI with each listing, so leave out anything private.')),
    ]),
    section('Resale', 'The AI estimates resale for each area. You can use your own assumptions for every home instead.', [
      checkbox('resale.useMine', 'Use my own assumptions for every home'),
      h('div', { class: 'grid2' },
        input('resale.horizonYears', 'How long you might stay', { suffix: 'years' }),
        input('resale.growth5yPct', 'Total growth over five years', { kind: 'pct', suffix: '%' }),
        input('resale.growthAnnualPct', 'Growth each year after that', { kind: 'pct', suffix: '%' }),
        input('resale.newBuildPremiumPct', 'New-build premium lost on day one', { kind: 'pct', suffix: '%' })),
    ]),
    server,
    data);
  refreshSummary();
}

/** Recalculate the summary panel from the saved profile. */
export function refreshSummary() {
  if (!summaryEl || !summaryEl.isConnected) return;
  const p = getState().profile;
  const cur = p.currency;
  const missing = missingProfileItems(p);
  const cash = cashAvailable(p);
  const sale = equityFromSale(p.sale);
  const atCeiling = maxPriceForMonthly(p);
  const ten = maxPriceForDeposit(p, 10);
  const ref = p.budget.target || p.budget.max;
  const f = ref ? purchaseFinance(ref, p) : null;
  mount(summaryEl,
    h('h3', null, 'Your numbers right now'),
    missing.length ? h('p', { class: 'notice' }, `Still needed: ${missing.join(', ').toLowerCase()}.`) : null,
    h('dl', { class: 'glance' },
      h('div', null, h('dt', null, p.sale.selling ? 'Released by your sale' : 'From a sale'), h('dd', null, p.sale.selling ? money(sale.equity, cur) : '—', h('small', null, p.sale.selling ? `after ${money(sale.costs, cur)} of selling costs` : 'not selling'))),
      h('div', null, h('dt', null, 'Cash for the purchase'), h('dd', null, money(cash.total, cur), h('small', null, 'before tax and buying costs'))),
      h('div', null, h('dt', null, 'Highest price at your ceiling'), h('dd', null, atCeiling ? money(atCeiling, cur) : '—', h('small', null, p.budget.monthlyCeiling ? `${money(p.budget.monthlyCeiling, cur)} a month` : 'set a monthly ceiling'))),
      h('div', null, h('dt', null, 'Highest price with 10% deposit'), h('dd', null, ten ? money(ten, cur) : '—', h('small', null, 'after tax and costs')))),
    f ? h('p', { class: 'fine' }, `At ${money(/** @type {number} */ (ref), cur)}: about ${money(f.tax.total, cur)} purchase tax, a ${Math.max(0, f.depositPct).toFixed(1)}% deposit and ${f.monthly !== null ? `about ${money(f.monthly, cur)} a month` : 'no matching mortgage rate'}.`) : null);
}

function download() {
  const blob = new Blob([exportJson()], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = h('a', { href, download: `nestworth-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function confirmClear() {
  openDialog('Delete everything?', [
    h('p', null, 'This deletes your profile, every home and all your notes from this browser. It can’t be undone, so export a copy first if you might want it.'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn danger', onclick: () => { clearAll(); closeDialog(); toast('Everything has been deleted from this browser.'); go('#/dashboard'); } }, 'Delete everything'),
      h('button', { type: 'button', class: 'btn', onclick: () => closeDialog() }, 'Cancel')),
  ]);
}
