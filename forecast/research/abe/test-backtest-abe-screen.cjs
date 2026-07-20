#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const H = require("./backtest-abe-screen.cjs");

let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const csv = 'a,b,c\r\n1,"two, too",3\r\n4,"line 1\nline 2",6\r\n7,"say ""yes""",9\r\n';
const parsed = H.parseCsv(csv);
equal(parsed.length, 4, "CSV parser preserves four logical rows");
equal(parsed[1], ["1", "two, too", "3"], "CSV parser handles quoted commas");
equal(parsed[2][1], "line 1\nline 2", "CSV parser handles quoted newlines");
equal(parsed[3][1], 'say "yes"', "CSV parser handles escaped quotes");

equal(H.normalizeText("  FOO\n  Bar  "), "foo bar", "text normalization folds whitespace and case");
equal(H.wordsOf("fix parser_2 now"), ["fix", "parser_2", "now"], "word extraction keeps numeric identifiers");
equal(H.fnv1a("stable"), H.fnv1a("stable"), "hashing is deterministic");
check(H.fnv1a("stable") !== H.fnv1a("changed"), "hashing distinguishes the fixture strings");

equal(H.jaccard([1, 2, 3], [2, 3, 4]), 0.5, "Jaccard uses intersection over union");
equal(H.jaccard([], [1]), 0, "Jaccard returns zero for an empty side");
equal(H.median([9, 1, 5]), 5, "median handles odd lengths");
equal(H.median([1, 3, 5, 7]), 4, "median handles even lengths");
equal(H.linearQuantile([0, 10], 0.25), 2.5, "linear quantile interpolates");
equal(H.upperOrderQuantile([1, 2, 3, 4], 0.8), 4, "finite-sample upper order statistic is conservative");
equal(H.centralOrderInterval([1, 2, 3, 4, 5], 0.2), [1, 5], "central order interval clamps small samples honestly");

const synthetic = H.makeSyntheticRecords(120);
const split = H.splitCorpus(synthetic);
equal([split.fit.length, split.calibration.length, split.development.length, split.sealed.length],
  [66, 24, 12, 18], "chronological split follows 55/20/10/15 floors");
check(split.fit[split.fit.length - 1].ts < split.calibration[0].ts, "split order remains chronological");

const scaler = H.robustScaler(split.fit);
check(scaler.active.length > 0, "synthetic fit produces active robust-scaled dimensions");
check(H.vectorDistance(split.fit[0], split.fit[0], scaler, "manhattan") === 0,
  "Manhattan distance is zero for the same vector");
check(H.vectorDistance(split.fit[0], split.fit[1], scaler, "manhattan") >= 0,
  "Manhattan distance is non-negative");
check(H.vectorDistance(split.fit[0], split.fit[1], scaler, "euclidean") >= 0,
  "Euclidean distance is non-negative");

const query = synthetic[80];
const past = synthetic.slice(0, 80);
const future = synthetic.slice(81).map((row, index) => ({ ...row, y: 1000 + index }));
const before = H.predictPoint(query, past, "jaccard", scaler);
const after = H.predictPoint(query, past.concat(future), "jaccard", scaler);
equal(after.pred, before.pred, "future rows cannot alter a prediction");
check(after.neighbours.every((row) => row.candidate.ts < query.ts), "every selected donor is strictly earlier");

const recency = H.predictPoint(query, past, "recency", scaler);
check(Number.isFinite(recency.pred), "recency baseline produces a finite log-cost prediction");
const borda = H.topBorda(query, past, 3, scaler);
equal(borda.length, 3, "Borda screen returns the fixed number of donors");
check(borda.every((row) => row.candidate.ts < query.ts), "Borda also enforces the temporal gate");

const metrics = H.intervalMetrics([
  { y: 0, pred: 0, lo: -1, hi: 1 },
  { y: 2, pred: 0, lo: -1, hi: 1 }
]);
equal(metrics.coverage, 0.5, "coverage counts interval hits");
equal(metrics.upper_tail_miss_rate, 0.5, "upper-tail misses remain visible");
equal(metrics.lower_tail_miss_rate, 0, "lower-tail misses remain separate");
check(metrics.mean_log_interval_score > 2, "interval score penalizes misses");
assert.throws(() => H.intervalMetrics([{ y: 0, pred: 0, lo: 1, hi: -1 }]),
  /interval invariant failed/, "metrics reject inverted intervals");
checks++;
const infiniteMetrics = H.intervalMetrics([{ y: 0, pred: 0, lo: -Infinity, hi: Infinity }]);
equal(infiniteMetrics.median_p90_p10_ratio, Infinity,
  "an infinite interval remains infinite in the width metric");

const cqrGuard = H.cqrRows([
  { query: { y: 0 }, pred: 0, rawLo: -10, rawHi: 10 },
  { query: { y: 0 }, pred: 0, rawLo: -10, rawHi: 10 },
  { query: { y: 0 }, pred: 0, rawLo: -10, rawHi: 10 },
  { query: { y: 0 }, pred: 0, rawLo: -10, rawHi: 10 }
], [{ query: { y: 0 }, pred: 0, rawLo: 2, rawHi: 3 }]);
equal(cqrGuard.calibration_correction, 0, "negative CQR correction is conservatively clamped to zero");
check(cqrGuard.rows[0].lo <= cqrGuard.rows[0].pred && cqrGuard.rows[0].pred <= cqrGuard.rows[0].hi,
  "CQR preserves lo <= point <= hi");

