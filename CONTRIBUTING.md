# Contributing

Thanks for helping. Bug fixes, docs, accessibility improvements, new purchase-tax regions and eval cases are especially welcome.

## Getting started

```bash
npm install
npm run demo        # the app with demo assessments, no API key needed
npm run check       # lint, types, tests and demo evals: run before every pull request
```

## Ground rules

- **No personal data.** Never put real people's details, real listings, addresses, finances or API keys in code, tests, examples, issues or screenshots. Rewrite real cases with fictional places (Exampleton, Sampleford, Testbury…).
- **Maths in code.** Anything that must be exact goes in `src/shared/finance.js` or `policy.js` with tests, not in a prompt.
- **Prompts are code.** If you change a prompt, bump its `version`, run `npm run eval` against a real provider and paste the results in the pull request.
- **Tax rules need sources.** Add a worked example from the official source as a test, and update `RULES_LAST_CHECKED` and `docs/finance-and-tax.md`.
- **Untrusted text stays text.** Build DOM with `h()`; never use `innerHTML` with data. Keep the CSP strict: no inline scripts or styles.
- **No runtime dependencies** without discussing it first (see ADR 0003).

## Style

- JavaScript (ES modules) with JSDoc types; `// @ts-check` at the top of source files.
- Plain British English in the interface and docs: short sentences, no jargon, say what the person can do next.
- Accessible by default: real buttons and labels, keyboard support, visible focus, colour never the only signal.

## Pull requests

Keep them focused. Describe what changed and why, how you tested it, and any eval results. The CI must pass.
