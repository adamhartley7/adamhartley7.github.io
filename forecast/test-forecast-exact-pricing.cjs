"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1]).join("\n");
const start = script.indexOf("var PRICES =");
const end = script.indexOf("function fmt$", start);
assert.ok(start >= 0 && end > start, "pricing helpers must remain independently testable");

const context = {};
vm.runInNewContext(script.slice(start, end), context, { filename: "forecast-exact-pricing.js" });

const recognized = new Map([
  ["claude-opus-4-8", "opusNew"],
  ["claude-4-5-opus-20260717", "opusNew"],
  ["claude-opus-4-1", "opusOld"],
  ["claude-3-opus", "opusOld"],
  ["claude-sonnet-5", "sonnet5"],
  ["vendor/claude-5-sonnet-20260717", "sonnet5"],
  ["claude-sonnet-4-6", "sonnet4"],
  ["claude-3.5-sonnet", "sonnet4"],
  ["claude-haiku-4-5", "haiku45"],
  ["claude-3-5-haiku-20260717", "haiku35"],
  ["claude-fable-5", "fable5"],
]);
for (const [model, key] of recognized) assert.equal(context.priceKeyFor(model), key, model);

for (const model of [
  "claude-opus-4-9",
  "claude-sonnet-latest",
  "claude-haiku-4",
  "claude-opus-4-1-synthetic",
  "contains-sonnet-but-is-not-a-model",
  "",
]) {
  assert.equal(context.priceKeyFor(model), null, `${model || "empty"} must fail closed`);
  assert.equal(context.priceFor(model), null, `${model || "empty"} must have no price`);
}

assert.deepEqual(
  JSON.parse(JSON.stringify(context.PRICES)),
  {
    opusNew: { label: "Claude Opus 4.5 to 4.8", in: 5, out: 25 },
    opusOld: { label: "Claude Opus 3, 4, or 4.1", in: 15, out: 75 },
    sonnet5: { label: "Claude Sonnet 5 promo through 31 Aug 2026", in: 2, out: 10 },
    sonnet4: { label: "Claude Sonnet 3.5 to 4.6", in: 3, out: 15 },
    haiku45: { label: "Claude Haiku 4.5", in: 1, out: 5 },
    haiku35: { label: "Claude Haiku 3.5", in: 0.8, out: 4 },
    fable5: { label: "Claude Fable 5", in: 10, out: 50 },
  },
);

assert.equal(context.costOf("claude-sonnet-5", 1e6, 1e6, 1e6, 1e6), 14.7);
assert.equal(context.costOf("claude-opus-4-1", 1e6, 1e6, 1e6, 1e6), 110.25);
assert.equal(context.costOf("claude-unknown-9", 1e6, 1e6, 1e6, 1e6), null);
assert.equal(context.validatedPrice("3"), 3);
assert.equal(context.validatedPrice("0"), 0);
for (const invalid of ["", " ", "-1", "3junk", "Infinity", Infinity, NaN]) {
  assert.equal(context.validatedPrice(invalid), null, `${String(invalid)} must not become a price`);
}

assert.match(html, /Rates checked 17 Jul 2026/i);
assert.match(html, /Anthropic's pricing documentation/i);
assert.match(html, /does not infer subscriptions, discounts, batch processing, fast mode, data-residency premiums/i);
assert.match(html, /aria-label='"\+esc\(label\)\+" input API price/i);
assert.match(html, /type='number' min='0' step='any' inputmode='decimal'/i);
assert.match(html, /id="err" role="alert" aria-live="assertive"/i);

console.log("TOP forecast exact pricing and fail-closed model recognition tests passed");
