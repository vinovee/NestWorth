# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [0.2.0] - 2026-11-17

### Added
- Scheduled refresh: homes added by link are re-checked every week (or every day, or never) while the app is open. Price changes, offers and withdrawn listings appear on the dashboard and on the home; the AI runs again only when the price or availability changed. New endpoint: `POST /api/refresh`.
- A weekly Maintenance workflow: every check on the newest Node LTS, `npm audit`, and a review-date report that opens a `maintenance` issue when tax rules, AI defaults, the compliance mapping or the minimum Node version are due for review (`npm run maintenance`).
- AI transparency: "AI-generated" labels, and machine-readable `aiDisclosure` metadata with an IPTC digital source type on every assessment, saved and exported.
- Data minimisation: phone numbers and email addresses are removed from listings before they reach the AI.
- Fairness rules in both prompts, and an `area-fairness` eval case.
- `docs/responsible-ai.md`, `docs/compliance.md` and `docs/privacy-notice-template.md`.
- `CODEOWNERS`, and package metadata pointing at the repository.

### Changed
- The `assess-listing` and `research-area` prompts are now version 2.
- The container image runs Node 26 LTS; CI tests Node 22, 24 and 26 and uses GitHub Actions v7.

## [0.1.0] - 2026-11-17

First open-source release, generalised from a single-user dashboard.

### Added
- Profile inputs for commute, budget, sale, cash, mortgage rate bands, purchase tax, criteria, exclusions and resale assumptions.
- AI assessment of listings (pasted or linked) with structured output, validation, repair, source checking and provenance.
- Providers: Anthropic Claude (with optional web research), OpenAI-compatible servers, and a demo mode.
- Purchase tax for England and Northern Ireland, Scotland and Wales, plus custom bands.
- The buyer's hard rules applied in code; dashboard, review queue, homes deck, chart, notes, ratings and ruled-out reasons.
- Local-first storage with export and import.
- Security: access token, rate limits, CSP, SSRF-safe fetching, robots.txt.
- Tests, evals, CI, CodeQL, Dependabot and a container image.
