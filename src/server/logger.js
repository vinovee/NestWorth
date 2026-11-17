// @ts-check
/**
 * Structured JSON logs on stdout. Never log listing text, criteria or API keys:
 * callers pass identifiers, counts, timings and token usage only.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * @param {string} [level]
 * @param {(line: string) => void} [write]
 */
export function createLogger(level = 'info', write = (line) => process.stdout.write(`${line}\n`)) {
  const min = /** @type {Record<string, number>} */ (LEVELS)[level] ?? LEVELS.info;
  /** @param {keyof typeof LEVELS} lvl @param {string} msg @param {Record<string, unknown>} [fields] */
  const log = (lvl, msg, fields = {}) => {
    if (LEVELS[lvl] < min) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields }));
  };
  return {
    debug: (/** @type {string} */ m, /** @type {Record<string, unknown>} */ f = {}) => log('debug', m, f),
    info: (/** @type {string} */ m, /** @type {Record<string, unknown>} */ f = {}) => log('info', m, f),
    warn: (/** @type {string} */ m, /** @type {Record<string, unknown>} */ f = {}) => log('warn', m, f),
    error: (/** @type {string} */ m, /** @type {Record<string, unknown>} */ f = {}) => log('error', m, f),
  };
}

/** @typedef {ReturnType<typeof createLogger>} Logger */
