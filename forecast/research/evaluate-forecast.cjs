"use strict";

const crypto = require("crypto");
const fs = require("fs");
const Forecaster = require("../forecaster.js");
const CandidateForecaster = require("./forecaster-project-history-candidate.cjs");

const TARGET_COVERAGE = 0.80;
const PROTOCOL = Object.freeze({
  fit_fraction: 0.55,
  calibration_fraction: 0.20,
  development_fraction: 0.10,
  sealed_test_fraction: 0.15,
  primary_metric: "description coverage absolute gap from 80%",
  guardrails: {
    median_absolute_log_error_relative_regression_max: 0.05,
    median_interval_ratio_multiplier_max: 1.25
  }
});
const CANDIDATE_OPTS = Object.freeze({ projectHistory: true, projectK: 20, projectMinN: 3 });

function sha(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value, digits = 6) {
  if (value === null || !Number.isFinite(value)) return null;
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

function splitFrozen(rows) {
  const n = rows.length;
  const nFit = Math.floor(n * PROTOCOL.fit_fraction);
  const nCal = Math.floor(n * PROTOCOL.calibration_fraction);
  const nDev = Math.floor(n * PROTOCOL.development_fraction);
  const nTest = n - nFit - nCal - nDev;
  if (nFit < 2 || nCal < 1 || nDev < 1 || nTest < 1) throw new Error("corpus is too small");
  return {
    fit: rows.slice(0, nFit),
    calibration: rows.slice(nFit, nFit + nCal),
    development: rows.slice(nFit + nCal, nFit + nCal + nDev),
    sealed_test: rows.slice(nFit + nCal + nDev),
    counts: { fit: nFit, calibration: nCal, development: nDev, sealed_test: nTest }
  };
}

function splitBrowser(rows) {
  const nTest = Math.max(2, Math.round(rows.length * 0.20));
  const rest = rows.length - nTest;
  const nCal = Math.max(1, Math.round(rest * 0.25));
  const nFit = rest - nCal;
  return {
    fit: rows.slice(0, nFit),
    calibration: rows.slice(nFit, nFit + nCal),
    test: rows.slice(nFit + nCal),
    counts: { fit: nFit, calibration: nCal, test: nTest }
  };
}

function evaluate(fit, calibration, test, opts, engine) {
  engine = engine || Forecaster;
  const priors = engine.fitPriors(fit, opts || {});
  engine.calibrate(priors, calibration);
  const output = {};
  for (const mode of ["description", "oracle"]) {
    let hits = 0;
    const rel = [];
    const absLog = [];
    const ratios = [];
    for (const row of test) {
      const band = engine.forecast(row, priors, mode);
      if (row.cost_usd >= band.p10 && row.cost_usd <= band.p90) hits += 1;
      rel.push(Math.abs(band.p50 - row.cost_usd) / row.cost_usd);
      absLog.push(Math.abs(Math.log(row.cost_usd / band.p50)));
      ratios.push(band.p90 / band.p10);
    }
    const coverage = hits / test.length;
    output[mode] = {
      n: test.length,
      hits,
      coverage_pct: round(coverage * 100, 3),
      calibration_gap_pct: round(Math.abs(coverage - TARGET_COVERAGE) * 100, 3),
      median_relative_error_pct: round(median(rel) * 100, 3),
      median_absolute_log_error: round(median(absLog), 6),
      median_interval_ratio_p90_p10: round(median(ratios), 6)
    };
  }
  return output;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function normal(random) {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function syntheticRows() {
  const random = seededRandom(17072026);
  const projects = ["project_001", "project_002", "project_003", "project_004", "project_005", "project_006"];
  const archetypes = ["qa_short", "debug_fix", "research_summarize", "build_new"];
  const projectOffset = [-0.85, -0.45, -0.10, 0.20, 0.55, 0.95];
  const archetypeBase = [-1.10, -0.20, 0.35, 0.85];
  const rows = [];
  for (let i = 0; i < 720; i += 1) {
    const projectIndex = (i * 5 + Math.floor(random() * projects.length)) % projects.length;
    const archIndex = (i * 3 + Math.floor(random() * archetypes.length)) % archetypes.length;
    const drift = 0.00045 * i;
    const logCost = archetypeBase[archIndex] + projectOffset[projectIndex] + drift + normal(random) * 0.32;
    const turns = Math.max(1, Math.round(Math.exp(2.0 + archIndex * 0.35 + normal(random) * 0.28)));
    rows.push({
      order: i,
      project: projects[projectIndex],
      archetype: archetypes[archIndex],
      cost_usd: Math.exp(logCost),
      turn_count: turns
    });
  }
  return rows;
}

function loadSafe(path) {
  const doc = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!doc || doc.schema_version !== 1 || !Array.isArray(doc.rows)) throw new Error("invalid safe corpus");
  return doc.rows;
}

function baselineReport(rows, label) {
  const frozen = splitFrozen(rows);
  const browser = splitBrowser(rows);
  return {
    corpus: label,
    sample_size: rows.length,
    archetype_source: "precomputed content-free label; raw-text classifier not rerun",
    corpus_hash: sha(rows),
    protocol: PROTOCOL,
    frozen_split: {
      counts: frozen.counts,
      membership_hash: sha({
        fit: frozen.fit.map(r => r.order),
        calibration: frozen.calibration.map(r => r.order),
        development: frozen.development.map(r => r.order),
        sealed_test: frozen.sealed_test.map(r => r.order)
      })
    },
    browser_split_baseline: {
      counts: browser.counts,
      metrics: evaluate(browser.fit, browser.calibration, browser.test, {})
    },
    development_baseline: evaluate(frozen.fit, frozen.calibration, frozen.development, {})
  };
}

function metricGate(baseline, candidate, minimumGapImprovement) {
  const gapImprovement = baseline.calibration_gap_pct - candidate.calibration_gap_pct;
  const errorRatio = candidate.median_absolute_log_error / baseline.median_absolute_log_error;
  const widthRatio = candidate.median_interval_ratio_p90_p10 / baseline.median_interval_ratio_p90_p10;
  return {
    pass: gapImprovement >= minimumGapImprovement &&
      errorRatio <= 1 + PROTOCOL.guardrails.median_absolute_log_error_relative_regression_max &&
      widthRatio <= PROTOCOL.guardrails.median_interval_ratio_multiplier_max,
    coverage_gap_improvement_pct_points: round(gapImprovement, 3),
    median_absolute_log_error_ratio: round(errorRatio, 6),
    median_interval_ratio_multiplier: round(widthRatio, 6)
  };
}

function candidateDevelopment(rows) {
  const split = splitFrozen(rows);
  const baseline = evaluate(split.fit, split.calibration, split.development, {});
  const candidate = evaluate(split.fit, split.calibration, split.development, CANDIDATE_OPTS, CandidateForecaster);
  return { baseline, candidate, gate: metricGate(baseline.description, candidate.description, 2) };
}

function main() {
  const safePath = process.argv[2];
  const destination = process.argv[3];
  const phase = process.argv[4] || "baseline";
  if (!safePath) throw new Error("usage: node evaluate-forecast.cjs <local safe.json> [aggregate-results.json] [candidate-development]");
  const report = {
    report_version: 1,
    generated_from_content_free_rows_only: true,
    parity: baselineReport(loadSafe(safePath), "private-parity-snapshot"),
    synthetic: baselineReport(syntheticRows(), "seeded-synthetic-v1")
  };
  if (phase === "candidate-development") {
    report.candidate = CANDIDATE_OPTS;
    report.parity.candidate_development = candidateDevelopment(loadSafe(safePath));
    report.synthetic.candidate_development = candidateDevelopment(syntheticRows());
    report.development_gate_pass = report.parity.candidate_development.gate.pass &&
      report.synthetic.candidate_development.gate.pass;
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (destination) fs.writeFileSync(destination, json, { flag: "w" });
  process.stdout.write(json);
}

if (require.main === module) main();
module.exports = { CANDIDATE_OPTS, PROTOCOL, baselineReport, candidateDevelopment, evaluate, splitFrozen, syntheticRows };
