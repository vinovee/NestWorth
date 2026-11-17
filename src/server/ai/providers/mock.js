// @ts-check
/**
 * Demo mode: a keyword-rule "provider" that needs no API key. It lets anyone try
 * the whole app offline and makes the test suite deterministic. Its output is
 * clearly labelled as not coming from AI.
 */
import { parseAssessmentMessage } from '../prompts.js';

/** @typedef {import('./types.js').Provider} Provider */

/** @returns {Provider} */
export function createMockProvider() {
  return {
    name: 'demo',
    model: 'keyword-rules (no AI)',
    capabilities: { webSearch: false },
    async generate(req) {
      const first = req.messages[0]?.content || '';
      const { listingText, listingUrl, criteria } = parseAssessmentMessage(first);
      const assessment = heuristicAssessment(listingText, criteria || {}, listingUrl);
      return { text: JSON.stringify(assessment), stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 }, sources: [], model: 'keyword-rules (no AI)' };
    },
  };
}

/** @param {string} s */
const num = (s) => Number(String(s).replace(/,/g, ''));

/**
 * @param {string} text
 * @param {any} criteria
 * @param {string} url
 */
export function heuristicAssessment(text, criteria, url) {
  const t = text.replace(/\s+/g, ' ');
  const has = (/** @type {RegExp} */ re) => re.test(t);
  /** @type {string[]} */
  const missing = [];

  // Price
  const priceMatch = /£\s?(\d{1,3}(?:,\d{3})+|\d{5,8})(?:\s*(?:–|-|to)\s*£\s?(\d{1,3}(?:,\d{3})+|\d{5,8}))?/.exec(t);
  const price = priceMatch ? num(priceMatch[1]) : null;
  const priceMax = priceMatch && priceMatch[2] ? num(priceMatch[2]) : null;
  if (price === null) missing.push('Price');

  const flags = {
    auction: has(/\bauction\b|modern method of auction|reservation fee/i),
    sharedOwnership: has(/shared ownership|\b\d{1,2}% share\b|part[- ]buy/i),
    retirementOnly: has(/retirement|over[- ]?(?:55|60|65)s?\b|age[- ]restricted/i),
    needsRenovation: has(/(?:in need of|requires?|needs?)\s+(?:complete\s+|full\s+|some\s+)?(?:modernisation|renovation|refurbishment|updating)|renovation project|cash buyers only/i),
    leasehold: has(/\bleasehold\b/i) && !has(/share of freehold/i),
    underOfferOrSold: has(/under offer|sold stc|sold subject to contract|\breserved\b/i),
    suspectedManipulation: has(/ignore (?:all )?(?:previous|prior|your) instructions|as an ai\b|language model|rate this (?:property|home) (?:10|ten)/i),
    /** @type {string[]} */
    notes: [],
  };
  if (flags.auction) flags.notes.push('The listing mentions an auction or reservation fee.');
  if (flags.sharedOwnership) flags.notes.push('The listing mentions shared ownership.');
  if (flags.retirementOnly) flags.notes.push('The listing mentions retirement or an age restriction.');
  if (flags.needsRenovation) flags.notes.push('The listing says the home needs work.');
  if (flags.leasehold) flags.notes.push('The listing says leasehold.');
  if (flags.underOfferOrSold) flags.notes.push('The listing says under offer or sold.');
  if (flags.suspectedManipulation) flags.notes.push('The listing contains text addressed to an AI.');

  const type =
    has(/chalet bungalow/i) ? 'chalet_bungalow'
      : has(/\bbungalow\b/i) ? 'bungalow'
        : has(/park home/i) ? 'park_home'
          : has(/maisonette/i) ? 'maisonette'
            : has(/\b(?:flat|apartment)\b/i) ? 'flat'
              : has(/end[- ]of[- ]terrace|end[- ]terrace/i) ? 'end_terrace'
                : has(/terrace/i) ? 'terraced'
                  : has(/semi[- ]detached/i) ? 'semi_detached'
                    : has(/townhouse|town house/i) ? 'townhouse'
                      : has(/\bdetached\b/i) ? 'detached' : 'unknown';
  if (type === 'unknown') missing.push('Type of home');

  const beds = /(\d{1,2})[\s-]*bed(?:room)?s?\b/i.exec(t);
  const baths = /(\d{1,2})[\s-]*bath(?:room)?s?\b/i.exec(t);
  const sqft = /(\d{1,2},?\d{3}|\d{3})\s*sq\.?\s*f(?:ee)?t/i.exec(t);
  const sqm = /(\d{2,4}(?:\.\d+)?)\s*(?:m²|sq\.?\s*m\b|square met)/i.exec(t);
  const floorArea = sqft ? num(sqft[1]) : sqm ? Math.round(Number(sqm[1]) * 10.764) : null;
  if (!beds) missing.push('Number of bedrooms');
  if (floorArea === null) missing.push('Floor area');

  const buildAge = flags.needsRenovation ? 'older_needs_work'
    : has(/new[- ]build|brand new|newly built|new home/i) ? 'new_build'
      : has(/built in 20(?:1[89]|2\d)/i) ? 'near_new'
        : has(/modernised|refurbished|renovated|updated throughout/i) ? 'older_modernised' : 'unknown';
  const tenure = has(/share of freehold/i) ? 'share_of_freehold' : flags.leasehold ? 'leasehold' : has(/freehold/i) ? 'freehold' : 'unknown';
  if (tenure === 'unknown') missing.push('Tenure');

  /** The first clause (between commas or full stops) of the original text that matches. */
  /** @param {RegExp} re */
  const clause = (re) => {
    for (const line of text.split(/\r?\n/)) {
      for (const part of line.split(/[.;]\s|,\s|\s-\s/)) {
        if (re.test(part)) return part.replace(/^[\s•*-]+|[\s.]+$/g, '').slice(0, 160);
      }
    }
    return 'Not stated';
  };
  const firstLine = text.trim().split(/\r?\n/)[0] || '';
  const POSTCODE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}\b/;

  // Commute, from phrases like "12 minutes' walk to X station" and "trains to Y in 24 minutes"
  const walk = /(\d{1,2})\s*min(?:ute)?s?'?\s*walk/i.exec(t);
  const train = /trains?\s+to\s+[^.]{0,60}?\s+in\s+(?:about\s+)?(\d{1,3})\s*min/i.exec(t) || /(\d{1,3})\s*min(?:ute)?s?\s+by\s+train/i.exec(t);
  /** @type {{ mode: string, description: string, minutes: string, frequency: string }[]} */
  const legs = [];
  let minutesMin = null;
  let minutesMax = null;
  if (train) {
    const w = walk ? Number(walk[1]) : 10;
    legs.push({ mode: 'walk', description: walk ? 'Walk to the station' : 'Get to the station (time assumed)', minutes: String(w), frequency: '' });
    legs.push({ mode: 'national_rail', description: `Train towards ${criteria.destination || 'your destination'}`, minutes: train[1], frequency: 'Not stated' });
    minutesMin = w + Number(train[1]) + 5;
    minutesMax = minutesMin + 10;
  }

  const excluded = (flags.sharedOwnership && /shared/i.test(String(criteria.exclusions))) ||
    (flags.retirementOnly && /retirement/i.test(String(criteria.exclusions))) ||
    (flags.needsRenovation && /renovation/i.test(String(criteria.exclusions)));
  const overBudget = price !== null && criteria.budget && criteria.budget.max > 0 && price > criteria.budget.max;
  let overall = 6 + (buildAge === 'new_build' || buildAge === 'near_new' ? 1 : 0) - (excluded ? 4 : 0) - (overBudget ? 1.5 : 0) - (flags.suspectedManipulation ? 1 : 0);
  overall = Math.max(0, Math.min(10, overall));
  const verdict = excluded ? 'dont_buy' : price === null || minutesMin === null || overBudget || flags.auction ? 'only_if_checks_pass' : 'worth_viewing';

  const lower = t.toLowerCase();
  const wanted = [...(criteria.mustHaves || []), ...(criteria.niceToHaves || [])].slice(0, 16);
  const criteriaChecks = wanted.map((c) => {
    const words = String(c).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4);
    const hit = words.some((w) => lower.includes(w));
    return { criterion: String(c).slice(0, 120), status: hit ? 'partly' : 'unknown', note: hit ? 'The listing mentions this; check the details.' : 'Not mentioned in the listing.' };
  });

  const NOT_CHECKED = 'Not checked in demo mode.';
  return {
    listing: {
      title: `${beds ? `${beds[1]}-bed ` : ''}${type === 'unknown' ? 'home' : type.replace(/_/g, '-')}`,
      address: POSTCODE.test(firstLine) && firstLine.length <= 120 ? firstLine.trim() : 'Not stated',
      priceText: priceMatch ? priceMatch[0] : 'Not stated',
      price,
      priceMax,
      priceQualifier: has(/guide price/i) ? 'guide' : has(/offers (?:in excess of|over)/i) ? 'offers_over' : flags.auction ? 'auction_guide' : price === null ? 'unknown' : 'asking',
      propertyType: type,
      bedrooms: beds ? Number(beds[1]) : null,
      bathrooms: baths ? Number(baths[1]) : null,
      floorAreaSqft: floorArea,
      floors: null,
      tenure,
      buildAge,
      epcRating: /EPC(?: rating)?(?: of)?:?\s*([A-G])\b/i.exec(t)?.[1] || 'Not stated',
      councilTaxBand: /council tax band:?\s*([A-H])\b/i.exec(t)?.[1] || 'Not stated',
      warranty: clause(/\b(?:NHBC|LABC|Premier|ICW|Checkmate|BuildZone)\b/i),
      heating: clause(/heat pump|central heating|electric heating|underfloor heating|boiler/i),
      parking: clause(/driveway|garage|allocated parking|off[- ]street parking|parking for/i),
      garden: clause(/\bgarden\b/i),
      spaceForBuyerNeeds: 'Not checked in demo mode.',
      charges: clause(/service charge|ground rent|estate charge|management charge/i),
      agent: 'Not stated',
    },
    flags,
    commute: {
      destination: String(criteria.destination || 'Not given').slice(0, 160),
      minutesMin,
      minutesMax,
      legs,
      farePerDay: null,
      fareNote: 'Demo mode does not estimate fares; use the operator’s fare finder.',
      confidence: 'low',
    },
    ratings: { overall, liveability: 6, area: 5, value: 5 },
    areaFeel: { kind: 'unknown', note: 'Not checked in demo mode.' },
    verdict,
    verdictReason: excluded ? 'The listing matches something you have ruled out.' : verdict === 'worth_viewing' ? 'Nothing in the listing conflicts with your criteria.' : 'Key facts are missing or need checking.',
    summary: 'Demo mode: this assessment comes from simple keyword rules, not AI, so treat it as a rough first pass. Connect an AI provider to get a real assessment.',
    positives: [buildAge === 'new_build' ? 'Described as a new build.' : '', floorArea ? `About ${floorArea.toLocaleString('en-GB')} sq ft.` : ''].filter(Boolean),
    watchOuts: flags.notes.length ? flags.notes : [],
    questions: missing.map((m) => `What is the ${m.toLowerCase()}?`).slice(0, 10),
    criteria: criteriaChecks,
    liveability: { locality: NOT_CHECKED, crime: NOT_CHECKED, housingMix: NOT_CHECKED, flood: NOT_CHECKED, ground: NOT_CHECKED, other: '' },
    resale: { newBuildPremiumPct: buildAge === 'new_build' ? 8 : 0, growth5yPct: 10, growthAnnualPct: 2.5, rationale: 'Default assumptions in demo mode.' },
    missingInfo: missing.slice(0, 10),
    sources: url ? [{ title: 'The listing', url }] : [],
  };
}
