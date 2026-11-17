# Responsible AI: NestWorth's AI system card

What NestWorth's AI does, what it doesn't, and how it is kept useful, honest, fair and safe. For how this maps to laws and standards, see [compliance.md](compliance.md). Last reviewed on 17 November 2026.

## Intended purpose

NestWorth helps a person buying a home to assess property listings against their own criteria and finances, and to keep track of their shortlist. The AI reads a listing (and, if switched on, web research about its area) and returns a structured assessment: key facts, a commute estimate, ratings, a verdict with reasons, what's good, what to watch, questions for the agent and a check of each of the buyer's criteria.

## Intended users

People searching for a home for themselves, running NestWorth on their own computer or on a server they control. Purchase tax rules are built in for England, Northern Ireland, Scotland and Wales; elsewhere, buyers enter their own bands.

## Out of scope

Don't use NestWorth:
- to make or support decisions about people, such as tenants, buyers, borrowers or employees;
- to assess anyone's creditworthiness, or their eligibility for a mortgage, insurance or housing;
- as mortgage, financial, legal or survey advice. It gives estimates for comparing homes and points buyers to a broker, a conveyancer and a surveyor;
- to profile neighbourhoods by who lives in them.

## Who does what

| Step | Done by |
| --- | --- |
| Reading the listing and judging fit | The AI, constrained to a JSON schema |
| Researching the area (optional) | The AI with web search (Anthropic only) |
| Purchase tax, deposit, mortgage, fares and resale | Tested code ([finance.js](../src/shared/finance.js)) |
| The buyer's hard rules | Code ([policy.js](../src/shared/policy.js)), which can only make a verdict stricter |
| Every decision about the home | The buyer |

The AI can't act on anyone's behalf. It can't send messages, spend money or change anything. Its only tool is web search during the optional research step, and everything it returns is data that the app validates before showing it.

## Human oversight

- Every verdict comes with its reasons, the evidence for each criterion, and any change the buyer's own rules made to it.
- The buyer can correct any key fact. Costs, rules and verdicts update straight away.
- The buyer decides what happens to each home: shortlist, view, offer or rule out.
- Assessments run when the buyer asks for one, and when a scheduled re-check (weekly by default; daily or off in the profile) finds that a listing the buyer added by link has changed its price or availability. Re-checks never change a home's status, notes or the buyer's corrections, and a listing that may have been withdrawn is flagged for the buyer to decide, not ruled out automatically.

## Transparency

- The app says it uses AI on the welcome screen, in the Add a home dialog and on the Profile page.
- "The AI's take" on every home is labelled **AI-generated**. Demo mode is labelled as keyword rules, and homes added by hand as such.
- Every home shows the model, prompt version, date, sources, token use and any warnings.
- **Machine-readable marking.** Each assessment carries `aiDisclosure` metadata: `aiGenerated`, an [IPTC digital source type](https://cv.iptc.org/newscodes/digitalsourcetype/) (`trainedAlgorithmicMedia` for AI, `algorithmicMedia` for demo mode) and the generator. It's in the API response, the browser's saved data and every export. Cards carry matching `data-ai-generated` and `data-digital-source-type` attributes.

## Data and privacy

- **Local-first.** The profile, homes and notes stay in the browser. The server stores nothing.
- **Minimisation.** The AI receives the listing and the buyer's criteria with a derived price limit. It never receives the sale price, mortgage balance or savings.
- **Contact details removed.** Phone numbers and email addresses in a listing are removed before it's sent to the AI, and the card says how many were removed.
- **Logs without content.** Server logs hold timings, token counts and error codes, never listing text, criteria or keys.
- **The provider's terms apply** to what is sent. NestWorth doesn't train models; check your AI provider's terms on retention and training.

## Fairness

- The prompts tell the AI to judge an area by the place (transport, amenities, published school results, recorded crime, flood risk, development and prices), never by the race, ethnicity, nationality, religion or any other protected characteristic of the people who live there, or by stand-ins for them.
- Places of worship, schools and shops are amenities: the AI gives distances and journey times, not descriptions of residents.
- The `area-fairness` eval checks this on a listing that mentions several places of worship.

## Accuracy and limitations

- AI can be wrong. It can misread facts, misjudge a commute or miss a risk.
- Facts not in the listing are marked "Not stated". The AI isn't allowed to invent statistics, and source links it wasn't given are removed.
- Commute times and fares are estimates unless web research is on.
- Resale figures are scenarios, not valuations. Ratings are judgements from listing text, not inspections.

## Security

Listings and web pages are untrusted. They're wrapped in delimiters with a random name for each request and treated as data; attempts to steer the AI are flagged, and the verdict is capped. See [SECURITY.md](../SECURITY.md) and the OWASP mapping in [compliance.md](compliance.md).

## Evaluation

`npm run eval` runs fictional listings through the real pipeline and checks extraction, flags, final verdicts, prompt-injection handling, fair area descriptions and the removal of contact details. CI runs the same cases in demo mode on every change. Run them against your own provider before changing a prompt, the schema or the model, and keep the results.

## Versioning and records

Prompts are versioned files in [`prompts/`](../prompts/). Every assessment records the provider, model, prompt version, schema version, date, sources, token use and warnings.

## Environmental impact

Prompts are short, the fixed system prompt is cached between assessments and web research is off by default. Scheduled re-checks read the listing page and only call the AI when the price or availability has changed, and they can be switched off.

## Feedback

Report a wrong or unfair assessment in an [issue](https://github.com/vinovee/NestWorth/issues/new/choose), without personal details. Report security problems privately, as described in [SECURITY.md](../SECURITY.md).
