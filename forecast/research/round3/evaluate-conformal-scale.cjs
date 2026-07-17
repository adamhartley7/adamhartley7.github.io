"use strict";

const crypto = require("crypto");
const fs = require("fs");
const BaseForecaster = require("../../forecaster.js");
const { evaluate, syntheticRows } = require("../evaluate-forecast.cjs");

const TARGET_COVERAGE = 0.80;
const SPLIT = Object.freeze({
  fit: 0.55,
  calibration: 0.20,
  conformal_fit_share_of_calibration: 0.75,
  development: 0.10,
  sealed: 0.15
});
const GATE = Object.freeze({
  parity_minimum_coverage_gap_improvement_pct_points: 2,
  synthetic_minimum_coverage_gap_improvement_pct_points: 0,
  error_ratio_max: 1.001,
  width_ratio_min: 0.50,
  width_ratio_max: 1.25
});
const CANDIDATE = Object.freeze({
  name: "nested_recent_global_conformal_scale",
  target_coverage_pct: TARGET_COVERAGE * 100,
  changes_point_forecast: false,
  uses_raw_text: false,
  uses_original_project_identifier: false,
  uses_realised_turn_count_in_description_mode: false,
  tuned_on_development: false
});

function round(value, digits = 6) {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function finiteSampleQuantile(values, targetCoverage = TARGET_COVERAGE) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("scale-fit scores are required");
  if (!(targetCoverage > 0 && targetCoverage < 1)) throw new RangeError("target coverage must be between zero and one");
  const clean = values.map(Number);
  if (clean.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error("scale-fit scores must be finite and non-negative");
  }
  clean.sort((a, b) => a - b);
  const rank = Math.min(clean.length, Math.ceil((clean.length + 1) * targetCoverage));
  return clean[rank - 1];
}

function splitDevelopmentOnly(rows) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  const count = rows.length;
  const fitCount = Math.floor(count * SPLIT.fit);
  const calibrationCount = Math.floor(count * SPLIT.calibration);
  const conformalFitCount = Math.floor(calibrationCount * SPLIT.conformal_fit_share_of_calibration);
  const scaleFitCount = calibrationCount - conformalFitCount;
  const developmentCount = Math.floor(count * SPLIT.development);
  const developmentEnd = fitCount + calibrationCount + developmentCount;
  const sealedCount = count - developmentEnd;
  if (fitCount < 2 || conformalFitCount < 1 || scaleFitCount < 1 || developmentCount < 1 || sealedCount < 1) {
    throw new Error("corpus is too small");
  }
  return {
    fit: rows.slice(0, fitCount),
    conformal_fit: rows.slice(fitCount, fitCount + conformalFitCount),
    scale_fit: rows.slice(fitCount + conformalFitCount, fitCount + calibrationCount),
    full_calibration: rows.slice(fitCount, fitCount + calibrationCount),
    development: rows.slice(fitCount + calibrationCount, developmentEnd),
    counts: {
      fit: fitCount,
      conformal_fit: conformalFitCount,
      scale_fit: scaleFitCount,
      development: developmentCount,
      sealed: sealedCount
    }
  };
}

function scaleBand(band, scale) {
  if (!band || !(band.p10 > 0) || !(band.p50 > 0) || !(band.p90 > 0)) {
    throw new Error("base band must be finite and positive");
  }
  if (!Number.isFinite(scale) || scale < 0) throw new Error("interval scale must be finite and non-negative");
  const p10 = band.p50 * ((band.p10 / band.p50) ** scale);
  const p90 = band.p50 * ((band.p90 / band.p50) ** scale);
  return { p10, p50: band.p50, p90 };
}

function learnScale(priors, rows) {
  const ratios = [];
  for (const row of rows) {
    const band = BaseForecaster.forecast(row, priors, "description");
    const halfWidth = Math.log(band.p90 / band.p50);
    const absoluteLogError = Math.abs(Math.log(Number(row.cost_usd) / band.p50));
    if (!(halfWidth > 0) || !Number.isFinite(absoluteLogError)) {
      throw new Error("invalid scale-fit forecast");
    }
    ratios.push(absoluteLogError / halfWidth);
  }
  return {
    scale: finiteSampleQuantile(ratios),
    rows_used: ratios.length
  };
}

