# Compliance: regulations and standards

How NestWorth's design maps to the AI laws and standards that matter most for it. Checked on 17 November 2026. Laws and guidance change: the weekly maintenance workflow flags this page for review every six months (see [`src/shared/review-dates.js`](../src/shared/review-dates.js)).

> This is engineering documentation, not legal advice. If you run NestWorth for other people or in a business, take your own advice: the obligations are yours.

## Who has obligations

| You are | What applies |
| --- | --- |
| Using NestWorth for your own home search | Personal use. The EU AI Act doesn't apply to the obligations of people using AI in a purely personal, non-professional activity (Article 2(10)), and UK data protection law has an exemption for purely personal or household activity. |
| Hosting it for other people, or using it in a business (an estate agency or relocation service, for example) | You are the deployer, and possibly the provider, of an AI system, and the controller of the personal data. Start with [Deploying NestWorth for other people](#deploying-nestworth-for-other-people). |
| This project | Publishes the source code under the MIT licence, with the measures below built in so that whoever runs it can meet their obligations. |

## EU AI Act (Regulation (EU) 2024/1689)

**Status on 17 November 2026.** The transparency obligations in Article 50 have applied since 2 August 2026. The Digital Omnibus on AI, approved by the Council on 29 June 2026, moved the high-risk obligations to 2 December 2027 (2 August 2028 for AI built into regulated products). It left Article 50 in place, apart from a grace period to 2 December 2026 for the machine-readable marking in Article 50(2) for systems already on the market before 2 August 2026. The Commission's Code of Practice on marking and labelling AI-generated content, published on 10 June 2026, is voluntary.

| Question | Assessment for NestWorth |
| --- | --- |
| A prohibited practice (Article 5)? | No. |
| High-risk (Article 6 and Annex III)? | Not as intended. It doesn't evaluate anyone's creditworthiness or eligibility for a service, or do anything else listed in Annex III: it helps a buyer assess properties. Using it to assess people is outside its intended purpose. |
| Transparency obligations (Article 50)? | Likely to apply to whoever makes it available to others: people must be told they're dealing with an AI system (Article 50(1)), and AI-generated text must be marked in a machine-readable format (Article 50(2)). |
| Covered by the open-source exception (Article 2(12))? | Not for Article 50: the exception doesn't extend to it. |
| General-purpose AI model obligations? | These fall on the model provider (Anthropic, OpenAI or whoever you use), not on NestWorth. |

What NestWorth does for Article 50:
- **Telling people.** The app says it uses AI on the welcome screen, before every assessment and on the Profile page. AI content is labelled "AI-generated"; demo mode is labelled as keyword rules.
- **Machine-readable marking.** Every assessment carries `aiDisclosure` metadata with an IPTC digital source type of `trainedAlgorithmicMedia`, in the API response, the browser's saved data and exports. Cards carry `data-ai-generated` attributes.
- **Deepfakes and public-interest text (Article 50(4)).** Not applicable: NestWorth doesn't make images, audio or video, and its text isn't published to inform the public.

## United Kingdom

**Status on 17 November 2026.** The UK has no AI-specific statute. Regulators apply existing law, guided by the government's five principles: safety, security and robustness; transparency and explainability; fairness; accountability and governance; contestability and redress. The Data (Use and Access) Act 2025 amended UK data protection law and requires the Information Commissioner's Office (ICO) to produce a statutory code of practice on AI and automated decision-making.

| Area | What NestWorth does |
| --- | --- |
| UK GDPR: data minimisation and data protection by design | Local-first storage, finances never sent, contact details removed from listings, a stateless server and logs without content. |
| Automated decision-making | Not applicable: NestWorth makes no decisions about people. Buyers make every decision about their own purchase. |
| International transfers | The listing and criteria go to the AI provider set up on the server, which may process them outside the UK. Deployers need to cover this in their privacy notice and transfer assessment. |
| Fairness and equality (Equality Act 2010) | Area-fairness rules in both prompts and an eval case. |
| Financial advice (FSMA and FCA rules) | NestWorth isn't authorised to give mortgage or financial advice and doesn't recommend products. Costs are labelled as estimates, and the app points buyers to a broker and a conveyancer. |
| Transparency, contestability and redress | Reasons and evidence for every verdict; buyers can correct facts and overrule any outcome; issues and private security reports for problems. |

## NIST AI Risk Management Framework and Generative AI Profile

Voluntary US frameworks: AI RMF 1.0 (NIST AI 100-1, January 2023) and the Generative AI Profile (NIST AI 600-1, July 2024) are the current editions, and NIST is revising the core framework.

| Function | In NestWorth |
| --- | --- |
| Govern | The [responsible AI notes](responsible-ai.md), contribution rules (prompts are code; tax rules need sources; no personal data), the security policy, review dates with a weekly maintenance workflow, and code-owner review. |
| Map | Intended purpose, users and out-of-scope uses; data flows; the classification on this page. |
| Measure | Evals (extraction, flags, verdicts, prompt injection, fair area descriptions, removal of contact details), unit and integration tests, and provenance and token use on every assessment. |
| Manage | Hard rules in code, schema validation and repair, source checks, rate and spending limits, CodeQL, Dependabot, `npm audit` and private vulnerability reporting. |

Of the twelve generative AI risks in NIST AI 600-1, these matter most here:

| Risk | Mitigation |
| --- | --- |
| Confabulation | "Not stated" for unknowns, no invented statistics, sources checked, all maths in code |
| Data privacy | Minimisation, contact-detail removal, local-first storage |
| Harmful bias and homogenisation | Area-fairness rules and eval |
| Information security | Prompt-injection defences, SSRF-safe fetching, strict CSP |
| Human-AI configuration | Labels, reasons, corrections; the buyer decides |
| Value chain and component integration | Provider choice in configuration, versioned prompts, provenance on every assessment |
| Environmental impacts | Short prompts, caching, research off by default |

## OWASP Top 10 for LLM Applications 2026

| Risk | Mitigation in NestWorth |
| --- | --- |
| LLM01 Prompt Injection | Untrusted text goes inside delimiters with a random name per request; the system prompt says it's data; attempts are flagged and the verdict capped; an eval case tests it. |
| LLM02 Sensitive Information Disclosure | Finances never sent; contact details removed; no content or secrets in logs; API keys stay on the server. |
| LLM03 Excessive Agency | No tools except optional web search; output is validated data; nothing acts on the user's behalf. Scheduled re-checks only re-read public pages the buyer added (respecting `robots.txt`) and never change a home's status. |
| LLM04 Supply Chain | No runtime dependencies; dev dependencies locked; Dependabot, `npm audit` and CodeQL. |
| LLM05 Data and Model Poisoning | No training, fine-tuning or retrieval store; web research is treated as untrusted and must be cited. |
| LLM06 Unbounded Consumption | Per-client rate limit, daily cap, concurrency cap, token limits and request size limits. Scheduled re-checks call the AI only when a listing's price or availability changed, pause between homes and stop when the server reports a limit. |
| LLM07 Misinformation | Schema, "Not stated" for unknowns, no invented figures, source checks, maths in code, labels and warnings. |
| LLM08 Hidden Context Exposure | Prompts are public in the repository, and nothing secret goes into the model's context. |
| LLM09 Vector and Embedding Weaknesses | Not applicable: no embeddings or vector store. |
| LLM10 Improper Output Handling | Output validated against a schema; the interface never inserts it as HTML; strict Content Security Policy; links limited to http and https. |

## ISO/IEC 42001:2023

ISO/IEC 42001 is a management system standard for organisations. NestWorth isn't certified, and an open-source project can't be. An organisation that runs NestWorth under its own AI management system can reuse this page, the responsible AI notes, the evals and the review dates as evidence for its own risk and impact assessments.

## Deploying NestWorth for other people

1. Serve it over HTTPS and set a long, random `APP_ACCESS_TOKEN`.
2. Publish a privacy notice. Start from [privacy-notice-template.md](privacy-notice-template.md).
3. Choose an AI provider whose data terms suit you (retention, use for training, location), accept its data processing terms, and record the international transfer.
4. Consider a data protection impact assessment, especially at scale or for vulnerable users.
5. Keep the AI labels and notices visible, and keep the `aiDisclosure` metadata.
6. Set spending limits with your AI provider as well as in the app.
7. Keep it up to date: merge Dependabot updates and work through the maintenance issues.
8. Don't use it to make decisions about people.

## Sources

Checked on 17 November 2026.
- [EU AI Act, Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj) (EUR-Lex)
- [Code of Practice on marking and labelling AI-generated content](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content) (European Commission)
- [Guidance on AI and data protection](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/artificial-intelligence/) (ICO)
- [AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) and [NIST AI 600-1](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) (NIST)
- [OWASP Top 10 for LLM Applications 2026](https://genai.owasp.org/) (OWASP GenAI Security Project)
- [Digital source type vocabulary](https://cv.iptc.org/newscodes/digitalsourcetype/) (IPTC)
