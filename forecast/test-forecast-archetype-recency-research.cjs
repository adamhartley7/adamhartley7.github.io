"use strict";

const assert = require("assert");
const Candidate = require("./research/round2/forecaster-archetype-recency-candidate.cjs");
const { developmentOnly } = require("./research/round2/evaluate-archetype-recency.cjs");
const { syntheticRows } = require("./research/evaluate-forecast.cjs");

const rows = [];
for (let i = 0; i < 140; i += 1) rows.push({ order: i, archetype: "debug_fix" });
for (let i = 0; i < 3; i += 1) rows.push({ order: 140 + i, archetype: "qa_short" });
const selected = Candidate.selectRecentPerArchetype(rows);
assert.strictEqual(selected.length, 131);
assert.deepStrictEqual(selected.filter(row => row.archetype === "debug_fix").map(row => row.order),
  Array.from({ length: 128 }, (_, i) => i + 12));
assert.deepStrictEqual(selected.filter(row => row.archetype === "qa_short").map(row => row.order), [140, 141, 142]);
assert.throws(() => Candidate.selectRecentPerArchetype(rows, 0), /positive integer/);

const split = developmentOnly(syntheticRows());
assert.deepStrictEqual(split.counts, { fit: 396, calibration: 144, development: 72, withheld: 108 });
assert.strictEqual("withheld" in split, false);

process.stdout.write("TOP forecast archetype-recency protocol tests passed\n");

