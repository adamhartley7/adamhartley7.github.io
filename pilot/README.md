# TOP prospective forecast pilot

This page instruments a small prospective pilot. It does not claim that TOP is accurate.

## Frozen design

- Four coded participant slots. They are pseudonymous, not anonymous, when the coordinator can link a slot to a person.
- Six paired usable tasks per participant, 24 in total.
- At least three fixed task classes per participant.
- P10, P50 and P90 API-rate-equivalent USD forecasts are frozen before the task begins. They are not subscription bills.
- The measured API-rate equivalent can be entered only after the forecast is frozen.
- The app does not edit a frozen record. It can be invalidated with one fixed reason, retained, and replaced. Downloaded files are not signed or tamper-evident.
- Drafts, frozen attempts awaiting an actual, paired attempts, abandoned attempts, and other invalidations remain in the task-text-free structured export.
- The pilot collects no task text, names, prompts, replies, file contents, paths, credentials, account identifiers, exact timestamps, or notes.
- The export still retains the coded participant slot, export date, study descriptor, attempt sequence, state, task class, forecast version, P10, P50, P90, actual, invalidation reason, and completeness counts.

The browser stores each participant slot in `localStorage`. A participant can deliberately download or restore a `top.prospective-pilot.v1` JSON file. The page makes no runtime request that transmits participant data and registers no service worker.

## Coordinator analysis

The coordinator imports one latest file per participant slot. The page reports exact numerators and denominators for:

- observed P10 to P90 coverage against the nominal 80% target;
- the 95% Wilson uncertainty range for observed coverage, with its covered-task numerator and paired-task denominator;
- actual below P10, at or below P50, and at or below P90;
- median multiplicative P50 error;
- mean log bias;
- relative and absolute interval width;
- the mean 80% interval score in log space;
- attrition;
- the missing-actual rate;
- the share of frozen forecasts excluded from accuracy metrics;
- the coverage floor obtained by treating every excluded forecast as a miss;
- participant, forecast-version, and task-class splits.

Forecast-version splits are descriptive only. The pilot does not randomize or balance version assignments, so it cannot establish causal differences between versions.

The Wilson range uses the standard normal 95% critical value and returns no bounds when there are no paired tasks. Even the full 24-task pilot cannot establish precise calibration. These results are exploratory. A later confirmatory study requires a frozen sample size, exclusions, analysis plan, and stopping rule.

## Run the tests

From the repository root in PowerShell:

```powershell
Get-ChildItem pilot -Filter 'test-*.cjs' | Sort-Object Name | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```
