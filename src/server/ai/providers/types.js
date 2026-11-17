// @ts-check
/**
 * The provider interface. Adding a provider means implementing `generate`.
 *
 * @typedef {object} GenerateRequest
 * @property {string} system
 * @property {{ role: 'user' | 'assistant', content: string }[]} messages  must end with a user message
 * @property {Record<string, any>} [schema]   JSON schema (wire form) for structured output
 * @property {string} [schemaName]
 * @property {number} maxTokens
 * @property {{ maxUses: number }} [webSearch]  only when capabilities.webSearch is true
 * @property {AbortSignal} [signal]
 *
 * @typedef {object} GenerateResult
 * @property {string} text
 * @property {'end' | 'max_tokens' | 'refusal' | 'other'} stopReason
 * @property {{ inputTokens: number, outputTokens: number, cacheReadTokens?: number, webSearches?: number }} usage
 * @property {{ url: string, title: string }[]} sources  pages the provider actually retrieved
 * @property {string} model
 *
 * @typedef {object} Provider
 * @property {string} name
 * @property {string} model
 * @property {{ webSearch: boolean }} capabilities
 * @property {(req: GenerateRequest) => Promise<GenerateResult>} generate
 */
export {};
