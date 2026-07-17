"use strict";

const assert = require("assert");
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

process.stdout.write("TOP forecast conformal-scale unit tests passed\n");
