# Forecast accuracy R&D result

## Outcome

The bounded project-history candidate failed the predeclared development gate. It was not evaluated on the sealed final 15%, and it was not added to the public `/forecast` engine.

## Baseline evidence

The content-free parity snapshot has 849 usable sessions across 16 pseudonymized projects. Its browser-equivalent chronological split is 509 fit, 170 calibration, and 170 test sessions.

| Task-only baseline | Result |
|---|---:|
| Coverage | 64.706% (110/170) |
| Absolute gap from 80% | 15.294 percentage points |
| Median relative error | 21.108% |
| Median absolute log error | 0.201856 |
| Median P90/P10 interval ratio | 1.700055 |

This does not reproduce the historic 44.6% observation. That number came from the later 16 July browser run on a 976-session corpus. The permitted parity snapshot is older, contains 849 usable sessions, and supplies its already-derived archetype labels because raw descriptions are excluded. This evaluation therefore tests the forecast engine rather than the browser's raw-text classifier. The 44.6% figure should remain labeled as a historical end-to-end single-run result, not as an independently reproduced benchmark or as a number disproved by this different snapshot.

## Frozen evaluation

Before changing the model, the chronological split was fixed at 55% fit, 20% calibration, 10% development, and 15% sealed test. The parity counts are 466, 169, 84, and 130. The sealed 130-session test was not opened.

The candidate estimated a project-wide log-cost residual from training history after removing each archetype prior. It required three prior project records and used a fixed credibility constant of 20. No parameter search was performed.

### Development result

| Corpus | Baseline coverage | Candidate coverage | Coverage-gap change | Error ratio | Width ratio | Gate |
|---|---:|---:|---:|---:|---:|---|
| Parity development, n=84 | 85.714% | 85.714% | 0.000 pp | 1.000000 | 0.999982 | Fail |
| Seeded synthetic development, n=72 | 66.667% | 65.278% | -1.389 pp | 0.968008 | 1.016977 | Fail |

The parity gate required at least a 2 percentage-point improvement. The candidate delivered none. It also made synthetic coverage worse. Better point error on the synthetic fixture was not enough to rescue a coverage failure.

## Interpretation

The current model already uses exact project-by-archetype history when that cell exists. A project-wide residual added almost no information on the parity development window. This is negative evidence against treating coarse project identity as the next accuracy lever.

The next responsible experiments are richer pre-run task features, a forecast distribution for turn count, and rolling recalibration under time drift. Each needs a newly frozen protocol. None should reuse the unopened test from this experiment after looking at it.

## Reproduce

```powershell
$safe = Join-Path $env:USERPROFILE 'overnight\forecast-rd-2026-07-17\parity-content-free.local.json'
$source = Join-Path $env:USERPROFILE 'dev\adamhartley7.github.io\forecast\parity\sessions.csv'
node forecast\research\sanitize-parity.cjs `
  $source `
  $safe
node forecast\research\evaluate-forecast.cjs `
  $safe `
  forecast\research\candidate-development-results.json `
  candidate-development
```

The generated content-free corpus is ignored by Git. The committed aggregate results contain no prompts, session identifiers, timestamps, file names, or original project values.
