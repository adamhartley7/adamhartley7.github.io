#!/usr/bin/env node
"use strict";

/*
 * Exploratory ABE method screen for TOP-1.
 *
 * Privacy boundary:
 * - Private prompt excerpts are read only in memory.
 * - The CLI emits aggregate counts and metrics only.
 * - No prompt, session identifier, project value, model value, timestamp, or hash is emitted.
 *
 * Research boundary:
 * - This is not product code.
 * - runScreen never accesses or scores the final 15 percent of prepared records.
 *   The CLI loader parses the full CSV to establish the eligible chronological
 *   corpus, so it is not a holdout-preserving import boundary. The Adam corpus's
 *   old holdout is also marked compromised because a discarded earlier diagnostic
 *   inspected prompt identities before this guard was added.
 * - The method screen is exploratory because its hypotheses were written after the
 *   private corpus already existed.
 */

const fs = require("node:fs");

const ALPHA = 0.20;
const K = 3;
const CQR_K = 20;
const HASH_DIMS = 48;
const MIN_STRATUM = 20;
const DAY_MS = 86400000;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error("unterminated quoted CSV field");
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function wordsOf(normalized) {
  return normalized.match(/[\p{L}\p{N}_]+/gu) || [];
}

function fnv1a(value) {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function uniqueSortedNumbers(values) {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function lexicalFeatures(words, normalized) {
  const unigrams = uniqueSortedNumbers(words.map(fnv1a));
  const trigrams = [];
  if (words.length < 3 && words.length) trigrams.push(fnv1a(words.join("\u0001")));
  for (let i = 0; i + 2 < words.length; i++) {
    trigrams.push(fnv1a(words[i] + "\u0001" + words[i + 1] + "\u0001" + words[i + 2]));
  }
  const vector = new Array(HASH_DIMS).fill(0);
  for (const word of words) {
    const h = fnv1a(word);
    const bucket = h % HASH_DIMS;
    vector[bucket] += (h & 0x80000000) ? -1 : 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  }
  const uniqueRatio = words.length ? new Set(words).size / words.length : 0;
  const digitCount = (normalized.match(/[0-9]/g) || []).length;
  const digitFraction = normalized.length ? digitCount / normalized.length : 0;
  vector.push(Math.log1p(words.length));
  vector.push(uniqueRatio);
  vector.push(digitFraction);
  return {
    unigrams,
    trigrams: uniqueSortedNumbers(trigrams),
    vector,
    wordCount: words.length,
    charCount: normalized.length,
    uniqueRatio,
    digitFraction
  };
}

function prepareRecord(raw, sourceOrder) {
  const normalized = normalizeText(raw.description_excerpt || raw.description || "");
  const words = wordsOf(normalized);
  const lex = lexicalFeatures(words, normalized);
  return {
    sourceOrder,
    ts: Number(raw.ts),
    y: Math.log(Number(raw.cost_usd)),
    normalized,
    promptHash: fnv1a(normalized),
    project: String(raw.project || ""),
    archetype: String(raw.archetype || "unknown"),
    ...lex
  };
}

function loadPrivateCsv(filePath) {
  const parsed = parseCsv(fs.readFileSync(filePath, "utf8"));
  if (parsed.length < 2) throw new Error("CSV has no data rows");
  const header = parsed[0];
  const at = new Map(header.map((name, index) => [name, index]));
  for (const required of ["description_excerpt", "cost_usd", "start_ts"]) {
    if (!at.has(required)) throw new Error("missing required CSV column: " + required);
  }
  const out = [];
  for (let i = 1; i < parsed.length; i++) {
    const cells = parsed[i];
    const get = (name) => at.has(name) ? (cells[at.get(name)] || "") : "";
    const cost = Number(get("cost_usd"));
    const ts = Date.parse(get("start_ts"));
    const description = get("description_excerpt");
    if (!(cost > 0) || !Number.isFinite(ts) || !description.trim()) continue;
    out.push(prepareRecord({
      description_excerpt: description,
      cost_usd: cost,
      ts,
      project: get("project"),
      archetype: get("archetype")
    }, i - 1));
  }
  out.sort((a, b) => (a.ts - b.ts) || (a.sourceOrder - b.sourceOrder));
  return out;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function linearQuantile(values, probability) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  if (probability <= 0) return sorted[0];
  if (probability >= 1) return sorted[sorted.length - 1];
  const index = probability * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const fraction = index - lo;
  return sorted[lo] * (1 - fraction) + sorted[hi] * fraction;
}

function upperOrderQuantile(values, probability) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.ceil((sorted.length + 1) * probability);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

function centralOrderInterval(values, alpha) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const lowerRank = Math.floor((sorted.length + 1) * alpha / 2);
  const upperRank = Math.ceil((sorted.length + 1) * (1 - alpha / 2));
  return [
    sorted[Math.max(0, Math.min(sorted.length - 1, lowerRank - 1))],
    sorted[Math.max(0, Math.min(sorted.length - 1, upperRank - 1))]
  ];
}

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  let i = 0;
  let j = 0;
  let intersection = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      intersection++;
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return intersection / (a.length + b.length - intersection);
}

