// @ts-check
/** Price against commute: lower and further left is better. */
import { h, s } from '../dom.js';
import { d } from '../derive.js';
import { VCLS } from './card.js';
import { moneyShort, minutesRange } from '../../../shared/format.js';
import { VERDICT_LABELS } from '../../../shared/schema.js';

/** @typedef {import('../store.js').Home} Home */

/**
 * @param {Home[]} list homes in display order
 * @param {string | null} currentId
 * @param {import('../../../shared/profile.js').Profile} profile
 * @param {(id: string) => void} onOpen
 */
export function renderChart(list, currentId, profile, onOpen) {
  const pts = list.map((home, i) => ({ home, i, x: d(home) })).filter((p) => p.x.facts.price !== null && p.x.facts.minutesMin !== null);
  const skipped = list.length - pts.length;
  if (!pts.length) return h('p', { class: 'muted' }, 'No homes here have both a price and a commute estimate to plot yet.');

  const main = document.getElementById('main');
  const W = Math.round(Math.min(720, Math.max(300, (main?.clientWidth || 640) - 48)));
  const narrow = W < 460;
  const H = Math.round(narrow ? 340 : Math.min(420, W * 0.6));
  const m = { top: 16, right: 14, bottom: 42, left: 52 };
  const cur = profile.currency;
  const b = profile.budget;
  const mv = profile.move;

  const mins = pts.flatMap((p) => [/** @type {number} */ (p.x.facts.minutesMin), /** @type {number} */ (p.x.facts.minutesMax)]);
  const x0 = Math.max(0, Math.floor((Math.min(...mins) - 5) / 10) * 10);
  const x1 = Math.ceil((Math.max(...mins, mv.maxCommuteMin || 0) + 5) / 10) * 10;
  const prices = pts.map((p) => /** @type {number} */ (p.x.facts.price));
  const refs = [b.target, b.max, b.stretch].filter((v) => v > 0);
  const span = Math.max(...prices, ...refs) - Math.min(...prices, ...refs);
  const step = span > 600000 ? 100000 : span > 250000 ? 50000 : 25000;
  const y0 = Math.floor((Math.min(...prices, ...refs) - step / 2) / step) * step;
  const y1 = Math.ceil((Math.max(...prices, ...refs) + step / 2) / step) * step;
  const X = (/** @type {number} */ v) => m.left + ((v - x0) / Math.max(1, x1 - x0)) * (W - m.left - m.right);
  const Y = (/** @type {number} */ v) => H - m.bottom - ((v - y0) / Math.max(1, y1 - y0)) * (H - m.top - m.bottom);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `Price against commute for ${pts.length} homes, with your budget lines and commute limits marked.` });
  const yStep = (y1 - y0) / step > 8 ? step * 2 : step;
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1; v += yStep) {
    svg.append(s('line', { x1: m.left, x2: W - m.right, y1: Y(v), y2: Y(v), class: 'grid' }));
    svg.append(s('text', { x: m.left - 6, y: Y(v), dy: '0.35em', 'text-anchor': 'end', class: 'ax' }, moneyShort(v, cur)));
  }
  for (let v = Math.ceil(x0 / 10) * 10; v <= x1; v += 10) {
    svg.append(s('text', { x: X(v), y: H - m.bottom + 16, 'text-anchor': 'middle', class: 'ax' }, String(v)));
  }
  svg.append(s('text', { x: (m.left + W - m.right) / 2, y: H - 6, 'text-anchor': 'middle', class: 'axt' }, `Minutes door to door to ${mv.destination || 'work'}`));

  const hRef = (/** @type {number} */ v, /** @type {string} */ text) => {
    if (!(v > 0) || v < y0 || v > y1) return;
    svg.append(s('line', { x1: m.left, x2: W - m.right, y1: Y(v), y2: Y(v), class: 'ref' }));
    svg.append(s('text', { x: W - m.right - 2, y: Y(v) - 4, 'text-anchor': 'end', class: 'reflab' }, text));
  };
  const vRef = (/** @type {number} */ v, /** @type {string} */ text) => {
    if (!(v > 0) || v < x0 || v > x1) return;
    svg.append(s('line', { x1: X(v), x2: X(v), y1: m.top, y2: H - m.bottom, class: 'ref' }));
    svg.append(s('text', { x: X(v) + 4, y: m.top + 10, class: 'reflab' }, text));
  };
  hRef(b.target, `${moneyShort(b.target, cur)} target`);
  hRef(b.max, `${moneyShort(b.max, cur)} budget`);
  hRef(b.stretch, `${moneyShort(b.stretch, cur)} stretch`);
  vRef(mv.idealCommuteMin, narrow ? `${mv.idealCommuteMin}` : `${mv.idealCommuteMin} min ideal`);
  vRef(mv.maxCommuteMin, narrow ? 'Limit' : `${mv.maxCommuteMin} min limit`);

  const R = narrow ? 10 : 11.5;
  const ordered = [...pts].sort((a, c) => Number(a.home.id === currentId) - Number(c.home.id === currentId));
  for (const p of ordered) {
    const fct = p.x.facts;
    const cx = X(/** @type {number} */ (p.x.commuteAvg));
    const cy = Y(/** @type {number} */ (fct.price));
    const isCur = p.home.id === currentId;
    const name = p.home.assessment.listing.title;
    const desc = `${p.i + 1}. ${name}, ${moneyShort(/** @type {number} */ (fct.price), cur)}, ${minutesRange(fct.minutesMin, fct.minutesMax)}, ${/** @type {Record<string, string>} */ (VERDICT_LABELS)[p.x.verdict]}`;
    const g = s('g', { class: `dot v-${VCLS[p.x.verdict]}${isCur ? ' current' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${desc}. Open this home.` },
      s('title', null, desc),
      s('line', { x1: X(/** @type {number} */ (fct.minutesMin)), x2: X(/** @type {number} */ (fct.minutesMax)), y1: cy, y2: cy, class: 'range' }),
      s('circle', { cx, cy, r: R + 4, class: 'ring' }),
      s('circle', { cx, cy, r: R, class: 'fill' }),
      s('text', { x: cx, y: cy, dy: '0.35em', 'text-anchor': 'middle', class: 'dnum' }, String(p.i + 1)));
    g.addEventListener('click', () => onOpen(p.home.id));
    g.addEventListener('keydown', (e) => {
      const k = /** @type {KeyboardEvent} */ (e).key;
      if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        onOpen(p.home.id);
      }
    });
    svg.append(g);
  }

  return h('div', null,
    h('p', { class: 'fine' }, `${pts.length} home${pts.length === 1 ? '' : 's'}, numbered in list order. Lower and further left is better; lines show the commute range. Tap a dot to open it.${skipped ? ` ${skipped} without a price or commute estimate ${skipped === 1 ? 'isn’t' : 'aren’t'} shown.` : ''}`),
    h('div', { class: 'chart' }, svg),
    h('div', { class: 'legend', 'aria-hidden': 'true' },
      h('span', null, h('i', { class: 'v-good' }), 'Worth viewing'),
      h('span', null, h('i', { class: 'v-mid' }), 'Only if checks pass'),
      h('span', null, h('i', { class: 'v-bad' }), 'Don’t buy'),
      h('span', null, h('i', { class: 'ringkey' }), 'The home you’re viewing')));
}
