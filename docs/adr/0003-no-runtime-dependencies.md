# 3. No runtime dependencies and no build step

Status: accepted

## Context

The app calls an AI provider over HTTPS, serves a handful of files and fetches web pages. Modern Node (22+) and browsers provide `fetch`, ES modules, `AbortSignal.timeout`, `net.BlockList`, native `<dialog>` and `structuredClone`.

Each dependency adds supply-chain risk, upgrade work and code a contributor has to understand. A bundler adds a build step between the code you read and the code that runs.

## Decision

- No runtime dependencies. Provider APIs are called directly with `fetch`.
- The browser loads the same ES modules the tests import, with no bundling.
- Code is JavaScript with JSDoc types, checked by TypeScript in strict mode in CI.
- Dev dependencies are limited to ESLint, TypeScript and Node type definitions.

## Consequences

- `git clone` then `npm run demo` works without installing anything.
- Provider SDK conveniences (automatic retries, typed responses) are reimplemented in a small, tested module (`src/server/ai/http-retry.js`).
- If the UI grows much larger, a framework and build step may become worth their cost; this decision should be revisited then.
