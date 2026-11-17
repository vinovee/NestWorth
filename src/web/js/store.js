// @ts-check
/**
 * Local-first storage. Everything (your profile, the homes and your notes) lives
 * in this browser's localStorage. Nothing is sent anywhere except the listing and
 * your search criteria, when you ask for an assessment. Export and import let you
 * back up or move your data.
 */
import { normaliseProfile, DEFAULT_PROFILE } from '../../shared/profile.js';
import { validateAssessment } from '../../shared/schema.js';

/** @typedef {import('../../shared/profile.js').Profile} Profile */

const KEY = 'nestworth/v1';
export const FORMAT = 1;

export const REVIEW = 'For review';
export const RULED_OUT = 'Ruled out';
export const STATUSES = [REVIEW, '', 'Shortlisted', 'Enquired', 'Viewing booked', 'Viewed', 'Offer made', RULED_OUT];
export const STATUS_LABELS = /** @type {Record<string, string>} */ ({
  [REVIEW]: 'For review (new)', '': 'Not decided', Shortlisted: 'Shortlisted', Enquired: 'Enquired (contacted the agent)',
  'Viewing booked': 'Viewing booked', Viewed: 'Viewed', 'Offer made': 'Offer made', [RULED_OUT]: 'Ruled out (not going ahead)',
});
export const REASONS = /** @type {[string, string][]} */ ([
  ['cost', 'Too expensive'], ['commute', 'Commute too long'], ['area', 'Area or location'], ['space', 'Too small or poor layout'],
  ['outdoor', 'Garden or outdoor space'], ['build', 'Build, warranty or condition'], ['resale', 'Resale risk'], ['rating', 'Low rating'],
  ['viewing', 'Didn’t feel right on viewing'], ['gone', 'No longer available'], ['other', 'Other'],
]);
export const REASON_LABELS = Object.fromEntries(REASONS);

/**
 * @typedef {object} Home
 * @property {string} id
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {{ type: string, url: string }} source
 * @property {string} listingText
 * @property {any} assessment
 * @property {any} meta
 * @property {Record<string, any>} overrides
 */
/**
 * @typedef {object} Track
 * @property {string} status
 * @property {string} statusAt
 * @property {string} prevStatus
 * @property {number | null} myRating
 * @property {{ id: string, text: string, at: string }[]} notes
 * @property {string[]} reasons
 * @property {string} reasonText
 * @property {string} reasonAt
 */
/**
 * @typedef {object} State
 * @property {Profile} profile
 * @property {boolean} profileSaved
 * @property {Record<string, Home>} homes
 * @property {Record<string, Track>} track
 */

const listeners = new Set();
/** @type {State} */
let state = load();
let saveTimer = 0;
/** @type {string} */
let lastSaveError = '';

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();

/** @returns {State} */
function empty() {
  return { profile: structuredClone(DEFAULT_PROFILE), profileSaved: false, homes: {}, track: {} };
}

/** @returns {State} */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    const result = sanitiseData(parsed);
    return { ...result.data, profileSaved: Boolean(parsed.profileSaved) };
  } catch (err) {
    console.warn('Could not read saved data; starting fresh.', err);
    return empty();
  }
}

function persist() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ format: FORMAT, ...state }));
      lastSaveError = '';
    } catch (err) {
      lastSaveError = 'Couldn’t save in this browser (storage may be full or blocked). Export your data to keep a copy.';
      console.warn(err);
    }
    for (const fn of listeners) fn('saved');
  }, 150);
}

/** @param {(reason: string) => void} fn */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed(/** @type {string} */ reason) {
  persist();
  for (const fn of listeners) fn(reason);
}

export const getState = () => state;
export const saveError = () => lastSaveError;

/** @param {string} id @returns {Track} */
export function trackOf(id) {
  return state.track[id] || { status: '', statusAt: '', prevStatus: '', myRating: null, notes: [], reasons: [], reasonText: '', reasonAt: '' };
}
/** @param {string} id */
function ensureTrack(id) {
  if (!state.track[id]) state.track[id] = structuredClone(trackOf(id));
  return state.track[id];
}

/** @param {Profile} profile */
export function setProfile(profile) {
  state.profile = profile;
  state.profileSaved = true;
  changed('profile');
}

/**
 * @param {{ assessment: any, meta: any, listingText: string, source: { type: string, url: string } }} input
 * @returns {string} the new home's id
 */
export function addHome(input) {
  const id = newId();
  const at = nowIso();
  state.homes[id] = { id, createdAt: at, updatedAt: at, source: input.source, listingText: input.listingText.slice(0, 30000), assessment: input.assessment, meta: input.meta, overrides: {} };
  state.track[id] = { status: REVIEW, statusAt: at, prevStatus: '', myRating: null, notes: [], reasons: [], reasonText: '', reasonAt: '' };
  changed('homes');
  return id;
}

/** @param {string} id @param {{ assessment: any, meta: any, listingText?: string }} next */
export function replaceAssessment(id, next) {
  const home = state.homes[id];
  if (!home) return;
  home.assessment = next.assessment;
  home.meta = next.meta;
  if (next.listingText) home.listingText = next.listingText.slice(0, 30000);
  home.updatedAt = nowIso();
  changed('homes');
}

/** @param {string} id @param {Record<string, any>} overrides */
export function setOverrides(id, overrides) {
  const home = state.homes[id];
  if (!home) return;
  home.overrides = overrides;
  home.updatedAt = nowIso();
  changed('homes');
}

/** @param {string} id */
export function removeHome(id) {
  delete state.homes[id];
  delete state.track[id];
  changed('homes');
}

/**
 * Change a home's status. Returns what's needed to undo it.
 * @param {string} id
 * @param {string} status
 */
