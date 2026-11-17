// @ts-check
/**
 * A small validator for the subset of JSON Schema this app uses. One schema is the
 * single source of truth: it validates and cleans AI output and imported data, and
 * `toWireSchema` derives the version sent to model providers for structured output.
 *
 * Supported: type (object, array, string, number, integer, boolean, null), anyOf,
 * enum, properties, required, additionalProperties: false, items, minimum, maximum,
 * maxLength, maxItems, description.
 *
 * Policy: wrong types, missing required keys and unknown enum values are errors.
 * Overlong strings, long arrays and out-of-range numbers are repaired (trimmed or
 * clamped) and reported as warnings, so one slightly long sentence never costs a
 * whole assessment. Unknown keys are dropped with a warning.
 */

/**
 * @typedef {object} Schema
 * @property {string} [type]
 * @property {Schema[]} [anyOf]
 * @property {any[]} [enum]
 * @property {Record<string, Schema>} [properties]
 * @property {string[]} [required]
 * @property {boolean} [additionalProperties]
 * @property {Schema} [items]
 * @property {number} [minimum]
 * @property {number} [maximum]
 * @property {number} [maxLength]
 * @property {number} [maxItems]
 * @property {string} [description]
 */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} ok
 * @property {any} value       cleaned copy (only meaningful when ok)
 * @property {string[]} errors
 * @property {string[]} warnings
 */

const isPlainObject = (/** @type {unknown} */ v) =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/**
 * @param {Schema} schema
 * @param {unknown} value
 * @returns {ValidationResult}
 */
export function validate(schema, value) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const cleaned = walk(schema, value, '$', errors, warnings);
  return { ok: errors.length === 0, value: cleaned, errors, warnings };
}

/**
 * @param {Schema} s
 * @param {any} v
 * @param {string} path
 * @param {string[]} errors
 * @param {string[]} warnings
 * @returns {any}
 */
function walk(s, v, path, errors, warnings) {
  if (s.anyOf) {
    for (const option of s.anyOf) {
      /** @type {string[]} */
      const e = [];
      /** @type {string[]} */
      const w = [];
      const out = walk(option, v, path, e, w);
      if (!e.length) {
        warnings.push(...w);
        return out;
      }
    }
    errors.push(`${path}: does not match any allowed type`);
    return undefined;
  }

  switch (s.type) {
    case 'object': {
      if (!isPlainObject(v)) {
        errors.push(`${path}: expected an object`);
        return undefined;
      }
      /** @type {Record<string, any>} */
      const out = {};
      const props = s.properties || {};
      for (const key of s.required || []) {
        if (!(key in v)) errors.push(`${path}.${key}: is required`);
      }
      for (const [key, sub] of Object.entries(props)) {
        if (key in v) out[key] = walk(sub, v[key], `${path}.${key}`, errors, warnings);
      }
      for (const key of Object.keys(v)) {
        if (!(key in props)) warnings.push(`${path}.${key}: unexpected key removed`);
      }
      return out;
    }
    case 'array': {
      if (!Array.isArray(v)) {
        errors.push(`${path}: expected an array`);
        return undefined;
      }
      let items = v;
      if (typeof s.maxItems === 'number' && items.length > s.maxItems) {
        warnings.push(`${path}: trimmed from ${items.length} to ${s.maxItems} items`);
        items = items.slice(0, s.maxItems);
      }
      const itemSchema = s.items || {};
      return items.map((item, i) => walk(itemSchema, item, `${path}[${i}]`, errors, warnings));
    }
    case 'string': {
      if (typeof v !== 'string') {
        errors.push(`${path}: expected a string`);
        return undefined;
      }
      let str = v.replaceAll('\u0000', '').trim();
      if (s.enum) {
        const match = s.enum.find((e) => typeof e === 'string' && e.toLowerCase() === str.toLowerCase());
        if (match === undefined) {
          errors.push(`${path}: "${str.slice(0, 40)}" is not one of ${s.enum.join(', ')}`);
          return undefined;
        }
        return match;
      }
      if (typeof s.maxLength === 'number' && str.length > s.maxLength) {
        warnings.push(`${path}: shortened to ${s.maxLength} characters`);
        str = `${str.slice(0, Math.max(0, s.maxLength - 1)).trimEnd()}…`;
      }
      return str;
    }
    case 'number':
    case 'integer': {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push(`${path}: expected a number`);
        return undefined;
      }
      let n = v;
      if (s.type === 'integer' && !Number.isInteger(n)) {
        warnings.push(`${path}: rounded to a whole number`);
        n = Math.round(n);
      }
      if (typeof s.minimum === 'number' && n < s.minimum) {
        warnings.push(`${path}: raised to the minimum ${s.minimum}`);
        n = s.minimum;
      }
      if (typeof s.maximum === 'number' && n > s.maximum) {
        warnings.push(`${path}: lowered to the maximum ${s.maximum}`);
        n = s.maximum;
      }
      return n;
    }
    case 'boolean':
      if (typeof v !== 'boolean') {
        errors.push(`${path}: expected true or false`);
        return undefined;
      }
      return v;
    case 'null':
      if (v !== null) {
        errors.push(`${path}: expected null`);
        return undefined;
      }
      return null;
    default:
      return v;
  }
}

/**
 * The schema providers receive. Structured-output engines reject numeric ranges,
 * string lengths and item limits, so those move into the description text (the
 * model still sees them) and are enforced locally by `validate`.
 * @param {Schema} s
 * @returns {Record<string, any>}
 */
export function toWireSchema(s) {
  /** @type {string[]} */
  const hints = [];
  if (typeof s.minimum === 'number' && typeof s.maximum === 'number') hints.push(`between ${s.minimum} and ${s.maximum}`);
  else if (typeof s.minimum === 'number') hints.push(`at least ${s.minimum}`);
  else if (typeof s.maximum === 'number') hints.push(`at most ${s.maximum}`);
  if (typeof s.maxLength === 'number') hints.push(`at most ${s.maxLength} characters`);
  if (typeof s.maxItems === 'number') hints.push(`at most ${s.maxItems} items`);

  /** @type {Record<string, any>} */
  const out = {};
  if (s.description || hints.length) {
    out.description = [s.description, hints.length ? `(${hints.join('; ')})` : ''].filter(Boolean).join(' ');
  }
  if (s.anyOf) out.anyOf = s.anyOf.map(toWireSchema);
  if (s.type) out.type = s.type;
  if (s.enum) out.enum = s.enum;
  if (s.type === 'object') {
    out.properties = Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, toWireSchema(v)]));
    out.required = s.required || [];
    out.additionalProperties = false;
  }
  if (s.type === 'array') out.items = toWireSchema(s.items || {});
  return out;
}

/**
 * Count the parameters that use unions; structured-output engines limit these.
 * @param {Schema} s
 * @returns {number}
 */
export function countUnions(s) {
  let n = s.anyOf ? 1 : 0;
  if (s.anyOf) for (const a of s.anyOf) n += countUnions(a);
  for (const sub of Object.values(s.properties || {})) n += countUnions(sub);
  if (s.items) n += countUnions(s.items);
  return n;
}

/**
 * Count object properties not listed in `required` (also limited by engines).
 * @param {Schema} s
 * @returns {number}
 */
export function countOptional(s) {
  let n = 0;
  if (s.type === 'object') {
    const req = new Set(s.required || []);
    for (const [k, sub] of Object.entries(s.properties || {})) {
      if (!req.has(k)) n++;
      n += countOptional(sub);
    }
  }
  if (s.items) n += countOptional(s.items);
  if (s.anyOf) for (const a of s.anyOf) n += countOptional(a);
  return n;
}
