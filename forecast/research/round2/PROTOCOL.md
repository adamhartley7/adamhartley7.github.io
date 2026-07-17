# Forecast accuracy R&D round 2 protocol

## Question

Can an archetype-local recency window improve the description-only forecast under time drift without using project identity, realised turn count, or any raw task text?

This is a research-only experiment. It does not change `/forecast` and it cannot support a public accuracy claim.

## Candidate frozen before scoring

The single candidate keeps the most recent 128 fit rows within each precomputed archetype before calling the unchanged forecast engine. If an archetype has 128 or fewer fit rows, all of its rows remain. Calibration remains unchanged.

The fixed window is a power-of-two engineering choice, not a value selected from development outcomes. There is no window search, hyperparameter search, or second candidate. The candidate may use only chronology and the already-derived content-free archetype label. It must not use raw descriptions, project-wide residuals, realised turn count in description mode, or any row from the withheld split.

## Frozen data and split

- Reuse the round 1 content-free parity snapshot and seeded synthetic fixture.
- Reuse the chronological split: first 55% fit, next 20% calibration, next 10% development, final 15% withheld.
- The 130-session parity withheld split and the 108-row synthetic withheld split remain unscored in this experiment.
- Primary metric: description-only absolute coverage gap from the 80% target.
- Guardrails: median absolute log error may not exceed 1.05 times baseline, and median P90/P10 interval ratio may not exceed 1.25 times baseline.

## Development gate

The candidate passes development only if all four conditions hold:

1. parity development coverage gap improves by at least 2 percentage points;
2. parity error and interval width pass both guardrails;
3. synthetic development coverage gap does not worsen; and
4. synthetic error and interval width pass both guardrails.

If the candidate fails, record the negative result and leave the withheld splits closed. If it passes, leave the withheld splits closed until an independent review approves the exact candidate and explicitly authorizes one sealed evaluation. Passing development alone is not evidence for a public accuracy claim.
