# TOP prospective forecast pilot

This page instruments a small prospective pilot. It does not claim that TOP is accurate.

## Frozen design

- Four anonymous participant slots.
- Six paired usable tasks per participant, 24 in total.
- At least three fixed task classes per participant.
- P10, P50 and P90 API-rate-equivalent USD forecasts are frozen before the task begins. They are not subscription bills.
- The measured API-rate equivalent can be entered only after the forecast is frozen.
- A frozen record is never edited. It can be invalidated with one fixed reason, retained, and replaced.
- Drafts, frozen attempts awaiting an actual, paired attempts, abandoned attempts, and other invalidations remain in the content-free export.
- The pilot collects no task text, names, prompts, replies, file contents, paths, credentials, account identifiers, exact timestamps, or notes.

The browser stores each participant slot in `localStorage`. A participant can deliberately download or restore a `top.prospective-pilot.v1` JSON file. The page makes no network request and registers no service worker.

## Coordinator analysis

The coordinator imports one latest file per participant slot. The page reports exact numerators and denominators for:

- observed P10 to P90 coverage against the nominal 80% target;
- actual below P10, at or below P50, and at or below P90;
- median multiplicative P50 error;
- mean log bias;
- relative and absolute interval width;
- the mean 80% interval score in log space;
- attrition;
- the missing-data floor;
- participant, forecast-version, and task-class splits.

These results are exploratory. A later confirmatory study requires a frozen sample size, exclusions, analysis plan, and stopping rule.

## Run the tests

From the repository root in PowerShell:

```powershell
Get-ChildItem pilot -Filter 'test-*.cjs' | Sort-Object Name | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```