function robustScaler(records) {
  if (!records.length) throw new Error("robustScaler requires records");
  const dims = records[0].vector.length;
  const centers = [];
  const scales = [];
  const active = [];
  for (let d = 0; d < dims; d++) {
    const values = records.map((record) => record.vector[d]);
    const center = median(values);
    const mad = median(values.map((value) => Math.abs(value - center)));
    const iqr = linearQuantile(values, 0.75) - linearQuantile(values, 0.25);
    let scale = 1.4826 * mad;
    if (!(scale > 1e-12)) scale = iqr / 1.349;
    centers.push(center);
    scales.push(scale);
    if (scale > 1e-12) active.push(d);
  }
  return { centers, scales, active };
}

function vectorDistance(a, b, scaler, kind) {
  if (!scaler.active.length) return Infinity;
  let sum = 0;
  for (const d of scaler.active) {
    const delta = (a.vector[d] - b.vector[d]) / scaler.scales[d];
    sum += kind === "euclidean" ? delta * delta : Math.abs(delta);
  }
  if (kind === "euclidean") return Math.sqrt(sum / scaler.active.length);
  return sum / scaler.active.length;
}

function pastOnly(query, history) {
  return history.filter((candidate) => candidate.ts < query.ts);
}

function topByDistance(query, history, k, distance) {
  const scored = pastOnly(query, history).map((candidate) => ({
    candidate,
    distance: distance(query, candidate)
  }));
  scored.sort((a, b) => (a.distance - b.distance) || (b.candidate.ts - a.candidate.ts));
  return scored.slice(0, Math.min(k, scored.length));
}

function rankValues(items, valueOf, ascending) {
  const sorted = items.map((item, index) => ({ index, value: valueOf(item) }));
  sorted.sort((a, b) => {
    const delta = ascending ? a.value - b.value : b.value - a.value;
    return delta || a.index - b.index;
  });
  const ranks = new Array(items.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].value === sorted[i].value) j++;
    const averageRank = (i + 1 + j) / 2;
    for (let p = i; p < j; p++) ranks[sorted[p].index] = averageRank;
    i = j;
  }
  return ranks;
}

function topBorda(query, history, k, scaler) {
  const candidates = pastOnly(query, history);
  if (!candidates.length) return [];
  const voters = [
    [candidate => jaccard(query.trigrams, candidate.trigrams), false],
    [candidate => Math.abs(Math.log1p(query.wordCount) - Math.log1p(candidate.wordCount)), true],
    [candidate => Math.abs(query.uniqueRatio - candidate.uniqueRatio), true],
    [candidate => Math.abs(query.digitFraction - candidate.digitFraction), true],
    [candidate => query.project === candidate.project ? 0 : 1, true]
  ];
  const totals = new Array(candidates.length).fill(0);
  for (const [valueOf, ascending] of voters) {
    const ranks = rankValues(candidates, valueOf, ascending);
    for (let i = 0; i < totals.length; i++) totals[i] += ranks[i];
  }
  const ranked = candidates.map((candidate, index) => ({
    candidate,
    distance: totals[index] / voters.length
  }));
  ranked.sort((a, b) => (a.distance - b.distance) || (b.candidate.ts - a.candidate.ts));
  return ranked.slice(0, Math.min(k, ranked.length));
}

