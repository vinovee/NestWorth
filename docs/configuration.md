# Configuration

The server reads environment variables, and a `.env` file in the project root if there is one (copy [`.env.example`](../.env.example)). Everything is validated at start-up; a mistake stops the server with a message saying how to fix it.

## AI provider

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic`, `openai` (any OpenAI-compatible server) or `mock` (demo mode). `npm run demo` forces `mock`. |
| `ANTHROPIC_API_KEY` | | Required for `anthropic`. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Any current Claude model ID. Run the evals after changing it. |
| `ANTHROPIC_VERSION` | `2026-10-21` | The `anthropic-version` header. |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | For gateways or proxies. |
| `OPENAI_API_KEY` | | Required for `openai`, unless the base URL is on `localhost`. |
| `OPENAI_MODEL` | | Required for `openai`. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | e.g. `http://localhost:11434/v1` for Ollama. |
| `OPENAI_MAX_TOKENS_PARAM` | `max_completion_tokens` | Some servers want `max_tokens`. |
| `WEB_RESEARCH` | `false` | Area research with web search before assessing (Anthropic only). |
| `WEB_SEARCH_MAX_USES` | `5` | Searches allowed per research step. |
| `ANTHROPIC_WEB_SEARCH_TOOL` | `web_search_20250305` | Web search tool version. |
| `LLM_MAX_TOKENS` | `16000` | Output budget; doubled automatically once if an answer is cut off. |
| `LLM_TIMEOUT_MS` | `180000` | Per call. |
| `LLM_MAX_RETRIES` | `3` | For network errors, 429 and 5xx. |

## Server and access

| Variable | Default | Notes |
|---|---|---|
| `HOST` | `127.0.0.1` | Anything else makes the app reachable from other machines. |
| `PORT` | `8787` | |
| `APP_ACCESS_TOKEN` | | Required when `HOST` isn't loopback. At least 16 characters. People enter it on the Profile page; it's kept for the browser tab only. |
| `ALLOW_UNAUTHENTICATED` | `false` | Allow a non-loopback host without a token, if something else (a VPN, a proxy with sign-in) protects it. |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate limiting. Only behind a proxy you control. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent`. |

## Spending limits

| Variable | Default | Notes |
|---|---|---|
| `RATE_LIMIT_PER_10_MIN` | `20` | Assessments per client per 10 minutes. |
| `DAILY_ASSESSMENT_LIMIT` | `200` | Across everyone, per UTC day. |
| `MAX_CONCURRENT_ASSESSMENTS` | `3` | |
| `PRICE_INPUT_PER_MTOK`, `PRICE_OUTPUT_PER_MTOK` | | Optional. Your provider's prices per million tokens, to log an estimated cost per assessment (web search fees not included). |

## Reading listing links

| Variable | Default | Notes |
|---|---|---|
| `ALLOW_LISTING_FETCH` | `true` | Set `false` to accept pasted text only. |
| `FETCH_USER_AGENT` | `NestWorthBot/0.1 (…)` | The first word is the product token matched against `robots.txt`. |

## The profile (in the browser)

The profile is stored in the browser, validated with [`PROFILE_SCHEMA`](../src/shared/profile.js), and filled from defaults when fields are missing, so older saved profiles keep working. Export it from **Profile → Your data**. See the README for what each section drives.

Purchase tax regions: `england-ni`, `scotland`, `wales`, `custom` (your own bands, the last one open-ended) and `none`. Buyer situations: `first-time`, `mover`, `mover-overlap` (you'll still own your old home at completion, so a reclaimable surcharge is paid up front) and `additional`.
