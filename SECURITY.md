# Security policy

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue: use **[Report a vulnerability](https://github.com/vinovee/NestWorth/security/advisories/new)** on this repository's Security tab ([how private reporting works](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)). Include what you found, how to reproduce it and what an attacker could do with it. We aim to acknowledge reports within a week.

## Scope

In scope: the server (`src/server`), the web app (`src/web`), shared code and the default configuration. Examples: server-side request forgery through listing links, bypassing the access token or rate limits, script injection through listing or AI text, leaking criteria or keys into logs, and prompt injection that leads to anything beyond a misleading assessment.

Out of scope: problems that need an attacker to already control your server, your browser or your AI provider account; and the accuracy of AI assessments (please open a normal issue, without personal details).

## How the app protects you

- Binds to `127.0.0.1` by default; a non-loopback host requires `APP_ACCESS_TOKEN`.
- Same-origin checks on the API, JSON-only bodies with a size limit, per-client rate limits, a daily cap and a concurrency cap.
- A strict Content Security Policy and DOM building that never inserts untrusted text as HTML.
- Listing fetches limited to public addresses (checked at connection time and on each redirect), standard ports, size and time limits, and `robots.txt`.
- Untrusted text is delimited per request and treated as data; manipulation attempts are flagged and capped.
- No secrets in logs; no data stored on the server.

## Keeping your deployment safe

- Keep your API key in `.env` (never commit it) or your platform's secret store.
- Put a shared deployment behind HTTPS and set a long, random `APP_ACCESS_TOKEN`.
- Set spending limits with your AI provider as well as in the app.
- Keep Node and the container base image up to date.