export function setStatus(id, status) {
  const t = ensureTrack(id);
  const undo = { status: t.status, statusAt: t.statusAt, prevStatus: t.prevStatus };
  if (status === RULED_OUT && t.status !== RULED_OUT) t.prevStatus = t.status;
  t.status = status;
  t.statusAt = nowIso();
  changed('track');
  return undo;
}
/** @param {string} id @param {{ status: string, statusAt: string, prevStatus: string }} undo */
export function undoStatus(id, undo) {
  const t = ensureTrack(id);
  Object.assign(t, undo);
  changed('track');
}
/** @param {string} id @param {number | null} rating */
export function setRating(id, rating) {
  ensureTrack(id).myRating = rating;
  changed('track');
}
/** @param {string} id @param {string} text */
export function addNote(id, text) {
  ensureTrack(id).notes.push({ id: newId(), text: text.slice(0, 4000), at: nowIso() });
  changed('track');
}
/** @param {string} id @param {string} noteId */
export function deleteNote(id, noteId) {
  const t = ensureTrack(id);
  t.notes = t.notes.filter((n) => n.id !== noteId);
  changed('track');
}
/** @param {string} id @param {string[]} reasons @param {string} text */
export function setReasons(id, reasons, text) {
  const t = ensureTrack(id);
  t.reasons = reasons.filter((r) => r in REASON_LABELS);
  t.reasonText = text.slice(0, 2000);
  t.reasonAt = nowIso();
  changed('track');
}

/** Everything, as a JSON string, for backup. */
export function exportJson() {
  return JSON.stringify({ app: 'nestworth', format: FORMAT, exportedAt: nowIso(), profile: state.profile, homes: Object.values(state.homes), track: state.track }, null, 2);
}

/**
 * Replace all data with an export file's contents, after checking it.
 * @param {string} text
 */
export function importJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: 'That file isn’t valid JSON.' };
  }
  if (!parsed || parsed.app !== 'nestworth') return { ok: false, message: 'That file isn’t a NestWorth export.' };
  const result = sanitiseData(parsed);
  if (!result.profileOk) return { ok: false, message: 'The profile in that file isn’t valid.' };
  state = { ...result.data, profileSaved: true };
  changed('import');
  const n = Object.keys(state.homes).length;
  return { ok: true, message: `Imported ${n} home${n === 1 ? '' : 's'}${result.skipped ? `; skipped ${result.skipped} that weren’t valid` : ''}.` };
}

export function clearAll() {
  state = empty();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing to remove
  }
  changed('import');
}

/**
 * Check saved or imported data and keep only what's valid.
 * @param {any} raw
 */
function sanitiseData(raw) {
  const prof = normaliseProfile(raw?.profile);
  /** @type {Record<string, Home>} */
  const homes = {};
  let skipped = 0;
  const list = Array.isArray(raw?.homes) ? raw.homes : Object.values(raw?.homes || {});
  for (const h of list) {
    const ok = h && typeof h.id === 'string' && /^[\w-]{1,80}$/.test(h.id) && validateAssessment(h.assessment).ok;
    if (!ok) {
      skipped++;
      continue;
    }
    homes[h.id] = {
      id: h.id,
      createdAt: typeof h.createdAt === 'string' ? h.createdAt : nowIso(),
      updatedAt: typeof h.updatedAt === 'string' ? h.updatedAt : nowIso(),
      source: { type: String(h.source?.type || 'pasted').slice(0, 20), url: typeof h.source?.url === 'string' ? h.source.url.slice(0, 2048) : '' },
      listingText: typeof h.listingText === 'string' ? h.listingText.slice(0, 30000) : '',
      assessment: validateAssessment(h.assessment).value,
      meta: h.meta && typeof h.meta === 'object' ? h.meta : {},
      overrides: sanitiseOverrides(h.overrides),
    };
  }
  /** @type {Record<string, Track>} */
  const track = {};
  for (const [id, t] of Object.entries(raw?.track || {})) {
    if (!homes[id] || !t || typeof t !== 'object') continue;
    const r = /** @type {any} */ (t);
    track[id] = {
      status: STATUSES.includes(r.status) ? r.status : '',
      statusAt: typeof r.statusAt === 'string' ? r.statusAt : '',
      prevStatus: STATUSES.includes(r.prevStatus) ? r.prevStatus : '',
      myRating: typeof r.myRating === 'number' && r.myRating >= 1 && r.myRating <= 10 ? Math.round(r.myRating) : null,
      notes: Array.isArray(r.notes) ? r.notes.filter((/** @type {any} */ n) => n && typeof n.text === 'string').map((/** @type {any} */ n) => ({ id: String(n.id || newId()), text: n.text.slice(0, 4000), at: String(n.at || '') })) : [],
      reasons: Array.isArray(r.reasons) ? r.reasons.filter((/** @type {any} */ k) => typeof k === 'string' && k in REASON_LABELS) : [],
      reasonText: typeof r.reasonText === 'string' ? r.reasonText.slice(0, 2000) : '',
      reasonAt: typeof r.reasonAt === 'string' ? r.reasonAt : '',
    };
  }
  return { data: { profile: prof.profile, homes, track }, profileOk: prof.ok, skipped };
}

/** @param {any} o */
function sanitiseOverrides(o) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const k of ['price', 'priceMax', 'bedrooms', 'minutesMin', 'minutesMax', 'farePerDay']) {
    if (typeof o[k] === 'number' && Number.isFinite(o[k]) && o[k] >= 0) out[k] = o[k];
  }
  if (typeof o.propertyType === 'string') out.propertyType = o.propertyType;
  return out;
}