function metrics(rows, forecastBand) {
  let hits = 0;
  let validBands = true;
  const relativeErrors = [];
  const absoluteLogErrors = [];
  const intervalRatios = [];
  for (const row of rows) {
    const band = forecastBand(row);
    const ordered = Number.isFinite(band.p10) && Number.isFinite(band.p50) && Number.isFinite(band.p90) &&
      band.p10 > 0 && band.p10 <= band.p50 && band.p50 <= band.p90;
    if (!ordered) validBands = false;
    if (Number(row.cost_usd) >= band.p10 && Number(row.cost_usd) <= band.p90) hits += 1;
    relativeErrors.push(Math.abs(band.p50 - Number(row.cost_usd)) / Number(row.cost_usd));
    absoluteLogErrors.push(Math.abs(Math.log(Number(row.cost_usd) / band.p50)));
    intervalRatios.push(band.p90 / band.p10);
  }
  const coverage = hits / rows.length;
  return {
    n: rows.length,
    hits,
    coverage_pct: round(coverage * 100, 3),
    calibration_gap_pct: round(Math.abs(coverage - TARGET_COVERAGE) * 100, 3),
    median_relative_error_pct: round(median(relativeErrors) * 100, 3),
    median_absolute_log_error: round(median(absoluteLogErrors), 6),
    median_interval_ratio_p90_p10: round(median(intervalRatios), 6),
    all_bands_finite_positive_ordered: validBands
  };
}

function gate(baseline, candidate, minimumCoverageGapImprovement) {
  const coverageGapImprovement = baseline.calibration_gap_pct - candidate.calibration_gap_pct;
  const errorRatio = candidate.median_absolute_log_error / baseline.median_absolute_log_error;
  const widthRatio = candidate.median_interval_ratio_p90_p10 / baseline.median_interval_ratio_p90_p10;
  return {
    pass: coverageGapImprovement >= minimumCoverageGapImprovement &&
      errorRatio <= GATE.error_ratio_max &&
      widthRatio >= GATE.width_ratio_min &&
      widthRatio <= GATE.width_ratio_max &&
      candidate.all_bands_finite_positive_ordered,
    coverage_gap_improvement_pct_points: round(coverageGapImprovement, 3),
    median_absolute_log_error_ratio: round(errorRatio),
    median_interval_ratio_multiplier: round(widthRatio),
    all_bands_finite_positive_ordered: candidate.all_bands_finite_positive_ordered
  };
}

function hashMembership(split) {
  return crypto.createHash("sha256").update(JSON.stringify({
    fit: split.fit.map(row => row.order),
    conformal_fit: split.conformal_fit.map(row => row.order),
    scale_fit: split.scale_fit.map(row => row.order),
    development: split.development.map(row => row.order)
  })).digest("hex");
}

function evaluateDevelopment(rows, minimumCoverageGapImprovement) {
  const split = splitDevelopmentOnly(rows);
  const baseline = evaluate(split.fit, split.full_calibration, split.development, {}).description;

  const priors = BaseForecaster.fitPriors(split.fit, {});
  BaseForecaster.calibrate(priors, split.conformal_fit);
  const learned = learnScale(priors, split.scale_fit);
  const candidate = metrics(split.development, row => scaleBand(
    BaseForecaster.forecast(row, priors, "description"),
    learned.scale
  ));

  return {
    counts: split.counts,
    unsealed_membership_hash: hashMembership(split),
    scale_fit: {
      rows_used: learned.rows_used,
      interval_scale: round(learned.scale)
    },
    baseline,
    candidate,
    gate: gate(baseline, candidate, minimumCoverageGapImprovement)
  };
}

function loadSafe(path) {
  const document = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!document || document.schema_version !== 1 || !Array.isArray(document.rows)) {
    throw new Error("invalid safe corpus");
  }
  return document.rows;
}

function buildReport(parityRows) {
  const parity = evaluateDevelopment(
    parityRows,
    GATE.parity_minimum_coverage_gap_improvement_pct_points
  );
  const synthetic = evaluateDevelopment(
    syntheticRows(),
    GATE.synthetic_minimum_coverage_gap_improvement_pct_points
  );
  return {
    report_version: 1,
    generated_from_content_free_rows_only: true,
    sealed_splits_scored: false,
    candidate: CANDIDATE,
    split: SPLIT,
    gate_thresholds: GATE,
    parity,
    synthetic,
    development_gate_pass: parity.gate.pass && synthetic.gate.pass
  };
}

function main() {
  const safePath = process.argv[2];
  const destination = process.argv[3];
  if (!safePath) {
    throw new Error("usage: node evaluate-conformal-scale.cjs <local-safe.json> [aggregate-results.json]");
  }
  const report = buildReport(loadSafe(safePath));
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (destination) fs.writeFileSync(destination, json, { flag: "w" });
  process.stdout.write(json);
}

if (require.main === module) main();
module.exports = {
  CANDIDATE,
  GATE,
  SPLIT,
  buildReport,
  evaluateDevelopment,
  finiteSampleQuantile,
  gate,
  learnScale,
  metrics,
  scaleBand,
  splitDevelopmentOnly
};
