// @ts-check
import { createAnthropicProvider } from './anthropic.js';
import { createOpenAICompatibleProvider } from './openai-compatible.js';
import { createMockProvider } from './mock.js';

/**
 * @param {import('../../config.js').Config} config
 * @param {{ fetchImpl?: typeof fetch, log?: import('../../logger.js').Logger }} [deps]
 * @returns {import('./types.js').Provider}
 */
export function createProvider(config, deps = {}) {
  if (config.provider === 'anthropic') return createAnthropicProvider(config, deps);
  if (config.provider === 'openai') return createOpenAICompatibleProvider(config, deps);
  return createMockProvider();
}
