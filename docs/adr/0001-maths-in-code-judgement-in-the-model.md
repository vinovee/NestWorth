# 1. Maths in code, judgement in the model

Status: accepted

## Context

A home-buying assistant has to do two different kinds of work. Some is exact and high-stakes: purchase tax, deposits, loan-to-value, monthly repayments and whether a home breaks a hard rule. Some is fuzzy: reading a listing written as marketing, noticing what's missing, judging whether a home suits a family and spotting risks.

Language models are good at the second kind and unreliable at the first: they can produce plausible arithmetic that is wrong, and they can be talked out of a rule by persuasive text in a listing.

## Decision

- The model extracts facts and gives judgement, returned as JSON that must match a schema.
- Every calculation runs in `src/shared/finance.js`, as pure, tested functions.
- The buyer's hard rules run in `src/shared/policy.js`. They can only make the model's verdict stricter, and each change is shown with its reason.
- The model is given a derived price limit rather than the buyer's finances, and told not to do affordability arithmetic.

## Consequences

- Numbers are reproducible and testable, and change instantly when the profile changes, without new AI calls.
- A manipulated or mistaken assessment can't push an excluded or unaffordable home to "Worth viewing".
- The rules are deliberately simple; nuance stays in the model's summary and watch-outs.
