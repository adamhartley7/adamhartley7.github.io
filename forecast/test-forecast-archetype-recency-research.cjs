"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
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

const committed = JSON.parse(fs.readFileSync(
  path.join(__dirname, "research", "round2", "candidate-development-results.json"),
  "utf8"
));
assert.strictEqual(committed.development_gate_pass, false);
assert.strictEqual(committed.withheld_splits_scored, false);
assert.strictEqual(committed.candidate.max_fit_rows_per_archetype, 128);
assert.strictEqual(committed.parity.gate.coverage_gap_improvement_pct_points, 1.19);
assert.strictEqual(committed.parity.gate.pass, false);
assert.strictEqual(committed.synthetic.gate.coverage_gap_improvement_pct_points, 0);
assert.strictEqual(committed.synthetic.gate.pass, true);
assert.strictEqual("withheld" in committed.parity.counts, true);
assert.strictEqual("withheld_metrics" in committed.parity, false);
assert.strictEqual("sealed_test" in committed.parity, false);
assert(!/description_excerpt|session_id|start_ts|source_file|prompt_text/.test(JSON.stringify(committed)));

process.stdout.write("TOP forecast archetype-recency protocol tests passed\n");
