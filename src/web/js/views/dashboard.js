// @ts-check
/** The overview: where the search stands, what needs a decision, and why homes were dropped. */
import { h, mount } from '../dom.js';
import { ui, go, savePrefs } from '../ui.js';
import { getState, trackOf, RULED_OUT, REVIEW, REASONS, REASON_LABELS } from '../store.js';
import { d, bestHome } from '../derive.js';
import { changeStatus, viewHome, openReasonDialog } from '../actions.js';
import { pill, VCLS } from './card.js';
import { openAddHome, loadDemo } from './add-home.js';
import { money, moneyShort, minutesRange } from '../../../shared/format.js';
import { VERDICT_LABELS } from '../../../shared/schema.js';
import { cashAvailable, maxPriceForMonthly, maxPriceForDeposit, sensitivities } from '../../../shared/finance.js';
import { missingProfileItems } from '../../../shared/profile.js';

const STAGE_RANK = /** @type {Record<string, number>} */ ({ 'Offer made': 0, Viewed: 1, 'Viewing booked': 2, Enquired: 3, Shortlisted: 4, [REVIEW]: 5, '': 6 });
let showAllReasons = false;

/** @param {HTMLElement} main */
export function renderDashboard(main) {
  const state = getState();
  const homes = Object.values(state.homes);
  if (!homes.length) {
    mount(main, welcome(), state.profileSaved ? limitsPanel() : null);
    return;
  }
  mount(main, glancePanel(), bestPanel(), queuePanel(), activePanel(), limitsPanel(), reasonsPanel());
}

function welcome() {
  const state = getState();
  const missing = missingProfileItems(state.profile);
  const provider = ui.health ? (ui.health.demo ? 'demo mode (keyword rules, no AI)' : `${ui.health.provider}, ${ui.health.model}`) : 'the AI provider set up on the server';
  return h('section', { class: 'panel welcome' },
    h('h2', null, 'A private, AI-assisted home search'),
    h('p', null, 'You set the criteria and the numbers. The AI reads each listing and gives a frank assessment. The app does the maths and applies your rules, so a verdict never ignores your budget or your must-haves.'),
    h('ol', { class: 'steps' },
      h('li', null, h('b', null, 'Fill in your profile: '), 'where you’ll commute to, your budget and what you need.'),
      h('li', null, h('b', null, 'Add homes '), 'by link or by pasting the listing text.'),
      h('li', null, h('b', null, 'Decide: '), 'shortlist, view, and rule out with a reason, so you can see what keeps putting you off.')),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => go('#/profile') }, missing.length && !state.profileSaved ? 'Set up my profile' : 'Review my profile'),
      state.profileSaved ? h('button', { type: 'button', class: 'btn', onclick: () => openAddHome() }, 'Add a home') : null,
      h('button', { type: 'button', class: 'btn ghost', onclick: () => loadDemo() }, 'Try it with example data')),
    h('p', { class: 'fine' }, `Your profile, homes and notes stay in this browser. When you assess a listing, its text and your search criteria (not your sale price, mortgage or savings) go to ${provider}.`));
}