function recencyWeightedMedian(query, history, halfLifeDays) {
  const candidates = pastOnly(query, history);
  if (!candidates.length) return null;
  const rows = candidates.map((candidate) => ({
    y: candidate.y,
    weight: Math.pow(0.5, Math.max(0, query.ts - candidate.ts) / (DAY_MS * halfLifeDays))
  })).filter((row) => row.weight > 0);
  rows.sort((a, b) => a.y - b.y);
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  let cumulative = 0;
  for (const row of rows) {
    cumulative += row.weight;
    if (cumulative >= total / 2) return row.y;
  }
  return rows[rows.length - 1].y;
}

function nearest(query, history, method, k, scaler) {
  if (method === "jaccard") {
    return topByDistance(query, history, k,
      (a, b) => 1 - jaccard(a.trigrams, b.trigrams));
  }
  if (method === "manhattan") {
    return topByDistance(query, history, k,
      (a, b) => vectorDistance(a, b, scaler, "manhattan"));
  }
  if (method === "euclidean") {
    return topByDistance(query, history, k,
      (a, b) => vectorDistance(a, b, scaler, "euclidean"));
  }
  if (method === "borda") return topBorda(query, history, k, scaler);
  throw new Error("unknown retrieval method: " + method);
}

function predictPoint(query, history, method, scaler, k = K) {
  if (method === "recency") {
    return { pred: recencyWeightedMedian(query, history, 5), neighbours: [] };
  }
  const neighbours = nearest(query, history, method, k, scaler);
  return {
    pred: neighbours.length ? median(neighbours.map((item) => item.candidate.y)) : null,
    neighbours
  };
}

function splitCorpus(records) {
  const fitEnd = Math.floor(records.length * 0.55);
  const calEnd = fitEnd + Math.floor(records.length * 0.20);
  const devEnd = calEnd + Math.floor(records.length * 0.10);
  return {
    fit: records.slice(0, fitEnd),
    calibration: records.slice(fitEnd, calEnd),
    development: records.slice(calEnd, devEnd),
    sealed: records.slice(devEnd)
  };
}

function sequentialPredictions(rows, initialHistory, method, scaler, k = K) {
  // Split-conformal screen: calibration labels never enter the fitted predictor.
  const history = initialHistory.slice();
  const out = [];
  for (const query of rows) {
    const prediction = predictPoint(query, history, method, scaler, k);
    if (prediction.pred !== null) out.push({ query, ...prediction });
  }
  return { predictions: out, history };
}

function buildResidualStrata(calibrationPredictions) {
  const buckets = new Map();
  function add(key, residual) {
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(residual);
  }
  for (const row of calibrationPredictions) {
    const residual = row.query.y - row.pred;
    add("all", residual);
    add("arch:" + row.query.archetype, residual);
  }
  return buckets;
}

function chooseResidualBucket(query, buckets) {
  const keys = [
    "arch:" + query.archetype,
    "all"
  ];
  for (const key of keys) {
    const values = buckets.get(key) || [];
    if (key === "all" || values.length >= MIN_STRATUM) return { key, values };
  }
  return { key: "all", values: buckets.get("all") || [] };
}

function intervalMetrics(rows, alpha = ALPHA) {
  if (!rows.length) return null;
  let hits = 0;
  let lowerMisses = 0;
  let upperMisses = 0;
  let finiteIntervals = 0;
  let bias = 0;
  let scoreSum = 0;
  const errors = [];
  const ratios = [];
  const relativeWidths = [];
  for (const row of rows) {
    const { y, pred, lo, hi } = row;
    if (!(lo <= pred && pred <= hi)) {
      throw new Error("interval invariant failed: expected lo <= point <= hi");
    }
    if (Number.isFinite(lo) && Number.isFinite(hi)) finiteIntervals++;
    if (y >= lo && y <= hi) hits++;
    else if (y < lo) lowerMisses++;
    else upperMisses++;
    const width = hi - lo;
    let score = width;
    if (y < lo) score += (2 / alpha) * (lo - y);
    if (y > hi) score += (2 / alpha) * (y - hi);
    scoreSum += score;
    bias += pred - y;
    errors.push(Math.abs(pred - y));
    ratios.push(Number.isFinite(width) ? Math.exp(width) : Infinity);
    relativeWidths.push(Math.exp(hi - pred) - Math.exp(lo - pred));
  }
  return {
    n: rows.length,
    finite_interval_rate: finiteIntervals / rows.length,
    coverage: hits / rows.length,
    lower_tail_miss_rate: lowerMisses / rows.length,
    upper_tail_miss_rate: upperMisses / rows.length,
    median_abs_log_error: median(errors),
    mean_log_bias: bias / rows.length,
    median_p90_p10_ratio: median(ratios),
    p90_p90_p10_ratio: linearQuantile(ratios, 0.90),
    median_relative_width: median(relativeWidths),
    mean_log_interval_score: scoreSum / rows.length
  };
}