const localGuard = H.localAsymmetricRows([
  { query: { y: 3, archetype: "a" }, pred: 0 },
  { query: { y: 4, archetype: "a" }, pred: 0 }
], [{ query: { y: 2, archetype: "a" }, pred: 0 }]);
check(localGuard.rows[0].lo <= 0 && localGuard.rows[0].hi >= 0,
  "asymmetric residual interval still contains the reported point");

const duplicate = H.prepareRecord({
  description_excerpt: "fix parser error and add regression test episode 0",
  cost_usd: 2,
  ts: synthetic[synthetic.length - 1].ts + 1,
  project: "private-project-value",
  archetype: "type-0",
  model_primary: "private-model-value"
}, 999);
const deduped = H.deduplicateFirstPrompt(synthetic.concat([duplicate]));
equal(deduped.length, synthetic.length, "first-prompt sensitivity removes exact normalized repeats");

const sentinelInput = synthetic.slice();
sentinelInput[95] = H.prepareRecord({
  description_excerpt: "UNIQUE_PRIVATE_PROMPT_SENTINEL_7291",
  cost_usd: 3,
  ts: synthetic[95].ts,
  project: "private-project-value",
  archetype: "type-sentinel"
}, 1001);
const result = H.runScreen(sentinelInput);
equal(result.schema_version, "top.abe-exploratory-screen.v1", "screen output is schema-labelled");
equal(result.corpora.all_eligible_rows.split.sealed_not_evaluated, 18, "screen preserves the sealed fixture boundary");
equal(result.protocol.reserved_row_objects_accessed_by_run_screen, false,
  "screen declares that runScreen does not access reserved row objects");
equal(result.protocol.reserved_outcomes_scored_by_run_screen, false,
  "screen declares that runScreen does not score reserved outcomes");
equal(result.protocol.cli_loader_is_holdout_preserving, false,
  "screen discloses that the CLI import is not a holdout boundary");
equal(result.protocol.existing_holdout_status, "compromised_by_prior_prompt_identity_inspection",
  "screen discloses that the old holdout is no longer sealed");
equal(result.protocol.fresh_future_holdout_required, true,
  "screen requires a fresh future holdout");
equal(Object.keys(result.corpora.all_eligible_rows.results).length, 9, "screen evaluates nine fixed method-band combinations");
equal(result.privacy.raw_prompt_text_emitted, false, "output declares the prompt privacy boundary");
equal(
  result.corpora.all_eligible_rows.results.jaccard_knn_cqr.metrics.median_abs_log_error,
  result.corpora.all_eligible_rows.results.jaccard_symmetric_conformal.metrics.median_abs_log_error,
  "CQR preserves the baseline Jaccard k3 point predictions"
);

const serialized = JSON.stringify(result);
check(!serialized.includes("UNIQUE_PRIVATE_PROMPT_SENTINEL_7291"), "aggregate output omits prompt values supplied to the screen");
check(!serialized.includes("private-project-value"), "aggregate output omits project values");
check(!serialized.includes("private-model-value"), "aggregate output omits model values");
check(!serialized.includes("description_excerpt"), "aggregate output omits prompt field names");
check(!serialized.includes("start_ts"), "aggregate output omits raw timestamp field names");
check(!serialized.includes('"session_id":'), "aggregate output omits raw session identifier fields");

const calibrationChanged = synthetic.map((row, index) => {
  if (index >= 66 && index < 90) return { ...row, y: row.y + 100 };
  return row;
});
const fixedBase = H.runScreen(synthetic);
const fixedChanged = H.runScreen(calibrationChanged);
equal(
  fixedChanged.corpora.all_eligible_rows.results.jaccard_symmetric_conformal.metrics.median_abs_log_error,
  fixedBase.corpora.all_eligible_rows.results.jaccard_symmetric_conformal.metrics.median_abs_log_error,
  "calibration outcomes do not alter the fixed point predictor"
);

const guarded = synthetic.slice();
for (let i = 102; i < 120; i++) {
  guarded[i] = new Proxy({}, {
    get() { throw new Error("sealed row property was accessed"); }
  });
}
const guardedResult = H.runScreen(guarded);
equal(guardedResult.corpora.all_eligible_rows.split.sealed_not_evaluated, 18,
  "sealed row properties are never accessed by the screen");

const tiedTimestamps = H.makeSyntheticRecords(120).map((row) => ({ ...row, ts: 1000 }));
const tiedResult = H.runScreen(tiedTimestamps);
equal(tiedResult.corpora.all_eligible_rows.status,
  "not_run_insufficient_strictly_earlier_predictions",
  "tied timestamps produce an explicit not-run result instead of a crash");

process.stdout.write(`PASS ${checks}/${checks} checks\n`);
