# Changelog

All notable changes are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

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
