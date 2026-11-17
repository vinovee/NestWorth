// @ts-check
/** Browse homes one at a time, with your notes, status and rating beside each. */
import { h, mount, $, icon, fold } from '../dom.js';
import { ui, go, savePrefs, openDialog, closeDialog } from '../ui.js';
import {
  getState, trackOf, setRating, addNote, deleteNote, STATUSES, STATUS_LABELS, RULED_OUT, REASON_LABELS,
} from '../store.js';
import { TABS, SORTS, listHomes, d } from '../derive.js';
import { changeStatus, viewHome } from '../actions.js';
import { renderCard, VCLS } from './card.js';
import { renderChart } from './chart.js';
import { VERDICT_LABELS } from '../../../shared/schema.js';
import { moneyShort, minutesRange, shortDate } from '../../../shared/format.js';
import { openAddHome } from './add-home.js';

/** @typedef {import('../store.js').Home} Home */

const drafts = /** @type {Record<string, string>} */ ({});
const armed = new Set();
let chartOpen = false;
/** Sections you opened stay open when the card redraws (for example after rating it). */
const openFolds = new Set();

/** @param {HTMLElement} root @param {string} homeId */
function keepFolds(root, homeId) {
  root.querySelectorAll('details').forEach((det) => {
    const key = `${homeId}:${det.querySelector('.ft')?.textContent || ''}`;
    if (openFolds.has(key)) det.open = true;
    det.addEventListener('toggle', () => {
      if (det.open) openFolds.add(key);
      else openFolds.delete(key);
    });
  });
}

/** @param {HTMLElement} main */
export function renderHomes(main) {
  const state = getState();
  const all = Object.values(state.homes);
  const pager = $('pager');
  if (!all.length) {
    pager.hidden = true;
    mount(main, h('section', { class: 'panel empty' },
      h('h2', null, 'No homes yet'),
      h('p', null, 'Add a listing by link or by pasting its description, and the AI will assess it against your profile.'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => openAddHome() }, 'Add a home')));
    return;
  }

  const list = listHomes(ui.tab, ui.verdict, ui.sort);
  let idx = list.findIndex((x) => x.id === ui.currentId);
  if (idx < 0 && list.length) {
    idx = 0;
    ui.currentId = list[0].id;
    history.replaceState(null, '', `#/homes/${encodeURIComponent(list[0].id)}`);
  }
  const tab = TABS.find((t) => t.key === ui.tab) || TABS[0];

  // Tabs
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Your lists' }, ...TABS.map((t) => {
    const n = listHomes(t.key, ui.verdict, ui.sort).length;
    return h('button', {
      type: 'button', class: 'tab', aria: { pressed: String(t.key === ui.tab) },
      onclick: () => {
        ui.tab = t.key;
        ui.currentId = null;
        savePrefs();
        go('#/homes');
      },
    }, t.label, h('span', { class: 'ct' }, String(n)));
  }));

  // Sort and verdict filter
  const sortSel = /** @type {HTMLSelectElement} */ (h('select', { id: 'sortSel', 'aria-label': 'Sort homes by', onchange: (/** @type {Event} */ e) => {
    ui.sort = /** @type {HTMLSelectElement} */ (e.target).value;
    ui.currentId = null;
    savePrefs();
    go('#/homes');
  } }, ...Object.entries(SORTS).map(([k, v]) => h('option', { value: k }, v.label))));
  sortSel.value = ui.sort in SORTS ? ui.sort : 'fit';
  const verdictSel = /** @type {HTMLSelectElement} */ (h('select', { id: 'verdictSel', 'aria-label': 'Show homes with this verdict', onchange: (/** @type {Event} */ e) => {
    ui.verdict = /** @type {HTMLSelectElement} */ (e.target).value;
    savePrefs();
    go('#/homes');
  } }, h('option', { value: 'all' }, 'All verdicts'), ...Object.entries(VERDICT_LABELS).map(([k, v]) => h('option', { value: k }, v))));
  verdictSel.value = ui.verdict;
  const controls = h('div', { class: 'tools' },
    h('label', { class: 'pick' }, h('span', { class: 'pk' }, 'Sort'), sortSel),
    h('label', { class: 'pick' }, h('span', { class: 'pk' }, 'Verdict'), verdictSel),
    h('button', { type: 'button', class: 'btn ghost', onclick: openAllHomes }, 'All homes'));

  // Chart, kept open or closed as you left it
  const chart = fold('Price against commute', '', [renderChart(list, ui.currentId, state.profile, (id) => {
    ui.currentId = id;
    go(`#/homes/${encodeURIComponent(id)}`);
    requestAnimationFrame(() => document.getElementById('card')?.scrollIntoView({ block: 'start' }));
  })], chartOpen, 'panel graph');
  chart.addEventListener('toggle', () => {
    chartOpen = /** @type {HTMLDetailsElement} */ (chart).open;
  });

  if (!list.length) {
    pager.hidden = true;
    const hiddenByFilter = ui.verdict !== 'all' && listHomes(ui.tab, 'all', ui.sort).length > 0;
    mount(main, tabs, controls, h('section', { class: 'panel empty' },
      h('h2', null, hiddenByFilter ? `No “${/** @type {Record<string, string>} */ (VERDICT_LABELS)[ui.verdict]}” homes here` : `Nothing in ${tab.label}`),
      h('p', null, hiddenByFilter ? 'The verdict filter is hiding the other homes in this list.' : 'Homes move between lists as you change their status.'),
      hiddenByFilter
        ? h('button', { type: 'button', class: 'btn', onclick: () => { ui.verdict = 'all'; savePrefs(); go('#/homes'); } }, 'Show every verdict')
        : h('button', { type: 'button', class: 'btn', onclick: () => { ui.tab = 'active'; savePrefs(); go('#/homes'); } }, 'Back to Active')));
    return;
  }

  const home = list[idx];
  const where = ui.tab === 'active' ? 'active' : ui.tab === 'archived' ? 'archived' : `in ${tab.label}`;
  const card = renderCard(home, { index: idx, count: list.length, where, sortPhrase: (SORTS[ui.sort] || SORTS.fit).phrase });
  keepFolds(card, home.id);
  addSwipe(card, list, idx);
  mount(main, tabs, controls, chart, card, renderNotes(home));
  if (ui.scrollToCard) {
    ui.scrollToCard = false;
    requestAnimationFrame(() => card.scrollIntoView({ block: 'start' }));
  }

  // Pager
  pager.hidden = false;
  mount(pager, h('div', { class: 'wrap pager-in' },
    h('button', { type: 'button', class: 'pbtn', disabled: idx <= 0, onclick: () => step(list, idx, -1) }, icon('left'), 'Previous'),
    h('span', { class: 'pos' }, h('b', null, String(idx + 1)), ` of ${list.length}`),
    h('button', { type: 'button', class: 'pbtn next', disabled: idx >= list.length - 1, onclick: () => step(list, idx, 1) }, 'Next', icon('right'))));
}

