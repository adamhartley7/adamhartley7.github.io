"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1]);

scripts.forEach((source, index) => {
  assert.doesNotThrow(() => new vm.Script(source, { filename: `forecast-claim-${index}.js` }));
});

assert.match(html, /Content-Security-Policy[^>]+connect-src 'none'/i);
assert.match(html, /Test an experimental Claude Code API-equivalent cost band/i);
assert.match(html, /held-out results from the selected history, not a general validation/i);
assert.match(html, /next-task estimate is not validated/i);
assert.match(html, /not a price, guarantee or spending limit/i);
assert.match(html, /Do not rely on it for a purchase or budget decision/i);
assert.match(html, /held-out score is context for this estimate, not evidence that the next estimate will be accurate/i);
assert.match(html, /does not validate the model for a future task or another user/i);
assert.match(html, /research case most similar to a future pre-run use/i);
assert.match(html, /estimated API list-price equivalent/i);
assert.match(html, /does not reproduce subscription charges, discounts, provider invoices, or historical rates/i);
assert.match(html, /future-unavailable diagnostic/i);
assert.match(html, /aria-pressed="true"/i);
assert.match(html, /id="qnote"[^>]+role="status"[^>]+aria-live="polite"/i);
assert.match(html, /id="qdesc"/i);
assert.match(html, /<label for="qdesc">Task description<\/label>/i);
assert.match(html, /id="pickfiles"/i);
assert.match(html, /id="copyagent"/i);
assert.match(html, /Inside<\/span>|Missed<\/span>/i);

// Public forecast copy never turns the held-out research diagnostics into an accuracy figure.
// The calculations remain available to the local research harness, but the live page withholds
// both thin and thick split rates while TOP-1 remains research.
const coverageSource = html.match(/function coverageRateReportable\(n\)\{[\s\S]*?\nfunction coverageValue/);
assert.ok(coverageSource, "coverage helpers must remain independently testable");
const heldOutSource = html.match(/function heldOutStatus\(hits,n,err\)\{[\s\S]*?\n\}/);
assert.ok(heldOutSource, "held-out status formatter must remain independently testable");
const heldOutContext = { Math, Number, fmtPct: (value) => `${value}%`, COVERAGE_MIN_TEST: 20 };
vm.runInNewContext(coverageSource[0].replace(/\nfunction coverageValue$/, ""), heldOutContext,
  { filename: "forecast-coverage-helpers.js" });
vm.runInNewContext(heldOutSource[0], heldOutContext, { filename: "forecast-held-out-status.js" });
for (const [hits, split, error] of [[40, 40, 5], [32, 40, 15], [26, 40, 30], [0, 40, 39.4], [2, 2, 5], [1, 2, 39.4]]) {
  const message = heldOutContext.heldOutStatus(hits, split, error);
  assert.match(message, new RegExp(`${split} selected-history tasks`, "i"));
  assert.match(message, /public performance figures are withheld/i);
  assert.match(message, /does not validate the model for a future task or another user/i);
  assert.doesNotMatch(message, /%|inside the band|median relative error|near|promising|well-calibrated|roughly calibrated|should catch|should contain/i);
}

for (const overclaim of [
  /Forecast your Claude Code spend/i,
  /Quote your next task/i,
  />Quote it</i,
  /well-calibrated/i,
  /roughly calibrated/i,
  /This is the real deployment case/i,
  /trust the band about that much/i,
  /These are your true numbers, not a demo/i,
  /should contain the real cost/i,
  /they should catch 80%/i,
  /upper bound on accuracy/i,
  /upper-bound regime/i,
  /what you have already spent/i,
  /Your spend so far/i,
  /Total spend/i,
  /understate your real spend/i,
]) {
  assert.doesNotMatch(html, overclaim);
}

console.log("TOP forecast experimental-claim boundary tests passed");