function roundMetrics(value) {
  if (Array.isArray(value)) return value.map(roundMetrics);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = roundMetrics(item);
    return out;
  }
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(6));
  if (value === Infinity) return "infinite";
  if (value === -Infinity) return "negative_infinite";
  return value;
}

function symmetricBandRows(calPredictions, devPredictions) {
  const residuals = calPredictions.map((row) => Math.abs(row.query.y - row.pred));
  const q = upperOrderQuantile(residuals, 1 - ALPHA);
  return {
    calibration_q: q,
    rows: devPredictions.map((row) => ({
      y: row.query.y,
      pred: row.pred,
      lo: row.pred - q,
      hi: row.pred + q
    }))
  };
}

function localAsymmetricRows(calPredictions, devPredictions) {
  const buckets = buildResidualStrata(calPredictions);
  const fallbackCounts = { archetype: 0, global: 0 };
  const rows = devPredictions.map((row) => {
    const selected = chooseResidualBucket(row.query, buckets);
    if (selected.key.startsWith("arch:")) fallbackCounts.archetype++;
    else fallbackCounts.global++;
    const interval = centralOrderInterval(selected.values, ALPHA);
    const rawLo = row.pred + interval[0];
    const rawHi = row.pred + interval[1];
    return {
      y: row.query.y,
      pred: row.pred,
      lo: Math.min(row.pred, rawLo),
      hi: Math.max(row.pred, rawHi)
    };
  });
  return { fallback_counts: fallbackCounts, rows };
}

function jaccardDensityScale(prediction) {
  if (!prediction.neighbours.length) return null;
  return prediction.neighbours.reduce((sum, item) => sum + item.distance, 0);
}

function densityReference(fit, scaler) {
  const values = [];
  for (let i = K; i < fit.length; i++) {
    const prediction = predictPoint(fit[i], fit.slice(0, i), "jaccard", scaler, K);
    const raw = jaccardDensityScale(prediction);
    if (raw !== null) values.push(raw);
  }
  return median(values) || 1;
}

function distanceNormalizedRows(calPredictions, devPredictions, densityMedian) {
  const scores = calPredictions.map((row) => {
    const lambda = jaccardDensityScale(row) / densityMedian;
    return Math.abs(row.query.y - row.pred) / (1 + lambda);
  });
  const q = upperOrderQuantile(scores, 1 - ALPHA);
  return {
    calibration_q: q,
    density_reference: densityMedian,
    rows: devPredictions.map((row) => {
      const lambda = jaccardDensityScale(row) / densityMedian;
      const halfWidth = q * (1 + lambda);
      return { y: row.query.y, pred: row.pred, lo: row.pred - halfWidth, hi: row.pred + halfWidth };
    })
  };
}

function weightedResidualQuantile(calPredictions, query, probability, halfLifeDays) {
  const finite = calPredictions.map((row) => ({
    value: Math.abs(row.query.y - row.pred),
    weight: Math.pow(0.5, Math.max(0, query.ts - row.query.ts) / (DAY_MS * halfLifeDays))
  })).filter((row) => row.weight > 0).sort((a, b) => a.value - b.value);
  const finiteWeight = finite.reduce((sum, row) => sum + row.weight, 0);
  const totalWeight = finiteWeight + 1;
  const target = probability * totalWeight;
  let cumulative = 0;
  for (const row of finite) {
    cumulative += row.weight;
    if (cumulative >= target) return row.value;
  }
  return Infinity;
}

