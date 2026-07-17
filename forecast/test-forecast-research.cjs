"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sanitize } = require("./research/sanitize-parity.cjs");
const { candidateDevelopment, splitFrozen, syntheticRows } = require("./research/evaluate-forecast.cjs");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "top-forecast-rd-"));
try {
  const privateCsv = path.join(temp, "private.csv");
  fs.writeFileSync(privateCsv, [
    "session_id,user,project,archetype,description_excerpt,turn_count,cost_usd,start_ts",
    'secret-id,test-user,C:\\\\private\\\\alpha,debug_fix,"PRIVATE_PROMPT, with comma",5,1.25,2026-01-01T00:00:00Z',
    'secret-id-2,test-user,C:\\\\private\\\\beta,qa_short,"PRIVATE_PROMPT_2",2,0.25,2026-01-02T00:00:00Z'
  ].join("\n"));
  const safe = sanitize(privateCsv);
  const serialized = JSON.stringify(safe);
  for (const forbidden of ["PRIVATE_PROMPT", "secret-id", "test-user", "private", "start_ts"]) {
    assert(!serialized.includes(forbidden), `safe corpus leaked ${forbidden}`);
  }
  assert.deepStrictEqual(safe.rows.map(row => row.project), ["project_001", "project_002"]);
  assert.deepStrictEqual(safe.rows.map(row => row.order), [0, 1]);

  const synthetic = syntheticRows();
  const split = splitFrozen(synthetic);
  assert.deepStrictEqual(split.counts, { fit: 396, calibration: 144, development: 72, sealed_test: 108 });
  const result = candidateDevelopment(synthetic);
  assert.strictEqual(result.gate.pass, false);
  assert.strictEqual(result.gate.coverage_gap_improvement_pct_points, -1.389);

  const committed = JSON.parse(fs.readFileSync(path.join(__dirname, "research", "candidate-development-results.json"), "utf8"));
  assert.strictEqual(committed.development_gate_pass, false);
  assert.strictEqual("sealed_test" in committed.parity, false);
  assert.strictEqual("sealed_test" in committed.synthetic, false);
  assert(!/description_excerpt|session_id|start_ts|source_file/.test(JSON.stringify(committed)));

  process.stdout.write("TOP forecast research privacy and frozen-gate tests passed\n");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
