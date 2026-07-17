# Forecast accuracy R&D protocol

This directory evaluates forecast changes without publishing an accuracy claim.

## Frozen before model changes

- Inputs: seeded synthetic records and a local content-free derivative of the private parity CSV.
- No descriptions, session identifiers, timestamps, file names, or original project values enter the evaluation file.
- Chronological split: first 55% fit, next 20% calibration, next 10% development, final 15% sealed test.
- Primary metric: task-only (`description`) absolute coverage gap from the 80% target.
- Guardrails: median absolute log error may not regress by more than 5%, and median P90/P10 interval ratio may not exceed 1.25 times baseline.
- Candidate selection uses development data only. The sealed test is evaluated once after the candidate is fixed.
- A candidate is not a public accuracy claim. A prospective multi-person pilot remains necessary.

## Predeclared candidate and gate

The single candidate is a leakage-safe project-history residual blend. Training records estimate each project's mean log-cost residual after subtracting its archetype prior. A project must have at least three historical records. Its fixed credibility constant is 20, with no search or tuning. The existing project-by-archetype blend remains the final level.

The candidate advances from development to the sealed test only if:

1. parity development task-only coverage gap improves by at least 2 percentage points;
2. parity median absolute log error is no more than 1.05 times baseline;
3. parity median interval ratio is no more than 1.25 times baseline; and
4. synthetic development coverage gap does not worsen, with the same error and width guardrails.

It is eligible for an optional, dormant implementation only if the sealed parity result also has a strictly smaller coverage gap and passes the error and width guardrails. Otherwise the model change is removed and only the reproducible negative research result remains.

The historic 44.6% coverage was reported from the 16 July browser run on a later 976-session corpus. The local parity snapshot contains 849 usable sessions, so this protocol reports its independently reproducible baseline separately rather than treating the two snapshots as interchangeable.