function recencyConformalRows(calPredictions, devPredictions) {
  let infinite = 0;
  const rows = devPredictions.map((row) => {
    const q = weightedResidualQuantile(calPredictions, row.query, 1 - ALPHA, 5);
    if (!Number.isFinite(q)) infinite++;
    return { y: row.query.y, pred: row.pred, lo: row.pred - q, hi: row.pred + q };
  });
  return { half_life_days: 5, infinite_intervals: infinite, rows };
}

function sequentialCqr(rows, initialHistory, scaler) {
  // The point and conditional quantile models are fixed on fit records for both
  // calibration and development. CQR changes only the band around the same
  // Jaccard k=3 point used by the baseline screen.
  const history = initialHistory.slice();
  const out = [];
  for (const query of rows) {
    const neighbours = nearest(query, history, "jaccard", CQR_K, scaler);
    const point = predictPoint(query, history, "jaccard", scaler, K);
    if (neighbours.length && point.pred !== null) {
      const labels = neighbours.map((item) => item.candidate.y);
      out.push({
        query,
        pred: point.pred,
        rawLo: linearQuantile(labels, ALPHA / 2),
        rawHi: linearQuantile(labels, 1 - ALPHA / 2)
      });
    }
  }
  return { predictions: out, history };
}

function cqrRows(calPredictions, devPredictions) {
  const scores = calPredictions.map((row) => Math.max(row.rawLo - row.query.y, row.query.y - row.rawHi));
  const rawCorrection = upperOrderQuantile(scores, 1 - ALPHA);
  // TOP must always render an ordered P10 <= point <= P90 band. A negative CQR
  // correction can tighten a raw interval past its point, so this screen applies
  // only non-negative corrections. This is conservative and is declared in output.
  const correction = Math.max(0, rawCorrection);
  return {
    k: CQR_K,
    raw_calibration_correction: rawCorrection,
    calibration_correction: correction,
    rows: devPredictions.map((row) => ({
      y: row.query.y,
      pred: row.pred,
      lo: Math.min(row.pred, row.rawLo - correction),
      hi: Math.max(row.pred, row.rawHi + correction)
    }))
  };
}

function methodPredictions(split, scaler, method, k = K) {
  const cal = sequentialPredictions(split.calibration, split.fit, method, scaler, k);
  const dev = sequentialPredictions(split.development, split.fit, method, scaler, k);
  return { calibration: cal.predictions, development: dev.predictions };
}

function exactDuplicateStats(records) {
  const counts = new Map();
  for (const row of records) counts.set(row.normalized, (counts.get(row.normalized) || 0) + 1);
  let duplicateRows = 0;
  let maxMultiplicity = 0;
  for (const count of counts.values()) {
    duplicateRows += Math.max(0, count - 1);
    maxMultiplicity = Math.max(maxMultiplicity, count);
  }
  return {
    unique_normalized_prompts: counts.size,
    exact_duplicate_rows: duplicateRows,
    max_exact_prompt_multiplicity: maxMultiplicity
  };
}

function deduplicateFirstPrompt(records) {
  const seen = new Set();
  const out = [];
  for (const row of records) {
    if (seen.has(row.normalized)) continue;
    seen.add(row.normalized);
    out.push(row);
  }
  return out;
}

