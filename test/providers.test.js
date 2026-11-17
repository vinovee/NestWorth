import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicProvider, collectSources } from '../src/server/ai/providers/anthropic.js';
import { createOpenAICompatibleProvider } from '../src/server/ai/providers/openai-compatible.js';
import { loadConfig } from '../src/server/config.js';

const config = loadConfig({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key', OPENAI_MODEL: 'gpt-test', OPENAI_API_KEY: 'k' }, []).config;
const noSleep = async () => {};

/** A fake fetch that replays responses and records requests. */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status || 200, headers: r.headers || {} });
  };
  return { impl, calls };
}

const message = (over = {}) => ({
  model: 'claude-sonnet-5-5',
  content: [{ type: 'text', text: '{"ok":true}' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 20 },
  ...over,
});

test('Anthropic: request shape uses structured output and current API version', async () => {
  const { impl, calls } = fakeFetch([{ body: message() }]);
  const p = createAnthropicProvider(config, { fetchImpl: impl, sleep: noSleep });
  const r = await p.generate({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], schema: { type: 'object' }, maxTokens: 1000 });
  assert.equal(r.text, '{"ok":true}');
  assert.equal(r.stopReason, 'end');
  assert.equal(r.usage.inputTokens, 100);
  const { url, init, body } = calls[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.headers['x-api-key'], 'test-key');
  assert.equal(init.headers['anthropic-version'], '2026-10-21');
  assert.deepEqual(body.output_config, { format: { type: 'json_schema', schema: { type: 'object' } } });
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(body.system[0].cache_control.type, 'ephemeral');
  for (const removed of ['temperature', 'top_p', 'top_k', 'tool_choice']) assert.equal(removed in body, false, removed);
});

test('Anthropic: retries overloaded responses, then succeeds', async () => {
  const { impl, calls } = fakeFetch([
    { status: 529, body: { error: { message: 'Overloaded' } } },
    { status: 429, body: { error: { message: 'slow down' } }, headers: { 'retry-after': '0' } },
    { body: message() },
  ]);
  const p = createAnthropicProvider(config, { fetchImpl: impl, sleep: noSleep });
  const r = await p.generate({ system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 100 });
  assert.equal(r.text, '{"ok":true}');
  assert.equal(calls.length, 3);
});

test('Anthropic: a bad key is not retried and gives a clear message', async () => {
  const { impl, calls } = fakeFetch([{ status: 401, body: { error: { message: 'invalid x-api-key' } } }]);
  const p = createAnthropicProvider(config, { fetchImpl: impl, sleep: noSleep });
  await assert.rejects(p.generate({ system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 100 }), { code: 'AI_AUTH' });
  assert.equal(calls.length, 1);
});

test('Anthropic: web search turns continue after pause_turn and collect sources', async () => {
  const searchBlock = { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://www.police.uk/x', title: 'Crime map' }] };
  const { impl, calls } = fakeFetch([
    { body: message({ content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } }, searchBlock], stop_reason: 'pause_turn', usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } } }) },
    { body: message({ content: [{ type: 'text', text: 'Crime is low.', citations: [{ type: 'web_search_result_location', url: 'https://flood.example.gov/y', title: 'Flood' }] }] }) },
  ]);
  const p = createAnthropicProvider(config, { fetchImpl: impl, sleep: noSleep });
  const r = await p.generate({ system: 's', messages: [{ role: 'user', content: 'research' }], maxTokens: 100, webSearch: { maxUses: 3 } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
  assert.equal(calls[1].body.messages.at(-1).role, 'assistant', 'paused content is sent back');
  assert.equal(r.text, 'Crime is low.');
  assert.equal(r.usage.webSearches, 1);
  assert.deepEqual(r.sources.map((s) => s.url), ['https://www.police.uk/x', 'https://flood.example.gov/y']);
  assert.deepEqual(collectSources([{ type: 'text', text: 'x', citations: [{ url: 'javascript:alert(1)' }] }]), []);
});

test('Anthropic: refusal and truncation are reported', async () => {
  const { impl } = fakeFetch([{ body: message({ stop_reason: 'refusal' }) }, { body: message({ stop_reason: 'max_tokens' }) }]);
  const p = createAnthropicProvider(config, { fetchImpl: impl, sleep: noSleep });
  assert.equal((await p.generate({ system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 10 })).stopReason, 'refusal');
  assert.equal((await p.generate({ system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 10 })).stopReason, 'max_tokens');
});

test('OpenAI-compatible: strict json_schema response format and parsing', async () => {
  const { impl, calls } = fakeFetch([{ body: { model: 'gpt-test', choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } } }]);
  const p = createOpenAICompatibleProvider(config, { fetchImpl: impl, sleep: noSleep });
  const r = await p.generate({ system: 'sys', messages: [{ role: 'user', content: 'x' }], schema: { type: 'object' }, schemaName: 'home_assessment', maxTokens: 500 });
  assert.equal(r.text, '{"a":1}');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.authorization, 'Bearer k');
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.equal(calls[0].body.max_completion_tokens, 500);
  assert.deepEqual(calls[0].body.response_format, { type: 'json_schema', json_schema: { name: 'home_assessment', strict: true, schema: { type: 'object' } } });
});

test('OpenAI-compatible: length and refusal map to stop reasons', async () => {
  const { impl } = fakeFetch([
    { body: { choices: [{ message: { content: '{"a"' }, finish_reason: 'length' }] } },
    { body: { choices: [{ message: { content: null, refusal: 'no' }, finish_reason: 'stop' }] } },
  ]);
  const p = createOpenAICompatibleProvider(config, { fetchImpl: impl, sleep: noSleep });
  assert.equal((await p.generate({ system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 10 })).stopReason, 'max_tokens');
  assert.equal((await p.generate({ system: 's', messages: [{ role: 'user', content: 'x' }], maxTokens: 10 })).stopReason, 'refusal');
});

test('configuration fails fast with helpful messages', () => {
  assert.match(loadConfig({ LLM_PROVIDER: 'anthropic' }, []).errors.join(' '), /ANTHROPIC_API_KEY.*npm run demo/);
  assert.match(loadConfig({ LLM_PROVIDER: 'mock', HOST: '0.0.0.0' }, []).errors.join(' '), /APP_ACCESS_TOKEN/);
  assert.deepEqual(loadConfig({ LLM_PROVIDER: 'mock', HOST: '0.0.0.0', APP_ACCESS_TOKEN: 'a-long-enough-token' }, []).errors, []);
  assert.match(loadConfig({ LLM_PROVIDER: 'mock', PORT: 'eighty' }, []).errors.join(' '), /PORT/);
  assert.equal(loadConfig({}, ['--demo']).config.provider, 'mock');
  const local = loadConfig({ LLM_PROVIDER: 'openai', OPENAI_MODEL: 'llama', OPENAI_BASE_URL: 'http://localhost:11434/v1' }, []);
  assert.deepEqual(local.errors, []);
  assert.match(loadConfig({ LLM_PROVIDER: 'mock', WEB_RESEARCH: 'true' }, []).warnings.join(' '), /WEB_RESEARCH/);
});
