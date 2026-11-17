// @ts-check
/**
 * Scheduled refresh. Homes you added by link are re-checked on the schedule in your
 * profile (weekly by default), so price changes, offers and withdrawn listings show
 * up without you re-adding them. Your homes live in this browser, so checks run while
 * NestWorth is open and catch up when you next open it. Ruled-out homes and pasted
 * listings are never re-checked, and the server only asks the AI again when the price
 * or availability has changed.
 */
import { getState, recordRefresh, applyRefreshUpdate } from './store.js';
import { ui, toast, go } from './ui.js';
import * as api from './api.js';
import { dueHomes } from './schedule.js';
import { criteriaForAI } from '../../shared/profile.js';
import { listingFingerprint, isFingerprint } from '../../shared/fingerprint.js';

const FIRST_CHECK_MS = 15 * 1000;
const EVERY_MS = 15 * 60 * 1000;
const GAP_MS = 3000; // between homes, to go easy on property websites
// Problems with the server or the connection rather than one listing: stop, and try
// again at the next scheduled check.
const STOP = new Set(['RATE_LIMITED', 'DAILY_LIMIT', 'BUSY', 'UNAUTHORISED', 'NETWORK', 'FETCH_DISABLED', 'CANCELLED']);

let running = false;
/** @type {{ at: string, checked: number, updated: number, gone: number, failed: number, stopped: string } | null} */
let last = null;

/** Whether a check is running, and how the last one went. */
export const refreshStatus = () => ({ running, last });

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Re-check one home. Throws for problems that should stop a whole run.
 * @param {string} id
 * @returns {Promise<'unchanged' | 'updated' | 'gone' | 'failed' | 'skipped'>}
 */
async function checkOne(id) {
  const home = getState().homes[id];
  if (!home || !home.source.url) return 'skipped';
  const fp = isFingerprint(home.meta?.fingerprint) ? home.meta.fingerprint : listingFingerprint(home.listingText || '');
  try {
    const out = await api.refresh({
      listing: { url: home.source.url },
      previous: { price: fp.price, status: fp.status },
      criteria: criteriaForAI(getState().profile),
      options: { research: false },
    });
    if (out.gone) {
      recordRefresh(id, { result: 'gone', checkedAt: out.checkedAt, changes: out.changes });
      return 'gone';
    }
    if (out.changed) {
      applyRefreshUpdate(id, out);
      return 'updated';
    }
    recordRefresh(id, { result: 'unchanged', checkedAt: out.checkedAt, fingerprint: out.fingerprint });
    return 'unchanged';
  } catch (err) {
    const e = err instanceof api.ApiError ? err : new api.ApiError('UNKNOWN', 'Something went wrong.');
    if (STOP.has(e.code)) throw e;
    recordRefresh(id, { result: 'failed', checkedAt: new Date().toISOString(), message: e.message });
    return 'failed';
  }
}

/** @param {NonNullable<typeof last>} s */
function describe(s) {
  if (s.stopped && !s.checked) return `Couldn’t check for changes: ${s.stopped}`;
  const parts = [];
  if (s.updated) parts.push(`${s.updated} changed and assessed again`);
  if (s.gone) parts.push(`${s.gone} may have been withdrawn`);
  if (s.failed) parts.push(`${s.failed} couldn’t be read`);
  const same = s.checked - s.updated - s.gone - s.failed;
  if (same) parts.push(`${same} unchanged`);
  return `Checked ${s.checked} home${s.checked === 1 ? '' : 's'}: ${parts.join(', ')}.${s.stopped ? ` Stopped early: ${s.stopped}` : ''}`;
}

/**
 * Re-check the homes that are due, or every home that can be re-checked.
 * @param {{ force?: boolean, announce?: boolean }} [opts] announce: report even when nothing changed
 */
export async function runRefresh(opts = {}) {
  if (running) {
    if (opts.announce) toast('Already checking your homes for changes…');
    return null;
  }
  const ids = dueHomes(getState(), Date.now(), Boolean(opts.force)).map((home) => home.id);
  if (!ids.length) {
    if (opts.announce) toast('There are no active homes added by link to check. Pasted listings can’t be re-checked.');
    return null;
  }
  running = true;
  if (opts.announce) toast(`Checking ${ids.length} home${ids.length === 1 ? '' : 's'} for changes…`);
  const summary = { at: new Date().toISOString(), checked: 0, updated: 0, gone: 0, failed: 0, stopped: '' };
  try {
    for (const [i, id] of ids.entries()) {
      if (i) await sleep(GAP_MS);
      try {
        const result = await checkOne(id);
        if (result === 'skipped') continue;
        summary.checked++;
        if (result === 'updated') summary.updated++;
        else if (result === 'gone') summary.gone++;
        else if (result === 'failed') summary.failed++;
      } catch (err) {
        summary.stopped = err instanceof Error ? err.message : 'The server stopped responding.';
        break;
      }
    }
  } finally {
    running = false;
    last = summary;
  }
  const news = summary.updated + summary.gone;
  if (news || opts.announce) toast(describe(summary), news ? [{ label: 'See changes', run: () => go('#/dashboard') }] : []);
  return summary;
}

/**
 * Re-check one home now, from its card.
 * @param {string} id
 */
export async function refreshHome(id) {
  if (running) {
    toast('Already checking your homes for changes…');
    return;
  }
  running = true;
  toast('Checking the listing for changes…');
  try {
    const result = await checkOne(id);
    toast({
      updated: 'The listing has changed, so the home has been assessed again.',
      gone: 'The listing may have been withdrawn. See the note on the home.',
      unchanged: 'No change to the price or availability.',
      failed: 'Couldn’t read the listing. See the note on the home.',
      skipped: 'This home has no link to check.',
    }[result]);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t check for changes.');
  } finally {
    running = false;
  }
}

/**
 * Start the schedule: shortly after opening, then every 15 minutes, and whenever the
 * tab comes back into view. Each tick only re-checks homes that are due.
 */
export function startScheduler() {
  const tick = () => {
    if (!ui.health?.listingFetch || getState().profile.refresh.frequency === 'off') return;
    runRefresh().catch(() => {});
  };
  window.setTimeout(tick, FIRST_CHECK_MS);
  window.setInterval(tick, EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });
}
