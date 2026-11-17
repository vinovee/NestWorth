// @ts-check
/**
 * Any OpenAI-compatible Chat Completions API: OpenAI itself, or a local model
 * server such as Ollama or LM Studio (set OPENAI_BASE_URL). Structured output uses
 * `response_format: json_schema` with `strict: true`. No web research.
 */
import { postJson } from '../http-retry.js';

/** @typedef {import('./types.js').Provider} Provider */
/** @typedef {import('./types.js').GenerateRequest} GenerateRequest */
/** @typedef {import('./types.js').GenerateResult} GenerateResult */

/**
 * @param {import('../../config.js').Config} config
 * @param {{ fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, log?: import('../../logger.js').Logger }} [deps]
 * @returns {Provider}
 */
export function createOpenAICompatibleProvider(config, deps = {}) {
  const o = config.openai;
  return {
    name: 'openai-compatible',
    model: o.model,
    capabilities: { webSearch: false },

    /** @param {GenerateRequest} req @returns {Promise<GenerateResult>} */
    async generate(req) {
      /** @type {Record<string, any>} */
      const body = {
        model: o.model,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
        [o.maxTokensParam]: req.maxTokens,
      };
      if (req.schema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: req.schemaName || 'output', strict: true, schema: req.schema },
        };
      }
      const data = await postJson({
        url: `${o.baseUrl}/chat/completions`,
        headers: { authorization: `Bearer ${o.apiKey}` },
        body,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        providerLabel: 'The AI provider',
        signal: req.signal,
        fetchImpl: deps.fetchImpl,
        sleep: deps.sleep,
        log: deps.log,
      });
      const choice = data?.choices?.[0] || {};
      const msg = choice.message || {};
      const usage = { inputTokens: data?.usage?.prompt_tokens || 0, outputTokens: data?.usage?.completion_tokens || 0 };
      if (msg.refusal) return { text: '', stopReason: 'refusal', usage, sources: [], model: data?.model || o.model };
      const text = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content) ? msg.content.map((/** @type {any} */ p) => p?.text || '').join('') : '';
      const finish = choice.finish_reason;
      return {
        text,
        stopReason: finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'end',
        usage,
        sources: [],
        model: typeof data?.model === 'string' ? data.model : o.model,
      };
    },
  };
}