function glancePanel() {
  const state = getState();
  const p = state.profile;
  const homes = Object.values(state.homes);
  const st = (/** @type {import('../store.js').Home} */ x) => trackOf(x.id).status;
  const count = (/** @type {string} */ s) => homes.filter((x) => st(x) === s).length;
  const tiles = /** @type {[string, string, string][]} */ ([
    ['review', REVIEW, 'For review'], ['shortlisted', 'Shortlisted', 'Shortlisted'], ['enquired', 'Enquired', 'Enquired'],
    ['booked', 'Viewing booked', 'Viewings booked'], ['viewed', 'Viewed', 'Viewed'], ['offered', 'Offer made', 'Offers made'], ['archived', RULED_OUT, 'Ruled out'],
  ]);
  const active = homes.filter((x) => st(x) !== RULED_OUT);
  const priced = active.filter((x) => d(x).facts.price !== null);
  const inBudget = p.budget.max ? priced.filter((x) => /** @type {number} */ (d(x).facts.price) <= p.budget.max) : [];
  const atTarget = p.budget.target ? priced.filter((x) => /** @type {number} */ (d(x).facts.price) <= p.budget.target) : [];
  const underCeil = active.filter((x) => { const f = d(x).fin; return f && f.monthly !== null && (!p.budget.monthlyCeiling || f.monthly <= p.budget.monthlyCeiling); });
  const inIdeal = active.filter((x) => { const c = d(x).commuteAvg; return c !== null && c <= p.move.idealCommuteMin; });
  const glance = (/** @type {string} */ dt, /** @type {string} */ dd, /** @type {string} */ small) => h('div', null, h('dt', null, dt), h('dd', null, dd, h('small', null, small)));
  return h('section', { class: 'panel', 'aria-labelledby': 'gTitle' },
    h('h3', { id: 'gTitle' }, 'Your search at a glance'),
    h('div', { class: 'kpis', role: 'group', 'aria-label': 'Homes by status' }, ...tiles.map(([tab, s, label]) => {
      const n = count(s);
      return h('button', { type: 'button', class: ['kpi', tab === 'review' && n > 0 && 'hot', tab === 'archived' && 'wide'], onclick: () => { ui.tab = tab; ui.currentId = null; savePrefs(); go('#/homes'); } },
        h('b', null, String(n)), h('span', null, label));
    })),
    h('dl', { class: 'glance' },
      glance('Active homes', String(active.length), `${active.filter((x) => st(x) === '').length} not decided yet`),
      glance(p.budget.max ? `Within your ${moneyShort(p.budget.max, p.currency)} budget` : 'Within budget', p.budget.max ? String(inBudget.length) : '—', p.budget.target ? `${atTarget.length} at or under your target` : 'Set a budget in your profile'),
      glance(p.budget.monthlyCeiling ? `Mortgage ${money(p.budget.monthlyCeiling, p.currency)} or less` : 'Mortgage estimated', String(underCeil.length), 'a month, estimated'),
      glance(`About ${p.move.idealCommuteMin} min or less`, String(inIdeal.length), 'door to door, typical')));
}

function bestPanel() {
  const best = bestHome();
  if (!best) return null;
  const x = d(best);
  const cur = getState().profile.currency;
  const L = best.assessment.listing;
  return h('section', { class: 'best', 'aria-label': 'Best home overall' },
    h('p', { class: 'bk' }, '★ Best overall right now'),
    h('h2', null, L.title),
    h('p', { class: 'bm' }, [L.address, x.facts.price !== null ? money(x.facts.price, cur) : '', minutesRange(x.facts.minutesMin, x.facts.minutesMax)].filter(Boolean).join(' · ')),
    h('p', { class: 'bw' }, best.assessment.verdictReason),
    h('button', { type: 'button', class: 'btn on-accent', onclick: () => viewHome(best.id) }, 'View this home'));
}

function queuePanel() {
  const homes = Object.values(getState().homes).filter((x) => trackOf(x.id).status === REVIEW)
    .sort((a, b) => b.assessment.ratings.overall - a.assessment.ratings.overall);
  const cur = getState().profile.currency;
  return h('section', { class: 'panel', 'aria-labelledby': 'qTitle' },
    h('div', { class: 'phead' }, h('h3', { id: 'qTitle' }, 'New for your review'), homes.length ? h('span', { class: 'fine' }, `${homes.length} waiting`) : null),
    homes.length
      ? h('ul', { class: 'queue' }, ...homes.map((x) => {
        const v = d(x);
        return h('li', { class: `qi v-${VCLS[v.verdict]}` },
          h('h4', { class: 'qn' }, h('button', { type: 'button', class: 'qopen', onclick: () => viewHome(x.id) }, x.assessment.listing.title)),
          h('p', { class: 'qm' }, x.assessment.listing.address),
          h('p', { class: 'qp' }, v.facts.price !== null ? money(v.facts.price, cur) : 'No price'),
          h('p', { class: 'qp' }, v.fin && v.fin.monthly !== null ? `About ${money(v.fin.monthly, cur)} a month` : 'Monthly cost unknown'),
          h('p', { class: 'qp' }, `${minutesRange(v.facts.minutesMin, v.facts.minutesMax)} door to door`),
          pill(v.verdict),
          h('div', { class: 'qact' },
            h('button', { type: 'button', class: 'btn small', onclick: () => changeStatus(x.id, 'Shortlisted') }, 'Shortlist'),
            h('button', { type: 'button', class: 'btn small', onclick: () => openReasonDialog(x.id, 'ruleout') }, 'Rule out…')));
      }))
      : h('p', { class: 'muted' }, 'Nothing waiting. New homes you add land here first.'),
    h('button', { type: 'button', class: 'btn ghost', onclick: () => openAddHome() }, 'Add a home'));
}

