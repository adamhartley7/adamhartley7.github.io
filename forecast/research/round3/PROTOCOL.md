# Forecast accuracy R&D round 3 protocol

## Question

Can one recent, globally learned scale factor correct interval drift while leaving the current point forecast, project blending, archetype labels, and public `/forecast` engine unchanged?

This is a research-only split-conformal interval experiment. It cannot support a public accuracy claim.

## Candidate frozen before scoring

The single candidate is a nested recent-calibration scale:

1. Fit the unchanged forecast engine on the first 55% of rows.
2. Use the first three quarters of the following 20% calibration block to fit the engine's existing conformal quantiles.
3. Use the final quarter of that calibration block to learn one global description-only interval scale. For each row, calculate the absolute log error divided by the current upper log half-width, then take the finite-sample 80% conformal quantile of those ratios.
4. Keep P50 unchanged. Multiply both lower and upper log half-widths by that one scale for every development forecast.

The scale may shrink or expand the interval. It uses no development row, raw text, original project identifier, realised turn count in description mode, model search, clipping, or parameter tuning. It preserves asymmetric dollar distances implied by a symmetric interval in log space. The candidate changes interval width only, so its point-error metrics should equal baseline apart from numeric rounding.

## Frozen data and partition

- Reuse only the round 1 content-free parity snapshot and seeded synthetic fixture.
- Keep the chronological outer split: first 55% fit, next 20% calibration, next 10% development, final 15% sealed.
- Split the calibration block chronologically: first 75% conformal fit, final 25% scale fit.
- Expected parity counts: 466 fit, 126 conformal fit, 43 scale fit, 84 development, and 130 sealed.
- Expected synthetic counts: 396 fit, 108 conformal fit, 36 scale fit, 72 development, and 108 sealed.
- Primary metric: description-only absolute coverage gap from the 80% target.
- Secondary metrics: median absolute log error and median P90/P10 interval ratio.

## Development gate

The candidate passes only if all conditions hold:

1. parity development coverage gap improves by at least 2 percentage points;
2. parity median absolute log error is no more than 1.001 times baseline;
3. parity median interval ratio is between 0.50 and 1.25 times baseline;
4. synthetic development coverage gap does not worsen;
5. synthetic median absolute log error is no more than 1.001 times baseline;
6. synthetic median interval ratio is between 0.50 and 1.25 times baseline; and
7. every candidate band is finite, positive, and ordered P10 <= P50 <= P90.

If any condition fails, record the negative result and stop. If every condition passes, still leave both sealed splits closed. A separate independent review would be required before one sealed evaluation could be authorized. Development success alone would not justify a public accuracy claim or a change to `/forecast`.
