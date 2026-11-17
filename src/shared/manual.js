// @ts-check
/**
 * Build a schema-valid assessment for a home entered by hand, without AI. Every
 * unknown is explicit, so the buyer's rules and the money maths still work.
 */
import { PROPERTY_TYPES } from './schema.js';

/**
 * @param {{ title: string, address: string, url: string, price: number | null, priceMax: number | null,
 *   propertyType: string, bedrooms: number | null, minutesMin: number | null, minutesMax: number | null,
 *   farePerDay: number | null, notes: string, destination: string }} f
 */
export function manualAssessment(f) {
  const NS = 'Not stated';
  const type = PROPERTY_TYPES.includes(f.propertyType) ? f.propertyType : 'unknown';
  const minutesMin = f.minutesMin ?? f.minutesMax ?? null;
  const minutesMax = f.minutesMax ?? f.minutesMin ?? null;
  return {
    listing: {
      title: (f.title || f.address || 'Home added by hand').slice(0, 160),
      address: (f.address || NS).slice(0, 200),
      priceText: f.price ? `£${f.price.toLocaleString('en-GB')}${f.priceMax ? `–£${f.priceMax.toLocaleString('en-GB')}` : ''}` : NS,
      price: f.price,
      priceMax: f.priceMax,
      priceQualifier: f.price ? 'asking' : 'unknown',
      propertyType: type,
      bedrooms: f.bedrooms,
      bathrooms: null,
      floorAreaSqft: null,
      floors: null,
      tenure: 'unknown',
      buildAge: 'unknown',
      epcRating: NS,
      councilTaxBand: NS,
      warranty: NS,
      heating: NS,
      parking: NS,
      garden: NS,
      spaceForBuyerNeeds: NS,
      charges: NS,
      agent: NS,
    },
    flags: {
      auction: false, sharedOwnership: false, retirementOnly: false, needsRenovation: false,
      leasehold: false, underOfferOrSold: false, suspectedManipulation: false, notes: [],
    },
    commute: {
      destination: (f.destination || NS).slice(0, 160),
      minutesMin,
      minutesMax,
      legs: [],
      farePerDay: f.farePerDay,
      fareNote: f.farePerDay === null ? 'Not entered.' : 'Entered by you.',
      confidence: minutesMin === null ? 'low' : 'medium',
    },
    ratings: { overall: 5, liveability: 5, area: 5, value: 5 },
    areaFeel: { kind: 'unknown', note: 'Not assessed.' },
    verdict: 'only_if_checks_pass',
    verdictReason: 'Added by hand, so nothing has been checked yet.',
    summary: f.notes ? f.notes.slice(0, 1200) : 'Added by hand. Assess it with AI, or add your own notes, to fill in the details.',
    positives: [],
    watchOuts: [],
    questions: [],
    criteria: [],
    liveability: { locality: 'Not checked.', crime: 'Not checked.', housingMix: 'Not checked.', flood: 'Not checked.', ground: 'Not checked.', other: '' },
    resale: { newBuildPremiumPct: 0, growth5yPct: 10, growthAnnualPct: 2.5, rationale: 'Default assumptions for a home added by hand.' },
    missingInfo: [],
    sources: f.url ? [{ title: 'The listing', url: f.url }] : [],
  };
}
