"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  finiteSampleQuantile,
  scaleBand,
  splitDevelopmentOnly
} = require("./research/round3/evaluate-conformal-scale.cjs");
const { syntheticRows } = require("./research/evaluate-forecast.cjs");

const split = splitDevelopmentOnly(syntheticRows());
assert.deepStrictEqual(split.counts, {
  fit: 396,
  conformal_fit: 108,
  scale_fit: 36,
  development: 72,
  sealed: 108
});
assert.strictEqual("sealed" in split, false);

assert.strictEqual(finiteSampleQuantile([0, 1, 2, 3], 0.8), 3);
assert.strictEqual(finiteSampleQuantile([0, 1, 2, 3, 4], 0.5), 2);
assert.throws(() => finiteSampleQuantile([]), /required/);
assert.throws(() => finiteSampleQuantile([1, -1]), /non-negative/);

const baseBand = { p10: 25, p50: 50, p90: 100 };
assert.deepStrictEqual(scaleBand(baseBand, 0), { p10: 50, p50: 50, p90: 50 });
assert.deepStrictEqual(scaleBand(baseBand, 1), baseBand);
assert.deepStrictEqual(scaleBand(baseBand, 2), { p10: 12.5, p50: 50, p90: 200 });
assert.throws(() => scaleBand(baseBand, -1), /non-negative/);

const committed = JSON.parse(fs.readFileSync(
  path.join(__dirname, "research", "round3", "candidate-development-results.json"),
  "utf8"
));
assert.strictEqual(committed.development_gate_pass, false);
assert.strictEqual(committed.sealed_splits_scored, false);
assert.strictEqual(committed.parity.counts.sealed, 130);
assert.strictEqual(committed.synthetic.counts.sealed, 108);
assert.strictEqual(committed.parity.scale_fit.interval_scale, 0.931432);
assert.strictEqual(committed.parity.gate.coverage_gap_improvement_pct_points, 3.571);
assert.strictEqual(committed.parity.gate.pass, true);
assert.strictEqual(committed.synthetic.scale_fit.interval_scale, 0.872245);
assert.strictEqual(committed.synthetic.gate.coverage_gap_improvement_pct_points, -2.778);
assert.strictEqual(committed.synthetic.gate.pass, false);
assert.strictEqual(committed.candidate.uses_original_project_identifier, false);
assert.strictEqual("sealed_metrics" in committed.parity, false);
assert.strictEqual("sealed_metrics" in committed.synthetic, false);
assert(!/description_excerpt|session_id|start_ts|source_file|prompt_text/.test(
  JSON.stringify(committed)
));

process.stdout.write("TOP forecast conformal-scale unit tests passed\n");
