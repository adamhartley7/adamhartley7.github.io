"use strict";

/*
 * The cold-start refusal.
 *
 * Replaying this engine over a real single-user history in time order, the band contained the
 * outcome 48.3% of the time at 5 completed tasks, 74.1% at 10 and 86.9% at 30. Over the same
 * range the page's own held-out score read 100%, because a held-out split that small has two
 * test tasks in it and two hits out of two is "100%". The band is also at its narrowest at 5
 * tasks, so the page looked most confident exactly where it was least right, in front of the
 * people who had only just started using it.
 *
 * This file pins three behaviours:
 *   1. no band is emitted below FORECAST_MIN_HISTORY completed tasks, and the refusal says why
 *      in words a non-technical reader can act on;
 *   2. a band that IS emitted carries the history count it was fitted on;
 *   3. no coverage percentage is displayed unless the held-out split can honestly support one,
 *      and a rate that is shown carries its own 95% interval.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const forecaster = require("./forecaster.js");

function slice(startNeedle, endNeedle) {
  const start = html.indexOf(startNeedle);
  assert.ok(start >= 0, `missing anchor: ${startNeedle}`);
  const end = html.indexOf(endNeedle, start);
  assert.ok(end > start, `missing closing anchor: ${endNeedle}`);
  return html.slice(start, end);
}

// ---------------------------------------------------------------- shared harness
function makeContext() {
  const context = {
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    RegExp,
    isFinite,
    Forecaster: forecaster,
    fmtPct: (value) => `${value.toFixed(1)}%`,
    fmtN: (value) => Number(value).toLocaleString("en-US"),
    fmt$: (value) => `$${Number(value).toFixed(2)}`,
    esc: (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
  };
  vm.createContext(context);
  vm.runInContext(slice("// ---------- cold-start gate", "function renderBacktest("), context);
  vm.runInContext(slice("function fitQuotePriors(", "function renderQuote("), context);
  return context;
}

const context = makeContext();

// ---------------------------------------------------------------- 1. the gate exists and is 30
assert.equal(context.FORECAST_MIN_HISTORY, 30,
  "the forecaster must refuse to emit a band below 30 completed tasks of history");
assert.ok(context.COVERAGE_MIN_TEST >= 20,
  "a coverage rate must not be stated from a held-out split smaller than 20 tasks");

// ---------------------------------------------------------------- 2. priors refuse below the gate
function history(count) {
  const out = [];
  for (let index = 1; index <= count; index += 1) {
    out.push({
      cost_usd: 0.2 + (index % 7) * 0.05,
      turn_count: 3 + (index % 5),
      archetype: index % 3 === 0 ? "debug_fix" : "single_file_edit",
      project: index % 2 === 0 ? "/synthetic/a" : "/synthetic/b",
      ts: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
      projShort: index % 2 === 0 ? "a" : "b",
    });
  }
  return out;
}

for (const count of [0, 1, 8, 12, 29]) {
  assert.equal(context.fitQuotePriors(history(count)), null,
    `${count} completed tasks is below the cold-start gate and must produce no priors at all`);
}
assert.notEqual(context.fitQuotePriors(history(30)), null,
  "30 completed tasks is the gate and must produce priors");
assert.notEqual(context.fitQuotePriors(history(45)), null,
  "history above the gate must still produce priors");

// ---------------------------------------------------------------- 3. the refusal is plain English
const refusal = context.forecastRefusalText(12);
assert.match(refusal, /\b30\b/, "the refusal must name the number of completed tasks it needs");
assert.match(refusal, /\b12\b/, "the refusal must name how many completed tasks the reader has");
assert.doesNotMatch(refusal, /conformal|prior|archetype|calibrat|quantile|Buhlmann|credibility|P10|P90/i,
  "the refusal is read by someone who does not know what a conformal quantile is");
assert.doesNotMatch(refusal, /—/, "no em dashes");
assert.ok(refusal.length <= 320, "the refusal must stay short enough to be read");
assert.doesNotMatch(refusal, /accurac|accurate|% of the time|48\.3|74\.1|86\.9/i,
  "the refusal must not quote an accuracy figure for TOP-1");

// ---------------------------------------------------------------- 4. an emitted band shows its history count
const band = { p10: 0.11, p50: 0.24, p90: 0.77 };
const emitted = context.quoteCard("From the task alone", band, { hits: 18, medErr: 41.2 }, 22, 34);
assert.match(emitted, /34/, "an emitted band must show the history count it was fitted on");
assert.match(emitted, /completed tasks/i,
  "the history count beside a band must be labelled in words, not left as a bare number");

// ---------------------------------------------------------------- 5. coverage is never stated from a thin split
assert.equal(context.coverageRateReportable(2), false);
assert.equal(context.coverageRateReportable(19), false);
assert.equal(context.coverageRateReportable(20), true);

const thin = context.coverageText(2, 2);
assert.match(thin, /2 of 2/, "a thin split must still show its raw count");
assert.doesNotMatch(thin, /100(\.0)?%/,
  "two hits out of two must never be rendered as a 100% coverage rate");
assert.match(thin, /too few/i, "a thin split must say why no rate is shown");

const thinValue = context.coverageValue(2, 2);
assert.doesNotMatch(thinValue, /%/,
  "the coverage card value must not carry a percent sign when no rate can be stated");

assert.equal(context.coverageClass(2, 2), "",
  "a coverage figure that cannot be stated must not be colour-graded as good or bad");

// a rate that IS shown carries its own uncertainty
const reported = context.coverageText(16, 20);
assert.match(reported, /16 of 20/);
assert.match(reported, /80\.0%/);
assert.match(reported, /95% interval/i,
  "a displayed coverage rate must carry the width of its own uncertainty");

const interval = context.wilson95(16, 20);
assert.ok(interval.low < 80 && interval.high > 80, "the interval must bracket the point estimate");
assert.ok(interval.low > 55 && interval.low < 60, `unexpected Wilson lower bound ${interval.low}`);
assert.ok(interval.high > 91 && interval.high < 94, `unexpected Wilson upper bound ${interval.high}`);
assert.equal(context.wilson95(0, 0), null, "an empty split has no interval");

// the page must not contain a bare 100% coverage claim anywhere
assert.doesNotMatch(html, /observed coverage was "\+fmtPct\(cov\)/,
  "the held-out sentence must be derived from hits and split size, not from a bare percentage");

// ---------------------------------------------------------------- 6. the held-out sentence agrees
const heldOutSource = html.match(/function heldOutStatus\(hits,n,err\)\{[\s\S]*?\n\}/);
assert.ok(heldOutSource, "the held-out status formatter must remain independently testable");
const heldOutContext = {
  Math,
  Number,
  fmtPct: context.fmtPct,
  coverageText: context.coverageText,
  coverageRateReportable: context.coverageRateReportable,
  wilson95: context.wilson95,
};
vm.runInNewContext(heldOutSource[0], heldOutContext, { filename: "forecast-held-out-status.js" });
const thinSentence = heldOutContext.heldOutStatus(2, 2, 39.4);
assert.doesNotMatch(thinSentence, /100(\.0)?%/, "the held-out sentence must not report 100% from two tasks");
assert.match(thinSentence, /does not validate the model for a future task or another user/i);
const thickSentence = heldOutContext.heldOutStatus(16, 20, 39.4);
assert.match(thickSentence, /80\.0%/);
assert.match(thickSentence, /95% interval/i);
assert.match(thickSentence, /does not validate the model for a future task or another user/i);

// ---------------------------------------------------------------- 7. no em dashes were introduced
// Scoped to the cold-start work. Seven em dashes predate it elsewhere in the page (five in comments
// and two used as empty-cell placeholders in the model table); restructuring those belongs to
// whoever owns the page layout, not to this fix.
assert.doesNotMatch(slice("// ---------- cold-start gate", "function renderBacktest("), /—/,
  "no em dashes in the cold-start gate block");
assert.doesNotMatch(slice("function fitQuotePriors(", "function renderQuote("), /—/,
  "no em dashes in the quote-gate block");
assert.equal((html.match(/—/g) || []).length, 7,
  "this fix must not add an em dash anywhere in the page");

process.stdout.write("forecast cold-start refusal: gate, refusal copy, history count and honest coverage all hold\n");
