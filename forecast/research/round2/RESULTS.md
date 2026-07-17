# Forecast accuracy R&D round 2 result

## Outcome

The archetype-local recency candidate failed its predeclared development gate. It was not evaluated on either withheld split, and it was not added to the public `/forecast` engine.

The protocol and candidate were committed as `764aaa0` before the first development score was produced. No window search or candidate substitution followed the result.

## Candidate

Before the unchanged forecast engine fitted its priors, the research wrapper retained the most recent 128 fit rows within each precomputed archetype. It used no raw description text, no new project residual, and no realised turn count in description mode. Calibration was unchanged.

The parity fit window retained 141 of 466 rows. One dominant archetype was capped at 128 while the sparse archetypes retained all 13 of their rows. The synthetic fixture had no archetype above the cap, so its candidate path was exactly the baseline path.

## Development evidence

| Corpus | Baseline coverage | Candidate coverage | Coverage-gap improvement | Error ratio | Width ratio | Gate |
|---|---:|---:|---:|---:|---:|---|
| Parity development, n=84 | 85.714% (72/84) | 84.524% (71/84) | 1.190 pp | 0.742986 | 1.102129 | Fail |
| Seeded synthetic development, n=72 | 66.667% (48/72) | 66.667% (48/72) | 0.000 pp | 1.000000 | 1.000000 | Pass |

The parity rule required at least a 2 percentage-point improvement in absolute distance from the 80% target. The candidate improved that gap by only 1.190 points, so it failed even though median absolute log error fell and interval width stayed within its guardrail. The synthetic result was unchanged, as expected from the frozen cap.

## Interpretation

There is weak development-only evidence that stale archetype history may affect point error, but this fixed 128-row window did not clear the coverage gate. Testing a nearby window after seeing this result would be tuning on the same development set, so this experiment stops here.

This is a negative research result, not an accuracy improvement and not evidence that recency is useless. A future experiment would need a fresh development protocol, stronger pre-run task-shape fields, or prospective task logging. The 130-session parity withheld split remains closed.

## Reproduce

```powershell
$safe = Join-Path $env:USERPROFILE 'overnight\forecast-rd-2026-07-17\parity-content-free.local.json'
node forecast\research\round2\evaluate-archetype-recency.cjs `
  $safe `
  forecast\research\round2\candidate-development-results.json
node forecast\test-forecast-archetype-recency-research.cjs
```

The aggregate result file contains no prompts, session identifiers, timestamps, file names, or original project values.