/** @param {Home[]} list @param {number} idx @param {number} delta */
function step(list, idx, delta) {
  const next = list[idx + delta];
  if (!next) return;
  saveDraft();
  ui.currentId = next.id;
  go(`#/homes/${encodeURIComponent(next.id)}`);
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/** Keyboard: left and right arrows move between homes. */
export function homesKeydown(/** @type {KeyboardEvent} */ e) {
  if (ui.route !== 'homes' || /** @type {HTMLDialogElement} */ ($('dialog')).open) return;
  const tag = /** @type {HTMLElement} */ (document.activeElement)?.tagName || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const list = listHomes(ui.tab, ui.verdict, ui.sort);
  const idx = list.findIndex((x) => x.id === ui.currentId);
  if (idx >= 0) step(list, idx, e.key === 'ArrowRight' ? 1 : -1);
}

/** @param {HTMLElement} card @param {Home[]} list @param {number} idx */
function addSwipe(card, list, idx) {
  /** @type {number | null} */
  let sx = null;
  let sy = 0;
  card.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
      sx = null;
      return;
    }
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  card.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) step(list, idx, dx < 0 ? 1 : -1);
  }, { passive: true });
}

function saveDraft() {
  const ta = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('noteText'));
  if (ta && ui.currentId) drafts[ui.currentId] = ta.value;
}