function screenSplit(split, label) {
  if (split.fit.length < 20 || split.calibration.length < 10 || split.development.length < 5) {
    const splitUnique = (rows) => new Set(rows.map((row) => row.normalized)).size;
    return {
      label,
      status: "not_run_insufficient_presealed_rows_after_sensitivity_filter",
      split: {
        fit: split.fit.length,
        calibration: split.calibration.length,
        development: split.development.length,
        sealed_not_evaluated: split.sealedCount,
        fit_unique_normalized_prompts: splitUnique(split.fit),
        calibration_unique_normalized_prompts: splitUnique(split.calibration),
        development_unique_normalized_prompts: splitUnique(split.development)
      }
    };
  }
  const scaler = robustScaler(split.fit);
  const pointMethods = ["recency", "jaccard", "manhattan", "euclidean", "borda"];
  const pointRuns = {};
  const results = {};
  for (const method of pointMethods) {
    pointRuns[method] = methodPredictions(split, scaler, method);
  }
  const incompleteMethods = pointMethods.filter((method) =>
    pointRuns[method].calibration.length < 10 || pointRuns[method].development.length < 5
  );
  if (incompleteMethods.length) {
    return roundMetrics({
      label,
      status: "not_run_insufficient_strictly_earlier_predictions",
      reason: "strict_timestamp_order_left_too_few_predictions_for_calibration_or_development",
      split: {
        fit: split.fit.length,
        calibration: split.calibration.length,
        development: split.development.length,
        sealed_not_evaluated: split.sealedCount
      },
      prediction_counts: Object.fromEntries(pointMethods.map((method) => [method, {
        calibration: pointRuns[method].calibration.length,
        development: pointRuns[method].development.length
      }]))
    });
  }
  for (const method of pointMethods) {
    const band = symmetricBandRows(pointRuns[method].calibration, pointRuns[method].development);
    results[method + "_symmetric_conformal"] = {
      method: method === "recency" ? "five_day_recency_weighted_median" : method + "_k3",
      band: "global_symmetric_split_conformal",
      calibration_q_log: band.calibration_q,
      metrics: intervalMetrics(band.rows)
    };
  }

  const local = localAsymmetricRows(pointRuns.jaccard.calibration, pointRuns.jaccard.development);
  results.jaccard_local_asymmetric_residual = {
    method: "jaccard_k3",
    band: "signed_log_residual_quantiles_with_archetype_fallback",
    fallback_counts: local.fallback_counts,
    metrics: intervalMetrics(local.rows)
  };

  const densityMedian = densityReference(split.fit, scaler);
  const density = distanceNormalizedRows(
    pointRuns.jaccard.calibration,
    pointRuns.jaccard.development,
    densityMedian
  );
  results.jaccard_distance_normalized_conformal = {
    method: "jaccard_k3",
    band: "distance_normalized_split_conformal_gamma_1",
    calibration_q_log: density.calibration_q,
    density_reference: density.density_reference,
    metrics: intervalMetrics(density.rows)
  };

  const recency = recencyConformalRows(pointRuns.jaccard.calibration, pointRuns.jaccard.development);
  results.jaccard_recency_weighted_conformal = {
    method: "jaccard_k3",
    band: "nonexchangeable_recency_weighted_absolute_residual",
    half_life_days: recency.half_life_days,
    infinite_intervals: recency.infinite_intervals,
    metrics: intervalMetrics(recency.rows)
  };

  const calCqr = sequentialCqr(split.calibration, split.fit, scaler);
  const devCqr = sequentialCqr(split.development, split.fit, scaler);
  const cqr = cqrRows(calCqr.predictions, devCqr.predictions);
  results.jaccard_knn_cqr = {
    method: "jaccard_k3_point_with_jaccard_k20_empirical_quantiles",
    band: "conformalized_knn_quantiles",
    raw_calibration_correction_log: cqr.raw_calibration_correction,
    applied_calibration_correction_log: cqr.calibration_correction,
    negative_correction_clamped_to_zero: true,
    metrics: intervalMetrics(cqr.rows)
  };

  const validityReasons = [];
  if (scaler.active.length === 0) validityReasons.push("fit_prompt_features_have_no_robust_active_dimensions");
  if (split.calibration.length < 30) validityReasons.push("fewer_than_30_calibration_rows");
  if (split.development.length < 30) validityReasons.push("fewer_than_30_development_rows");
  const splitUnique = (rows) => new Set(rows.map((row) => row.normalized)).size;

  return roundMetrics({
    label,
    status: "diagnostic_only",
    presealed_rows_analyzed: split.fit.length + split.calibration.length + split.development.length,
    total_eligible_rows_count: split.fit.length + split.calibration.length + split.development.length + split.sealedCount,
    presealed_duplicate_diagnostic: exactDuplicateStats(
      split.fit.concat(split.calibration, split.development)
    ),
    split: {
      fit: split.fit.length,
      calibration: split.calibration.length,
      development: split.development.length,
      sealed_not_evaluated: split.sealedCount,
      fit_unique_normalized_prompts: splitUnique(split.fit),
      calibration_unique_normalized_prompts: splitUnique(split.calibration),
      development_unique_normalized_prompts: splitUnique(split.development)
    },
    small_sample_warning: split.calibration.length < 30 || split.development.length < 30,
    interpretation: {
      similarity_comparison_interpretable: validityReasons.length === 0,
      reason_codes: validityReasons,
      metrics_are_diagnostic_only: validityReasons.length > 0
    },
    robust_vector: {
      hashed_dimensions: HASH_DIMS,
      total_dimensions: scaler.centers.length,
      active_dimensions: scaler.active.length,
      training_only_scaling: true
    },
    results
  });
}

