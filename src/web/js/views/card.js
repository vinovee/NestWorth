// @ts-check
/** One home, in full: the AI's assessment, your rules, the money and the provenance. */
import { h, fold, extLink } from '../dom.js';
import { getState, trackOf, RULED_OUT, REASON_LABELS } from '../store.js';
import { d } from '../derive.js';
import { ordinal } from '../ui.js';
import { openEditFacts, reassess, confirmDelete, openReasonDialog, restore } from '../actions.js';
import { money, money2, moneyShort, signedPct, score, minutesRange, shortDate } from '../../../shared/format.js';
import { VERDICT_LABELS, PROPERTY_TYPE_LABELS, BUILD_AGE_LABELS } from '../../../shared/schema.js';
import { TAX_REGIONS } from '../../../shared/tax-rules.js';

/** @typedef {import('../store.js').Home} Home */

export const VCLS = /** @type {Record<string, string>} */ ({ worth_viewing: 'good', only_if_checks_pass: 'mid', dont_buy: 'bad' });
const FEEL = /** @type {Record<string, string>} */ ({ lively: 'Lively', quiet: 'Quiet', deserted_risk: 'Deserted risk', unknown: 'Not assessed' });
const MODE = /** @type {Record<string, string>} */ ({
  walk: 'Walk', cycle: 'Cycle', bus: 'Bus', car: 'Car', national_rail: 'Train', metro: 'Metro or Tube', tram: 'Tram', ferry: 'Ferry', other: 'Other',
});
const TENURE = /** @type {Record<string, string>} */ ({ freehold: 'Freehold', leasehold: 'Leasehold', share_of_freehold: 'Share of freehold', commonhold: 'Commonhold', unknown: 'Not stated' });
const label = (/** @type {Record<string, string>} */ map, /** @type {string} */ k) => map[k] || k;
const NS = 'Not stated';

/** @param {string} verdict */
export function pill(verdict) {
  return h('span', { class: ['pill', `v-${VCLS[verdict]}`] }, h('i', { 'aria-hidden': 'true' }), label(VERDICT_LABELS, verdict));
}

