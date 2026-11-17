# Finance and tax

All money in the app comes from [`src/shared/finance.js`](../src/shared/finance.js): pure functions with worked-example tests. These are estimates for comparing homes, not advice; a mortgage broker and a conveyancer should confirm the real figures.

## Cash for the purchase

```
equity  = expected sale price − mortgage to repay − agent fee (× 1.2 if VAT applies) − legal fees − other costs
cash    = equity (if selling) + savings
deposit = cash − purchase tax − buying costs
loan    = price − deposit
LTV     = loan ÷ price
rate    = the rate of the smallest LTV band that covers the LTV (none if the LTV is above every band)
monthly = loan × r ÷ (1 − (1 + r)^−n), with r the monthly rate and n the number of months
```

If the cash doesn't cover tax and buying costs, or the LTV is above the highest band you entered, there is no monthly figure and the home is marked "Don't buy" by your rules.

**Price limits** (dashboard and profile) are found by searching for the highest price, to the nearest £1,000, at which the monthly payment stays within your ceiling, or the deposit stays at or above 10%.

**Sensitivities** show how the monthly payment changes with £10,000 off the price, £10,000 more on your sale, and 0.5 points on the rate.

## Purchase tax

Rates were last checked on **17 November 2026** (`RULES_LAST_CHECKED` in [`tax-rules.js`](../src/shared/tax-rules.js)). Taxes are rounded down to whole pounds.

### England and Northern Ireland: Stamp Duty Land Tax (from 1 April 2025)

| Portion of the price | Rate |
|---|---|
| Up to £125,000 | 0% |
| £125,001 to £250,000 | 2% |
| £250,001 to £925,000 | 5% |
| £925,001 to £1.5 million | 10% |
| Above £1.5 million | 12% |

- First-time buyers: 0% up to £300,000 and 5% from £300,001 to £500,000; no relief above £500,000.
- Additional dwellings, including a replacement home bought before the old one is sold: 5 points on every band, for purchases of £40,000 or more. When replacing a main home, this can usually be reclaimed if the previous home is sold within the time limit.
- Non-UK residents: 2 points on every band.

### Scotland: Land and Buildings Transaction Tax (bands from 1 April 2021, unchanged for 2026–27)

| Portion of the price | Rate |
|---|---|
| Up to £145,000 | 0% |
| £145,001 to £250,000 | 2% |
| £250,001 to £325,000 | 5% |
| £325,001 to £750,000 | 10% |
| Above £750,000 | 12% |

- First-time buyer relief raises the nil band to £175,000 (worth up to £600).
- Additional Dwelling Supplement: 8% of the whole price (from 5 December 2024), for £40,000 or more.

### Wales: Land Transaction Tax (main rates from 10 October 2022, unchanged for 2026–27)

| Portion of the price | Main rates | Higher rates (from 11 December 2024) |
|---|---|---|
| Up to £180,000 | 0% | 5% |
| £180,001 to £225,000 | 0% | 8.5% |
| £225,001 to £250,000 | 6% | 8.5% |
| £250,001 to £400,000 | 6% | 10% |
| £400,001 to £750,000 | 7.5% | 12.5% |
| £750,001 to £1.5 million | 10% | 15% |
| Above £1.5 million | 12% | 17% |

Wales has no first-time buyer relief.

### Sources

- GOV.UK, [Annex A: rates and allowances](https://www.gov.uk/government/publications/budget-2025-overview-of-tax-legislation-and-rates-ootlar/annex-a-rates-and-allowances); [Stamp Duty Land Tax relief](https://www.gov.uk/guidance/stamp-duty-land-tax-relief-for-land-or-property-transactions); [Higher rates of SDLT](https://www.gov.uk/guidance/stamp-duty-land-tax-buying-an-additional-residential-property); [HMRC calculators](https://www.gov.uk/stamp-duty-land-tax-calculators)
- Revenue Scotland, [Residential property rates and bands](https://revenue.scot/taxes/land-buildings-transaction-tax/residential-property) and [LBTT updates](https://revenue.scot/taxes/land-buildings-transaction-tax/lbtt-updates); Scottish Government, [Scottish Budget 2026 to 2027: tax policy](https://www.gov.scot/publications/scottish-budget-2026-2027/pages/4/)
- Welsh Government, [Land Transaction Tax rates and bands](https://www.gov.wales/land-transaction-tax-rates-and-bands)

### Updating the rules

1. Change the bands in `tax-rules.js` and set `effectiveFrom`.
2. Add tests in `test/finance.test.js` with a worked example from the official source.
3. Update `RULES_LAST_CHECKED` and this page.

## Commute fares

`fare per office day × office days per week × working weeks per year ÷ 12`. The fare is the AI's estimate (or your correction). Check it with the operator's fare finder.

## Resale scenarios

`day one = price × (1 − new-build premium)`, then the five-year growth (compounded over the years shown), then the annual rate after year five. The AI suggests assumptions for each area with a rationale; you can use your own for every home instead. These are figures before inflation, for comparing homes, not valuations.
