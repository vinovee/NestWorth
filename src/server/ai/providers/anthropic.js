// @ts-check
/**
 * Claude via the Messages API, called directly over HTTPS (no SDK, no runtime
 * dependencies). Structured output uses `output_config.format` with a JSON schema;
 * web research uses Anthropic's server-side web search tool in a separate call,
 * because citations and structured output can't be combined in one request.
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
export function createAnthropicProvider(config, deps = {}) {
  const a = config.anthropic;
  const url = `${a.baseUrl}/v1/messages`;

  /** @param {any} body @param {AbortSignal | undefined} signal */
  const call = (body, signal) =>
    postJson({
      url,
      headers: { 'x-api-key': a.apiKey, 'anthropic-version': a.version },
      body,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      providerLabel: 'Anthropic',
      signal,
      fetchImpl: deps.fetchImpl,
      sleep: deps.sleep,
      log: deps.log,
    });

  return {
    name: 'anthropic',
    model: a.model,
    capabilities: { webSearch: true },

    /** @param {GenerateRequest} req @returns {Promise<GenerateResult>} */
    async generate(req) {
      /** @type {Record<string, any>} */
      const body = {
        model: a.model,
        max_tokens: req.maxTokens,
        // A stable system prompt is cached between assessments to save cost.
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (req.schema) body.output_config = { format: { type: 'json_schema', schema: req.schema } };
      if (req.webSearch) body.tools = [{ type: a.webSearchTool, name: 'web_search', max_uses: req.webSearch.maxUses }];

      /** @type {any[]} */
      const content = [];
      const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, webSearches: 0 };
      let data;
      // Server tools can pause a long turn; send it back as-is to let Claude continue.
      for (let turn = 0; turn < 4; turn++) {
        const messages = turn === 0 ? body.messages : [...body.messages, { role: 'assistant', content }];
        data = await call({ ...body, messages }, req.signal);
        content.push(...(Array.isArray(data.content) ? data.content : []));
        usage.inputTokens += data.usage?.input_tokens || 0;
        usage.outputTokens += data.usage?.output_tokens || 0;
        usage.cacheReadTokens += data.usage?.cache_read_input_tokens || 0;
        usage.webSearches += data.usage?.server_tool_use?.web_search_requests || 0;
        if (data.stop_reason !== 'pause_turn') break;
      }

      const text = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
      return {
        text,
        stopReason: mapStop(data?.stop_reason),
        usage,
        sources: collectSources(content),
        model: typeof data?.model === 'string' ? data.model : a.model,
      };
    },
  };
}

/** @param {unknown} reason */
function mapStop(reason) {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'end';
  if (reason === 'max_tokens') return 'max_tokens';
  if (reason === 'refusal') return 'refusal';
  return 'other';
}

/**
 * Every page web search returned, plus every page cited in the text.
 * @param {any[]} content
 */
export function collectSources(content) {
  /** @type {Map<string, { url: string, title: string }>} */
  const found = new Map();
  /** @param {any} url @param {any} title */
  const add = (url, title) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url) && !found.has(url)) {
      found.set(url, { url, title: typeof title === 'string' ? title : url });
    }
  };
  for (const block of content) {
    if (block?.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) if (r?.type === 'web_search_result') add(r.url, r.title);
    }
    if (block?.type === 'text' && Array.isArray(block.citations)) {
      for (const c of block.citations) add(c?.url, c?.title);
    }
  }
  return [...found.values()];
}