/** A labelled bar from 0 to 10. */
function meter(/** @type {string} */ name, /** @type {number} */ value, primary = false) {
  return h('div', { class: ['meter', primary && 'primary'] },
    h('span', { class: 'ml' }, name),
    h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.max(0, Math.min(10, value)) * 10}%` } })),
    h('span', { class: 'mv' }, `${score(value)}/10`));
}

/** @param {[string, any, string?][]} rows label, value, small print */
function tiles(rows, cls = 'tiles') {
  return h('dl', { class: cls }, ...rows.filter(Boolean).map(([dt, dd, small]) =>
    h('div', null, h('dt', null, dt), h('dd', null, dd, small ? h('small', null, small) : null))));
}

/**
 * @param {Home} home
 * @param {{ index: number, count: number, where: string, sortPhrase: string }} pos
 */
export function renderCard(home, pos) {
  const p = getState().profile;
  const cur = p.currency;
  const a = home.assessment;
  const L = a.listing;
  const x = d(home);
  const f = x.facts;
  const t = trackOf(home.id);
  const o = home.overrides || {};
  const edited = (/** @type {string} */ k) => (k in o ? h('span', { class: 'badge' }, 'edited') : null);

  // Archived notice
  let archived = null;
  if (t.status === RULED_OUT) {
    const chips = t.reasons.map((k) => h('span', { class: 'rchip' }, REASON_LABELS[k] || k));
    archived = h('div', { class: 'arch' },
      h('p', null, `You ruled this out${t.statusAt ? ` on ${shortDate(t.statusAt)}` : ''}. It stays here for reference, out of your active lists.`),
      chips.length ? h('div', { class: 'rchips' }, ...chips) : null,
      t.reasonText ? h('p', { class: 'why' }, `“${t.reasonText}”`) : !chips.length ? h('p', { class: 'why muted' }, 'No reason recorded yet.') : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn small', onclick: () => openReasonDialog(home.id, 'edit') }, chips.length || t.reasonText ? 'Edit reason' : 'Add a reason'),
        h('button', { type: 'button', class: 'btn small', onclick: () => restore(home.id) }, `Restore to ${t.prevStatus && t.prevStatus !== RULED_OUT ? t.prevStatus : 'Active'}`)));
  }

  // Links and actions
  const dest = p.move.destination.trim();
  const maps = L.address !== NS && dest
    ? extLink(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(L.address)}&destination=${encodeURIComponent(dest)}&travelmode=transit`, 'Check the commute', 'tlink alt')
    : null;
  const links = h('div', { class: 'toplinks' },
    home.source.url ? extLink(home.source.url, 'Open the listing') : null,
    maps,
    h('button', { type: 'button', class: 'tlink alt', onclick: () => openEditFacts(home.id) }, 'Correct facts'),
    home.source.type !== 'manual' ? h('button', { type: 'button', class: 'tlink alt', onclick: () => reassess(home.id) }, 'Assess again') : null,
    h('button', { type: 'button', class: 'tlink alt danger', onclick: () => confirmDelete(home.id) }, 'Delete'));

  // Your rules
  const notes = x.policy.notes;
  const rules = notes.length ? h('div', { class: 'rules' },
    h('p', { class: 'rules-h' }, x.policy.lowered
      ? `Your rules changed the AI’s verdict from “${label(VERDICT_LABELS, x.policy.aiVerdict)}”`
      : 'Checked against your rules'),
    h('ul', null, ...notes.map((n) => h('li', { class: `r-${n.level}` }, n.text)))) : null;

  // Price
  const priceLine = h('p', { class: 'price' },
    f.price === null ? 'Price not stated' : f.priceMax && f.priceMax !== f.price ? `${money(f.price, cur)}–${money(f.priceMax, cur)}` : money(f.price, cur),
    edited('price') || edited('priceMax'),
    h('small', null, L.priceText !== NS ? L.priceText : 'The listing gives no price'));

  // Facts
  const area = L.floorAreaSqft ? `${Math.round(L.floorAreaSqft).toLocaleString('en-GB')} sq ft` : NS;
  const factRows = /** @type {[string, any, string?][]} */ ([
    ['Type', h('span', null, label(PROPERTY_TYPE_LABELS, f.propertyType), edited('propertyType'))],
    ['Bedrooms', h('span', null, f.bedrooms ?? NS, edited('bedrooms'))],
    ['Bathrooms', L.bathrooms ?? NS],
    ['Size', area, L.floorAreaSqft ? `${Math.round(L.floorAreaSqft / 10.764)} m²` : undefined],
    ['Build', label(BUILD_AGE_LABELS, L.buildAge)],
    ['Tenure', label(TENURE, L.tenure)],
    ['EPC', L.epcRating],
    ['Council tax', L.councilTaxBand],
    ['Warranty', L.warranty],
    ['Heating', L.heating],
    ['Parking', L.parking],
    ['Garden', L.garden],
    ['Space for your needs', L.spaceForBuyerNeeds],
    ['Charges', L.charges],
    ['Agent', L.agent],
  ]);
  const facts = h('dl', { class: 'facts' }, ...factRows.map(([dt, dd, small]) =>
    h('div', { class: dd === NS ? 'ns' : '' }, h('dt', null, dt), h('dd', null, dd, small ? h('small', null, small) : null))));

  // Ratings
  const r = a.ratings;
  const ratings = fold('Ratings', `Fit ${score(r.overall)}/10 · ${label(FEEL, a.areaFeel.kind)}`, [
    meter('Fit', r.overall, true),
    meter('Liveability', r.liveability),
    meter('Area', r.area),
    meter('Value', r.value),
    h('p', { class: 'fine' }, h('b', { class: ['feel', a.areaFeel.kind] }, label(FEEL, a.areaFeel.kind)), ' ', a.areaFeel.note),
  ]);

  // Commute
  const c = a.commute;
  const legs = c.legs.length ? h('ol', { class: 'legs' }, ...c.legs.map((/** @type {any} */ l) =>
    h('li', { class: `m-${l.mode}` },
      h('span', { class: 'sw', 'aria-hidden': 'true' }),
      h('span', null, h('span', { class: 'mode' }, label(MODE, l.mode)), ' ', l.description, l.frequency ? h('small', null, l.frequency) : null),
      h('span', { class: 'mins' }, `${l.minutes} min`)))) : h('p', { class: 'muted' }, 'No route given.');
  const strip = c.legs.length ? h('div', { class: 'strip', 'aria-hidden': 'true' }, ...c.legs.map((/** @type {any} */ l) => {
    const nums = String(l.minutes).match(/\d+/g) || ['5'];
    const avg = nums.map(Number).reduce((s, n) => s + n, 0) / nums.length;
    return h('span', { class: `seg m-${l.mode}`, style: { flexGrow: String(Math.max(1, avg)) } });
  }), h('span', { class: 'terminus' })) : null;
  const days = p.move.officeDaysPerWeek;
  const commute = fold(`Getting to ${c.destination || dest || 'work'}`, minutesRange(f.minutesMin, f.minutesMax), [
    strip,
    legs,
    h('p', { class: 'total' }, f.minutesMin === null ? 'Journey time not estimated.' : `About ${minutesRange(f.minutesMin, f.minutesMax)} door to door`, edited('minutesMin') || edited('minutesMax'),
      h('span', { class: 'muted' }, ` · confidence: ${c.confidence}`)),
    f.farePerDay !== null ? tiles([
      ['Per office day', money2(f.farePerDay, cur)],
      [`Per week (${days} days)`, money2(f.farePerDay * days, cur)],
      ['Per month', x.fares !== null ? money(x.fares, cur) : '—'],
    ], 'tiles three') : null,
    h('p', { class: 'fine' }, c.fareNote, ` A month assumes ${days} office days a week for ${p.move.workingWeeksPerYear} weeks a year. Times and fares are estimates: check them with a journey planner.`),
    maps,
  ]);

  // Costs
  const fin = x.fin;
  /** @type {Node} */
  let costs;
  if (!fin) {
    costs = fold('Costs', 'No price', [h('p', { class: 'muted' }, 'Add a price with “Correct facts” to see stamp duty, deposit and the monthly mortgage.')]);
  } else {
    const over = fin.overCeiling !== null && fin.overCeiling > 0;
    const region = TAX_REGIONS[p.tax.region];
    costs = fold('Costs', fin.monthly !== null ? `${money(fin.monthly, cur)} a month` : 'Deposit too small', [
      tiles([
        [region ? region.tax.replace(/ \(.*\)$/, '') : 'Purchase tax', money(fin.tax.total, cur), fin.tax.reclaimable ? `${money(fin.tax.reclaimable, cur)} usually reclaimable` : undefined],
        ['Deposit', money(Math.max(0, fin.deposit), cur), `${Math.max(0, fin.depositPct).toFixed(1)}% of the price`],
        ['Mortgage', money(fin.loan, cur), fin.rate !== null ? `${fin.rate}% at ${Math.round(fin.ltvPct)}% LTV, ${p.mortgage.termYears} years` : 'No rate covers this LTV'],
        ['Est. monthly', h('span', { class: over ? 'over' : '' }, fin.monthly !== null ? money(fin.monthly, cur) : '—'), over ? `${money(/** @type {number} */ (fin.overCeiling), cur)} over your ceiling` : p.budget.monthlyCeiling ? `Ceiling ${money(p.budget.monthlyCeiling, cur)}` : undefined],
        ['With commute fares', x.allIn !== null ? money(x.allIn, cur) : 'Fares not known'],
        x.finTop ? ['At the top of the range', x.finTop.monthly !== null ? money(x.finTop.monthly, cur) : '—', `${money(/** @type {number} */ (f.priceMax), cur)} asking`] : /** @type {any} */ (null),
      ]),
      ...fin.tax.notes.map((n) => h('p', { class: 'fine' }, n)),
      h('p', { class: 'fine' }, `From your profile: ${money(fin.cash, cur)} of cash${p.sale.selling ? ' after selling your home' : ''}, less ${money(fin.tax.total, cur)} tax and ${money(p.cash.buyingCosts, cur)} buying costs. Estimates for comparing homes, not a mortgage offer: your broker will confirm what you can borrow and at what rate.`),
    ]);
  }

  // Resale
  const rs = x.resale;
  const ten = rs?.points.find((q) => q.years === 10);
  const resale = rs ? fold('Resale value', ten ? `${signedPct(ten.changePct)} after 10 years` : '', [
    tiles([
      ['Worth on day one', moneyShort(rs.dayOne, cur)],
      ...rs.points.map((q) => /** @type {[string, any, string]} */ ([`In ${q.years} years`, moneyShort(q.value, cur), signedPct(q.changePct)])),
    ]),
    h('p', null, p.resale.useMine ? 'Using your own growth assumptions from your profile.' : a.resale.rationale),
    h('p', { class: 'fine' }, `Assumes a new-build premium of ${x.resaleAssumptions.newBuildPremiumPct}% lost on day one, ${signedPct(x.resaleAssumptions.growth5yPct)} over five years, then ${x.resaleAssumptions.growthAnnualPct}% a year. Estimates before inflation, not a valuation.`),
  ]) : null;

  // AI take
  const take = h('section', { class: 'take' },
    h('h3', null, 'The AI’s take'),
    h('p', { class: 'lead' }, a.summary),
    h('p', { class: 'muted' }, h('b', null, `${label(VERDICT_LABELS, a.verdict)}: `), a.verdictReason));

  const list = (/** @type {string} */ cls, /** @type {string[]} */ items, /** @type {string} */ empty) =>
    items.length ? h('ul', { class: ['pts', cls] }, ...items.map((i) => h('li', null, i))) : h('p', { class: 'muted' }, empty);
  const lists = fold('Good, watch-outs and questions', `${a.positives.length} good · ${a.watchOuts.length} to watch`, [
    h('h4', null, 'Good'), list('good', a.positives, 'Nothing stood out.'),
    h('h4', null, 'Watch out for'), list('watch', a.watchOuts, 'Nothing flagged.'),
    h('h4', null, 'Ask before offering'), list('ask', a.questions, 'No questions listed.'),
  ]);

  const STATUS = /** @type {Record<string, string>} */ ({ meets: 'Meets', partly: 'Partly', fails: 'Fails', unknown: 'Unknown' });
  const met = a.criteria.filter((/** @type {any} */ q) => q.status === 'meets').length;
  const criteria = a.criteria.length ? fold('Your criteria', `${met} of ${a.criteria.length} met`, [
    h('ul', { class: 'crit' }, ...a.criteria.map((/** @type {any} */ q) =>
      h('li', { class: `c-${q.status}` }, h('span', { class: 'cs' }, STATUS[q.status]), h('span', null, h('b', null, q.criterion), h('small', null, q.note))))),
  ]) : null;

  const lv = a.liveability;
  const lvRows = /** @type {[string, string][]} */ ([['Locality', lv.locality], ['Crime', lv.crime], ['Housing mix', lv.housingMix], ['Flood risk', lv.flood], ['Ground', lv.ground], ['Also note', lv.other]]);
  const liveability = fold('Liveability check', '', [
    h('dl', { class: 'lv' }, ...lvRows.filter(([, v]) => v).map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))),
    h('p', { class: 'fine' }, 'Before you exchange, ask your conveyancer for the environmental and ground-stability searches.'),
  ]);

  const missing = a.missingInfo.length ? fold('Missing from the listing', `${a.missingInfo.length}`, [list('ask', a.missingInfo, '')]) : null;

  const m = home.meta || {};
  const usage = m.usage ? `${((m.usage.inputTokens || 0) + (m.usage.outputTokens || 0)).toLocaleString('en-GB')} tokens${m.usage.webSearches ? `, ${m.usage.webSearches} web searches` : ''}` : '';
  const provenance = fold('Sources and how this was made', a.sources.length ? `${a.sources.length} source${a.sources.length === 1 ? '' : 's'}` : '', [
    a.sources.length
      ? h('ul', { class: 'sources' }, ...a.sources.map((/** @type {any} */ s) => h('li', null, extLink(s.url, s.title, 'slink') || s.title)))
      : h('p', { class: 'muted' }, 'No sources beyond the listing text you pasted.'),
    h('p', { class: 'fine' }, home.source.type === 'manual'
      ? 'Added by hand, not assessed by AI.'
      : `Assessed${m.model ? ` by ${m.model}` : ''}${m.provider === 'demo' ? ' (demo mode: keyword rules, not AI)' : ''}${m.assessedAt ? ` on ${shortDate(m.assessedAt)}` : ''}${m.promptVersion ? `, prompt ${m.promptVersion}` : ''}${m.research?.used ? ', with web research' : ', from the listing only'}${usage ? `, ${usage}` : ''}. AI can get things wrong: check anything you rely on.`),
    ...(Array.isArray(m.warnings) ? m.warnings : []).map((/** @type {string} */ w) => h('p', { class: 'fine warn' }, w)),
  ]);

  const statusChip = t.status && t.status !== RULED_OUT ? h('p', { class: 'stage' }, t.status) : null;

  return h('article', { class: ['card', `v-${VCLS[x.verdict]}`, t.status === RULED_OUT && 'is-arch'], id: 'card', 'aria-label': L.title },
    archived,
    h('div', { class: 'card-top' },
      h('span', { class: 'rankline' }, `${ordinal(pos.index + 1)} of ${pos.count} ${pos.where}, by ${pos.sortPhrase}`),
      pill(x.verdict)),
    h('h2', { class: 'name' }, L.title),
    h('p', { class: 'place' }, L.address),
    links,
    statusChip,
    rules,
    priceLine,
    facts,
    take,
    ratings,
    commute,
    costs,
    resale,
    lists,
    criteria,
    liveability,
    missing,
    provenance,
    home.source.url ? extLink(home.source.url, 'Open the listing', 'listing') : null);
}
