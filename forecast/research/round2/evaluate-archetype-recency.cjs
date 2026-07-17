"use strict";

const crypto = require("crypto");
const fs = require("fs");
const BaseForecaster = require("../../forecaster.js");
const CandidateForecaster = require("./forecaster-archetype-recency-candidate.cjs");
const { evaluate, syntheticRows } = require("../evaluate-forecast.cjs");

const TARGET_COVERAGE = 0.80;
const SPLIT = Object.freeze({ fit: 0.55, calibration: 0.20, development: 0.10, withheld: 0.15 });
const GUARDRAILS = Object.freeze({ error_ratio_max: 1.05, width_ratio_max: 1.25 });
const CANDIDATE = Object.freeze({
  name: "archetype_local_recency_window",
  max_fit_rows_per_archetype: CandidateForecaster.MAX_ROWS_PER_ARCHETYPE,
  uses_project_residual: false,
  uses_realised_turn_count_in_description_mode: false,
  uses_raw_text: false
});

function round(value, digits = 6) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function developmentOnly(rows) {
  const n = rows.length;
  const fitCount = Math.floor(n * SPLIT.fit);
  const calibrationCount = Math.floor(n * SPLIT.calibration);
  const developmentCount = Math.floor(n * SPLIT.development);
  const developmentEnd = fitCount + calibrationCount + developmentCount;
  const withheldCount = n - developmentEnd;
  if (fitCount < 2 || calibrationCount < 1 || developmentCount < 1 || withheldCount < 1) {
    throw new Error("corpus is too small");
  }
  return {
    fit: rows.slice(0, fitCount),
    calibration: rows.slice(fitCount, fitCount + calibrationCount),
    development: rows.slice(fitCount + calibrationCount, developmentEnd),
    counts: {
      fit: fitCount,
      calibration: calibrationCount,
      development: developmentCount,
      withheld: withheldCount
    }
  };
}

function gate(baseline, candidate, minimumCoverageGapImprovement) {
  const improvement = baseline.calibration_gap_pct - candidate.calibration_gap_pct;
  const errorRatio = candidate.median_absolute_log_error / baseline.median_absolute_log_error;
  const widthRatio = candidate.median_interval_ratio_p90_p10 / baseline.median_interval_ratio_p90_p10;
  return {
    pass: improvement >= minimumCoverageGapImprovement &&
      errorRatio <= GUARDRAILS.error_ratio_max &&
      widthRatio <= GUARDRAILS.width_ratio_max,
    coverage_gap_improvement_pct_points: round(improvement, 3),
    median_absolute_log_error_ratio: round(errorRatio),
    median_interval_ratio_multiplier: round(widthRatio)
  };
}

function retention(fit) {
  const selected = CandidateForecaster.selectRecentPerArchetype(fit);
  const before = new Map();
  const after = new Map();
  for (const row of fit) before.set(row.archetype, (before.get(row.archetype) || 0) + 1);
  for (const row of selected) after.set(row.archetype, (after.get(row.archetype) || 0) + 1);
  let capped = 0;
  for (const [archetype, count] of before) {
    if ((after.get(archetype) || 0) < count) capped += 1;
  }
  return {
    fit_rows_before: fit.length,
    fit_rows_after: selected.length,
    archetypes_capped: capped
  };
}

function evaluateDevelopment(rows, minimumCoverageGapImprovement) {
  const split = developmentOnly(rows);
  const baseline = evaluate(split.fit, split.calibration, split.development, {}, BaseForecaster);
  const candidate = evaluate(split.fit, split.calibration, split.development, {}, CandidateForecaster);
  return {
    counts: split.counts,
    development_membership_hash: hash({
      fit: split.fit.map(row => row.order),
      calibration: split.calibration.map(row => row.order),
      development: split.development.map(row => row.order)
    }),
    retention: retention(split.fit),
    baseline,
    candidate,
    gate: gate(baseline.description, candidate.description, minimumCoverageGapImprovement)
  };
}

function loadSafe(path) {
  const doc = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!doc || doc.schema_version !== 1 || !Array.isArray(doc.rows)) throw new Error("invalid safe corpus");
  return doc.rows;
}

function buildReport(parityRows) {
  const parity = evaluateDevelopment(parityRows, 2);
  const synthetic = evaluateDevelopment(syntheticRows(), 0);
  return {
    report_version: 1,
    generated_from_content_free_rows_only: true,
    withheld_splits_scored: false,
    target_coverage_pct: TARGET_COVERAGE * 100,
    candidate: CANDIDATE,
    guardrails: GUARDRAILS,
    parity,
    synthetic,
    development_gate_pass: parity.gate.pass && synthetic.gate.pass
  };
}

function main() {
  const safePath = process.argv[2];
  const destination = process.argv[3];
  if (!safePath) {
    throw new Error("usage: node evaluate-archetype-recency.cjs <local-safe.json> [aggregate-results.json]");
  }
  const report = buildReport(loadSafe(safePath));
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (destination) fs.writeFileSync(destination, json, { flag: "w" });
  process.stdout.write(json);
}

if (require.main === module) main();
module.exports = { CANDIDATE, GUARDRAILS, buildReport, developmentOnly, evaluateDevelopment, gate };
