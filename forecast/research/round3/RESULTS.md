# Forecast accuracy R&D round 3 result

## Outcome

The nested recent global conformal scale failed its predeclared development gate. It was not evaluated on either sealed split, and it was not added to the public `/forecast` engine.

The protocol was committed as `df8eef5`, and the fixed candidate implementation was committed as `a734dc1`, before the first development score was produced. No scale clipping, parameter search, or candidate substitution followed the result.

## Candidate

The unchanged engine fitted point forecasts on the first 55% of each corpus. The candidate fitted the existing conformal quantiles on the first 75% of the following calibration block, then learned one global interval multiplier from the final 25% of that block. It kept P50 unchanged and scaled both log half-widths equally.

The parity scale-fit window learned a multiplier of 0.931432 from 43 rows. The synthetic scale-fit window learned a multiplier of 0.872245 from 36 rows. Both candidates therefore narrowed intervals.

## Development evidence

| Corpus | Baseline coverage | Candidate coverage | Coverage-gap improvement | Error ratio | Width ratio | Gate |
|---|---:|---:|---:|---:|---:|---|
| Parity development, n=84 | 85.714% (72/84) | 82.143% (69/84) | 3.571 pp | 1.000000 | 0.970373 | Pass |
| Seeded synthetic development, n=72 | 66.667% (48/72) | 63.889% (46/72) | -2.778 pp | 1.000000 | 0.986653 | Fail |

The parity result cleared the 2 percentage-point improvement threshold and kept both guardrails. The synthetic fixture was already under-covered, and the learned shrinkage removed two more hits. Its absolute coverage gap therefore worsened by 2.778 points, which fails the frozen non-regression rule.

Point-error ratios are exactly 1 because this candidate changes interval width only. Its narrower P90/P10 ratio does not rescue the synthetic coverage failure.

## Interpretation

A recent global shrink factor moved the parity development interval closer to the 80% target, but the same predeclared method moved the synthetic fixture in the wrong direction. This is evidence that one corpus-level recent scale can react to local calibration conditions without being robust to a different drift pattern.

The result does not establish that global recalibration is useless. It rules out this exact nested 75/25 calibration split as the next public change under the frozen gate. A stronger next step is the prospective 24-task pilot, where interval drift can be measured across people without reusing this development window.

Both sealed splits remain unopened: 130 parity sessions and 108 synthetic rows. This is a negative research result, not an accuracy improvement or a public accuracy claim.

## Reproduce

```powershell
$safe = Join-Path $env:USERPROFILE 'overnight\forecast-rd-2026-07-17\parity-content-free.local.json'
node forecast\research\round3\evaluate-conformal-scale.cjs `
  $safe `
  forecast\research\round3\candidate-development-results.json
node forecast\test-forecast-conformal-research.cjs
```

The committed aggregate result contains no prompts, session identifiers, timestamps, file names, original project values, or sealed-set metrics.
