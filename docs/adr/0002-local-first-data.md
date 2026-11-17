# 2. Local-first data, stateless server

Status: accepted

## Context

A home search involves sensitive information: income-related limits, sale price, mortgage balance, savings, addresses being considered, notes from viewings. The app should be usable by anyone without creating an account or trusting a hosted database.

## Decision

- The browser stores the profile, homes and notes in `localStorage`, with export and import.
- The server keeps no state. Each assessment request carries the listing and the minimum criteria needed.
- Sale price, mortgage balance and savings never leave the browser.
- Imported files are treated as untrusted and validated before use.

## Consequences

- No accounts, no database, nothing to breach on the server.
- Data is per browser. Moving devices means export and import; clearing site data deletes it. Optional sync is a possible future feature, and would need encryption and authentication.
- The server can be shared safely with an access token, because it holds nobody's data.