/** Status, your rating and your notes for one home. */
function renderNotes(/** @type {Home} */ home) {
  const id = home.id;
  const t = trackOf(id);
  const status = /** @type {HTMLSelectElement} */ (h('select', { id: 'status', onchange: (/** @type {Event} */ e) => {
    const v = /** @type {HTMLSelectElement} */ (e.target).value;
    /** @type {HTMLSelectElement} */ (e.target).value = trackOf(id).status;
    changeStatus(id, v);
  } }, ...STATUSES.map((st) => h('option', { value: st }, STATUS_LABELS[st]))));
  status.value = t.status;

  const rate = h('div', { class: 'rate', role: 'radiogroup', 'aria-labelledby': 'rateLabel' }, ...Array.from({ length: 10 }, (_, i) => {
    const v = i + 1;
    return h('button', { type: 'button', role: 'radio', aria: { checked: String(t.myRating === v), label: `${v} out of 10` }, onclick: () => setRating(id, v) }, String(v));
  }));

  const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', { id: 'noteText', rows: 3, placeholder: 'What stood out on the viewing, questions for the agent, things to check…', oninput: (/** @type {Event} */ e) => { drafts[id] = /** @type {HTMLTextAreaElement} */ (e.target).value; } }));
  ta.value = drafts[id] || '';
  const save = () => {
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    drafts[id] = '';
    addNote(id, text);
  };

  const notes = [...t.notes].sort((a, b) => b.at.localeCompare(a.at));
  return h('section', { class: 'panel notes', 'aria-labelledby': 'notesTitle' },
    h('h3', { id: 'notesTitle' }, notes.length ? `Your notes (${notes.length})` : 'Your notes'),
    h('div', { class: 'field' },
      h('label', { class: 'flabel', for: 'status' }, 'Status'),
      status,
      h('p', { class: 'hint' }, 'When you rule a home out, you’ll be asked why. It moves to Archived, and you can restore it from there.')),
    h('div', { class: 'field' },
      h('div', { class: 'rate-head' },
        h('span', { class: 'flabel', id: 'rateLabel' }, 'Your rating out of 10'),
        t.myRating !== null ? h('button', { type: 'button', class: 'linkbtn', onclick: () => setRating(id, null) }, 'Clear') : null),
      rate),
    h('div', { class: 'field' },
      h('label', { class: 'flabel', for: 'noteText' }, 'Add a note'),
      ta,
      h('button', { type: 'button', class: 'btn primary block', onclick: save }, 'Save note')),
    notes.length
      ? h('ul', { class: 'notelist' }, ...notes.map((n) => h('li', null,
        h('p', { class: 'nt' }, n.text),
        h('div', { class: 'meta' },
          h('span', null, shortDate(n.at)),
          h('button', { type: 'button', class: 'del', onclick: (/** @type {Event} */ e) => {
            const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
            if (!armed.has(n.id)) {
              armed.add(n.id);
              btn.textContent = 'Tap again to delete';
              window.setTimeout(() => {
                armed.delete(n.id);
                if (btn.isConnected) btn.textContent = 'Delete';
              }, 3000);
              return;
            }
            armed.delete(n.id);
            deleteNote(id, n.id);
          } }, 'Delete')))))
      : h('p', { class: 'muted' }, 'No notes yet for this home.'),
    h('p', { class: 'fine' }, 'Notes are saved in this browser only.'));
}

/** Every home, grouped by status, in a sheet. */
export function openAllHomes() {
  const groups = /** @type {[string, string][]} */ ([
    ['For review', 'For review'], ['Offer made', 'Offer made'], ['Viewed', 'Viewed'], ['Viewing booked', 'Viewing booked'],
    ['Enquired', 'Enquired'], ['Shortlisted', 'Shortlisted'], ['', 'Not decided'], [RULED_OUT, 'Archived (ruled out)'],
  ]);
  const homes = Object.values(getState().homes).sort((SORTS[ui.sort] || SORTS.fit).fn);
  const cur = getState().profile.currency;
  const blocks = groups.map(([st, label]) => {
    const items = homes.filter((x) => trackOf(x.id).status === st);
    if (!items.length) return null;
    return h('div', null,
      h('h3', { class: 'grp' }, `${label} · ${items.length}`),
      ...items.map((x) => {
        const v = d(x);
        const t = trackOf(x.id);
        const extra = [t.myRating !== null ? `you: ${t.myRating}/10` : '', st === RULED_OUT && t.reasons[0] ? (REASON_LABELS[t.reasons[0]] || '').toLowerCase() : ''].filter(Boolean);
        return h('button', { type: 'button', class: ['ri', x.id === ui.currentId && 'current', st === RULED_OUT && 'gone'], onclick: () => { closeDialog(); viewHome(x.id); } },
          h('span', null,
            h('span', { class: 'nm' }, x.assessment.listing.title),
            h('span', { class: 'sb' }, [x.assessment.listing.address, v.facts.price !== null ? moneyShort(v.facts.price, cur) : 'no price', minutesRange(v.facts.minutesMin, v.facts.minutesMax), ...extra].join(' · '))),
          h('span', { class: `sc v-${VCLS[v.verdict]}` }, h('i', { 'aria-hidden': 'true' }), String(x.assessment.ratings.overall)));
      }));
  });
  openDialog('All homes', blocks.filter(Boolean));
}