function activePanel() {
  const p = getState().profile;
  const cur = p.currency;
  const rows = Object.values(getState().homes).filter((x) => trackOf(x.id).status !== RULED_OUT)
    .sort((a, b) => (STAGE_RANK[trackOf(a.id).status] ?? 9) - (STAGE_RANK[trackOf(b.id).status] ?? 9) || b.assessment.ratings.overall - a.assessment.ratings.overall);
  if (!rows.length) return null;
  return h('section', { class: 'panel', 'aria-labelledby': 'aTitle' },
    h('div', { class: 'phead' }, h('h3', { id: 'aTitle' }, 'Active homes'),
      h('button', { type: 'button', class: 'linkbtn', onclick: () => { ui.tab = 'active'; savePrefs(); go('#/homes'); } }, 'Browse them one by one')),
    h('p', { class: 'fine' }, `Furthest along first. Est. monthly uses your profile${p.budget.monthlyCeiling ? `; red means over your ${money(p.budget.monthlyCeiling, cur)} ceiling` : ''}.`),
    h('div', { class: 'tblwrap' }, h('table', { class: 'dtbl' },
      h('thead', null, h('tr', null, ...['Home', 'Status', 'Price', 'Est. monthly', 'Commute', 'Fit', 'You'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, ...rows.map((x) => {
        const v = d(x);
        const t = trackOf(x.id);
        const over = v.fin && v.fin.overCeiling !== null && v.fin.overCeiling > 0;
        return h('tr', null,
          h('th', { scope: 'row' }, h('button', { type: 'button', class: 'linkbtn', onclick: () => viewHome(x.id) }, x.assessment.listing.title), h('small', null, x.assessment.listing.address)),
          h('td', null, h('span', { class: `vdot v-${VCLS[v.verdict]}`, 'aria-hidden': 'true' }), t.status || 'Not decided', h('small', null, /** @type {Record<string, string>} */ (VERDICT_LABELS)[v.verdict])),
          h('td', null, v.facts.price !== null ? moneyShort(v.facts.price, cur) : '—'),
          h('td', { class: over ? 'over' : '' }, v.fin && v.fin.monthly !== null ? money(v.fin.monthly, cur) : '—'),
          h('td', null, minutesRange(v.facts.minutesMin, v.facts.minutesMax)),
          h('td', null, String(x.assessment.ratings.overall)),
          h('td', null, t.myRating !== null ? `${t.myRating}/10` : '–'));
      })))));
}

function limitsPanel() {
  const p = getState().profile;
  const cur = p.currency;
  const missing = missingProfileItems(p);
  if (missing.length && !p.budget.max) return null;
  const cash = cashAvailable(p);
  const atCeiling = maxPriceForMonthly(p);
  const tenPct = maxPriceForDeposit(p, 10);
  const ref = p.budget.target || p.budget.max;
  const sens = ref ? sensitivities(p, ref) : null;
  const signed = (/** @type {number | null} */ n) => (n === null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n), cur)} a month`);
  return h('section', { class: 'panel', 'aria-labelledby': 'lTitle' },
    h('div', { class: 'phead' }, h('h3', { id: 'lTitle' }, 'Your price limits'), h('button', { type: 'button', class: 'linkbtn', onclick: () => go('#/profile') }, 'Edit your numbers')),
    h('dl', { class: 'glance' },
      h('div', null, h('dt', null, 'Cash for the purchase'), h('dd', null, money(cash.total, cur), h('small', null, p.sale.selling ? 'sale proceeds plus savings' : 'savings'))),
      h('div', null, h('dt', null, 'Highest price at your monthly ceiling'), h('dd', null, atCeiling ? money(atCeiling, cur) : '—', h('small', null, p.budget.monthlyCeiling ? `${money(p.budget.monthlyCeiling, cur)} a month` : 'set a ceiling'))),
      h('div', null, h('dt', null, 'Highest price with a 10% deposit'), h('dd', null, tenPct ? money(tenPct, cur) : '—', h('small', null, 'after tax and buying costs'))),
      h('div', null, h('dt', null, 'Your budget'), h('dd', null, p.budget.max ? money(p.budget.max, cur) : '—', h('small', null, p.budget.stretch ? `stretch ${money(p.budget.stretch, cur)}` : 'no stretch set')))),
    sens ? h('ul', { class: 'pts ask' },
      h('li', null, `Each ${money(10000, cur)} off the price: ${signed(sens.priceMinus10k)}.`),
      sens.salePlus10k !== null ? h('li', null, `Each extra ${money(10000, cur)} on your sale: ${signed(sens.salePlus10k)}.`) : null,
      h('li', null, `Each 0.5 points on the mortgage rate: ${signed(sens.ratePlusHalf)}.`)) : null,
    h('p', { class: 'fine' }, `Worked out at ${ref ? money(ref, cur) : 'your budget'} from your profile and the rates you entered. For comparing homes only; your broker will confirm what you can borrow.`));
}

function reasonsPanel() {
  const gone = Object.values(getState().homes).filter((x) => trackOf(x.id).status === RULED_OUT).map((x) => ({ x, t: trackOf(x.id) }));
  const has = (/** @type {{ t: import('../store.js').Track }} */ g) => g.t.reasons.length > 0 || Boolean(g.t.reasonText);
  /** @type {Record<string, number>} */
  const counts = {};
  for (const g of gone) for (const k of g.t.reasons) counts[k] = (counts[k] || 0) + 1;
  const keys = REASONS.map(([k]) => k).filter((k) => counts[k]).sort((a, b) => counts[b] - counts[a]);
  const max = Math.max(1, ...keys.map((k) => counts[k]));
  const missing = gone.filter((g) => !has(g)).length;
  const order = [...gone].sort((a, b) => Number(has(a)) - Number(has(b)) || (b.t.statusAt || '').localeCompare(a.t.statusAt || ''));
  const shown = showAllReasons ? order : order.slice(0, 6);
  return h('section', { class: 'panel', 'aria-labelledby': 'rTitle' },
    h('div', { class: 'phead' }, h('h3', { id: 'rTitle' }, 'Why homes were ruled out'), gone.length ? h('span', { class: 'fine' }, `${gone.length} ruled out, ${gone.length - missing} with a reason`) : null),
    keys.length ? h('div', { class: 'rbars' }, ...keys.map((k) => h('div', { class: 'rbar' },
      h('span', null, REASON_LABELS[k]),
      h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.round((counts[k] / max) * 100)}%` } })),
      h('b', null, String(counts[k]))))) : null,
    h('p', { class: 'muted' }, !gone.length ? 'Nothing ruled out yet.' : missing ? `${missing} home${missing === 1 ? ' has' : 's have'} no reason yet. Add one so you can see what keeps putting you off.` : 'Every ruled-out home has a reason.'),
    shown.length ? h('ul', { class: 'rlist' }, ...shown.map(({ x, t }) => h('li', null,
      h('div', null,
        h('button', { type: 'button', class: 'linkbtn rn', onclick: () => viewHome(x.id) }, x.assessment.listing.title),
        t.reasons.length ? h('div', { class: 'rchips' }, ...t.reasons.map((k) => h('span', { class: 'rchip' }, REASON_LABELS[k]))) : null,
        h('p', { class: ['rw', !has({ t }) && 'miss'] }, t.reasonText ? `“${t.reasonText}”` : has({ t }) ? '' : 'No reason yet')),
      h('button', { type: 'button', class: 'btn small', onclick: () => openReasonDialog(x.id, 'edit') }, has({ t }) ? 'Edit' : 'Add reason')))) : null,
    order.length > 6 ? h('button', { type: 'button', class: 'linkbtn', onclick: () => { showAllReasons = !showAllReasons; ui.rerender?.(); } }, showAllReasons ? 'Show fewer' : `Show all ${order.length}`) : null);
}
