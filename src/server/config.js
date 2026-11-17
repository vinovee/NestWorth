// @ts-check
/**
 * Configuration comes from environment variables (see .env.example). Everything is
 * validated at start-up so mistakes fail loudly and early, with a fix in the message.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * @typedef {object} Config
 * @property {string} host
 * @property {number} port
 * @property {'anthropic' | 'openai' | 'mock'} provider
 * @property {{ apiKey: string, model: string, baseUrl: string, version: string, webSearchTool: string, webSearchMaxUses: number }} anthropic
 * @property {{ apiKey: string, model: string, baseUrl: string, maxTokensParam: string }} openai
 * @property {number} maxTokens
 * @property {number} timeoutMs
 * @property {number} maxRetries
 * @property {boolean} webResearch
 * @property {string} accessToken
 * @property {{ windowMs: number, max: number }} rateLimit
 * @property {number} dailyLimit
 * @property {number} maxConcurrent
 * @property {boolean} allowListingFetch
 * @property {string} userAgent
 * @property {boolean} trustProxy
 * @property {string} logLevel
 * @property {{ inputPerMTok: number, outputPerMTok: number }} pricing
 * @property {{ root: string, web: string, shared: string, prompts: string }} paths
 * @property {string} version
 */

/** Load a .env file from the project root if there is one (Node 22+). */
export function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string[]} argv
 * @returns {{ config: Config, errors: string[], warnings: string[] }}
 */
export function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  /** @param {string} name @param {number} fallback @param {number} min @param {number} max */
  const int = (name, fallback, min, max) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`${name} must be a whole number from ${min} to ${max} (got "${raw}").`);
      return fallback;
    }
    return n;
  };
  /** @param {string} name @param {number} fallback */
  const float = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      errors.push(`${name} must be a number (got "${raw}").`);
      return fallback;
    }
    return n;
  };
  /** @param {string} name @param {boolean} fallback */
  const bool = (name, fallback) => {
    const raw = (env[name] || '').trim().toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    errors.push(`${name} must be true or false (got "${env[name]}").`);
    return fallback;
  };
  /** @param {string} name @param {string} fallback */
  const str = (name, fallback) => (env[name] || '').trim() || fallback;

  const demo = argv.includes('--demo');
  const providerRaw = demo ? 'mock' : str('LLM_PROVIDER', 'anthropic').toLowerCase();
  if (!['anthropic', 'openai', 'mock'].includes(providerRaw)) {
    errors.push(`LLM_PROVIDER must be anthropic, openai or mock (got "${providerRaw}").`);
  }
  const provider = /** @type {Config['provider']} */ (['anthropic', 'openai', 'mock'].includes(providerRaw) ? providerRaw : 'mock');

  const host = str('HOST', '127.0.0.1');
  const accessToken = str('APP_ACCESS_TOKEN', '');
  const allowUnauthenticated = bool('ALLOW_UNAUTHENTICATED', false);

  /** @type {Config} */
  const config = {
    host,
    port: int('PORT', 8787, 1, 65535),
    provider,
    anthropic: {
      apiKey: str('ANTHROPIC_API_KEY', ''),
      model: str('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
      baseUrl: str('ANTHROPIC_BASE_URL', 'https://api.anthropic.com').replace(/\/+$/, ''),
      version: str('ANTHROPIC_VERSION', '2026-10-21'),
      webSearchTool: str('ANTHROPIC_WEB_SEARCH_TOOL', 'web_search_20250305'),
      webSearchMaxUses: int('WEB_SEARCH_MAX_USES', 5, 1, 20),
    },
    openai: {
      apiKey: str('OPENAI_API_KEY', ''),
      model: str('OPENAI_MODEL', ''),
      baseUrl: str('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, ''),
      maxTokensParam: str('OPENAI_MAX_TOKENS_PARAM', 'max_completion_tokens'),
    },
    maxTokens: int('LLM_MAX_TOKENS', 16000, 1000, 128000),
    timeoutMs: int('LLM_TIMEOUT_MS', 180000, 5000, 900000),
    maxRetries: int('LLM_MAX_RETRIES', 3, 0, 8),
    webResearch: bool('WEB_RESEARCH', false),
    accessToken,
    rateLimit: { windowMs: 10 * 60 * 1000, max: int('RATE_LIMIT_PER_10_MIN', 20, 1, 10000) },
    dailyLimit: int('DAILY_ASSESSMENT_LIMIT', 200, 1, 1000000),
    maxConcurrent: int('MAX_CONCURRENT_ASSESSMENTS', 3, 1, 100),
    allowListingFetch: bool('ALLOW_LISTING_FETCH', true),
    userAgent: str('FETCH_USER_AGENT', 'NestWorthBot/0.1 (+https://github.com/vinovee/NestWorth; self-hosted home search; respects robots.txt)'),
    trustProxy: bool('TRUST_PROXY', false),
    logLevel: str('LOG_LEVEL', 'info'),
    pricing: { inputPerMTok: float('PRICE_INPUT_PER_MTOK', 0), outputPerMTok: float('PRICE_OUTPUT_PER_MTOK', 0) },
    paths: {
      root: ROOT,
      web: path.join(ROOT, 'src', 'web'),
      shared: path.join(ROOT, 'src', 'shared'),
      prompts: path.join(ROOT, 'prompts'),
    },
    version: '0.1.0',
  };

  if (provider === 'anthropic' && !config.anthropic.apiKey) {
    errors.push('ANTHROPIC_API_KEY is not set. Add it to .env, or run "npm run demo" to try the app without AI.');
  }
  if (provider === 'openai') {
    if (!config.openai.model) errors.push('OPENAI_MODEL is not set.');
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(`${config.openai.baseUrl}/`);
    if (!config.openai.apiKey && !local) errors.push('OPENAI_API_KEY is not set.');
    if (!config.openai.apiKey && local) config.openai.apiKey = 'local';
  }
  if (config.webResearch && provider !== 'anthropic') {
    warnings.push('WEB_RESEARCH only works with LLM_PROVIDER=anthropic, so it is off.');
    config.webResearch = false;
  }
  if (!LOOPBACK.has(host) && !accessToken && !allowUnauthenticated) {
    errors.push(`HOST is ${host}, which makes the app reachable from other machines. Set APP_ACCESS_TOKEN so only people with the token can spend your AI credits, or set ALLOW_UNAUTHENTICATED=true if something else protects it.`);
  }
  if (accessToken && accessToken.length < 16) errors.push('APP_ACCESS_TOKEN should be at least 16 characters.');
  if (config.openai.maxTokensParam !== 'max_completion_tokens' && config.openai.maxTokensParam !== 'max_tokens') {
    errors.push('OPENAI_MAX_TOKENS_PARAM must be max_completion_tokens or max_tokens.');
  }
  return { config, errors, warnings };
}