function makeSyntheticRecords(count = 120) {
  const records = [];
  const baseTs = Date.UTC(2026, 0, 1);
  for (let i = 0; i < count; i++) {
    const family = i % 4;
    const episode = Math.floor(i / 4);
    const text = [
      "fix parser error and add regression test",
      "build upload progress component",
      "research forecasting interval methods",
      "refactor delivery worker scripts"
    ][family] + " episode " + episode;
    const cost = Math.exp(-1 + family * 0.55 + (episode % 5) * 0.03);
    records.push(prepareRecord({
      description_excerpt: text,
      cost_usd: cost,
      ts: baseTs + i * DAY_MS,
      project: "project-" + (family % 2),
      archetype: "type-" + family
    }, i));
  }
  return records;
}

function runScreen(records) {
  const original = splitCorpus(records);
  const frozen = {
    fit: original.fit,
    calibration: original.calibration,
    development: original.development,
    sealedCount: original.sealed.length
  };
  const seen = new Set();
  function firstOnly(rows) {
    const kept = [];
    for (const row of rows) {
      if (seen.has(row.normalized)) continue;
      seen.add(row.normalized);
      kept.push(row);
    }
    return kept;
  }
  // Preserve the original chronological boundaries. The sealed slice is represented
  // only by its count and is never scanned, deduplicated, scored, or moved.
  const deduplicated = {
    fit: firstOnly(frozen.fit),
    calibration: firstOnly(frozen.calibration),
    development: firstOnly(frozen.development),
    sealedCount: frozen.sealedCount
  };
  return {
    schema_version: "top.abe-exploratory-screen.v1",
    status: "exploratory_not_product_evidence",
    target: "single_run_api_equivalent_cost_usd",
    nominal_coverage: 1 - ALPHA,
    protocol: {
      chronological_split: "55_fit_20_calibration_10_development_15_sealed",
      strictly_earlier_donors_only: true,
      predictor_fixed_on_fit_for_calibration_and_development: true,
      reserved_row_objects_accessed_by_run_screen: false,
      reserved_outcomes_scored_by_run_screen: false,
      cli_loader_is_holdout_preserving: false,
      existing_holdout_status: "compromised_by_prior_prompt_identity_inspection",
      fresh_future_holdout_required: true,
      fixed_k: K,
      cqr_k: CQR_K,
      min_residual_stratum: MIN_STRATUM
    },
    privacy: {
      raw_prompt_text_emitted: false,
      session_identifiers_emitted: false,
      project_or_model_values_emitted: false,
      timestamps_emitted: false,
      prompt_hashes_emitted: false
    },
    corpora: {
      all_eligible_rows: screenSplit(frozen, "all_eligible_rows"),
      first_exact_prompt_only: screenSplit(deduplicated, "first_exact_prompt_only")
    }
  };
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length !== 2 || args[0] !== "--data") {
    throw new Error("usage: node backtest-abe-screen.cjs --data <private-sessions.csv>");
  }
  const result = runScreen(loadPrivateCsv(args[1]));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

module.exports = {
  ALPHA,
  K,
  parseCsv,
  normalizeText,
  wordsOf,
  fnv1a,
  lexicalFeatures,
  prepareRecord,
  loadPrivateCsv,
  median,
  linearQuantile,
  upperOrderQuantile,
  centralOrderInterval,
  jaccard,
  robustScaler,
  vectorDistance,
  pastOnly,
  rankValues,
  topBorda,
  predictPoint,
  splitCorpus,
  intervalMetrics,
  localAsymmetricRows,
  cqrRows,
  weightedResidualQuantile,
  deduplicateFirstPrompt,
  makeSyntheticRecords,
  runScreen
};

if (require.main === module) {
  try {
    main(process.argv);
  } catch (error) {
    process.stderr.write(String(error && error.message || error) + "\n");
    process.exitCode = 1;
  }
}
