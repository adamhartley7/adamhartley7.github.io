const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
assert.match(html, /"Partial estimate"/);
assert.match(html, /Estimated pay-as-you-go cost/);
assert.doesNotMatch(html, /cost_provenance:/,
  "the person-facing report must not expose internal machine labels");
assert.match(html, /res\.csv\?"record":"AI reply"/,
  "the average-cost label must match the source's counted unit");
const pricingStart = html.indexOf("var PRICING_CHECKED=");
const pricingEnd = html.indexOf("function fmt$", pricingStart);
assert.ok(pricingStart >= 0 && pricingEnd > pricingStart, "could not locate pricing logic");

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(pricingStart, pricingEnd), context);

const cases = [
  ["claude-opus-4-8", "opusNew", 5, 25],
  ["claude-opus-4-1", "opusOld", 15, 75],
  ["claude-3-opus-20240229", "opusOld", 15, 75],
  ["anthropic/claude-3-opus-20240229", "opusOld", 15, 75],
  ["claude-sonnet-5", "sonnet5", 2, 10],
  ["anthropic/claude-5-sonnet-20260717", "sonnet5", 2, 10],
  ["claude-sonnet-4-6", "sonnet4", 3, 15],
  ["claude-3-5-sonnet-20241022", "sonnet4", 3, 15],
  ["claude-haiku-4-5", "haiku45", 1, 5],
  ["claude-3-5-haiku", "haiku35", 0.8, 4],
  ["claude-fable-5", "fable5", 10, 50],
  ["gpt-5.6-sol", "gpt56sol", 5, 30],
  ["openai/gpt-5.6-sol", "gpt56sol", 5, 30],
  ["gpt-5.6-terra", "gpt56terra", 2.5, 15],
  ["openai/gpt-5.6-terra", "gpt56terra", 2.5, 15],
  ["gpt-5.6-luna", "gpt56luna", 1, 6],
];

for (const [model, key, input, output] of cases) {
  assert.equal(context.priceKeyFor(model), key, `${model} must map to the exact checked rate family`);
  assert.equal(context.priceFor(model).in, input);
  assert.equal(context.priceFor(model).out, output);
}
assert.equal(context.priceFor("future-model-with-no-checked-rate"), null,
  "unknown models must fail closed instead of receiving a default dollar rate");
for (const model of [
  "gpt-5.6-pro",
  "gpt-5.6-codex",
  "gpt-5.6-future",
  "claude-fable-50",
  "claude-haiku-4-50",
  "claude-opus-4-80",
  "claude-opus-4-9",
  "claude-sonnet-4-9",
  "vendor/claude-5-sonnet-20260717",
  "synthetic-claude-sonnet-5",
  "not-a-model/claude-opus-4-8",
  "anthropic/other/claude-sonnet-5",
  "anthropic/gpt-5.6-sol",
  "vendor/gpt-5.6-sol",
  "synthetic-gpt-5.6-terra",
  "gemini-gpt-5.6-sol",
  "not-a-model/gpt-5.6-luna",
  "openai/claude-sonnet-5",
  "claude-sonnet-5/gpt-5.6-sol",
]) {
  assert.equal(context.priceFor(model), null, `${model} must not inherit a nearby model's price`);
}
assert.equal(context.CACHE_WRITE_MULTIPLIER, 1.25,
  "the comparison estimate must identify the five-minute Anthropic cache-write multiplier");
assert.equal(context.CACHE_READ_MULTIPLIER, 0.1,
  "the comparison estimate must identify the checked cache-read discount");
assert.equal(context.cacheWriteRate(context.PRICES.fable5), 12.5);
assert.equal(context.cacheReadRate(context.PRICES.fable5), 1);
assert.match(context.PRICES.fable5.source, /^https:\/\/platform\.claude\.com\//);
assert.match(context.PRICES.gpt56sol.source, /^https:\/\/openai\.com\//);
assert.equal(context.PRICING_CHECKED, "16 Jul 2026");

const csvStart = html.indexOf("function splitCSV");
const csvEnd = html.indexOf("function estTokens", csvStart);
assert.ok(csvStart >= 0 && csvEnd > csvStart, "could not locate CSV parser");
vm.runInContext(html.slice(csvStart, csvEnd), context);

const resolverStart = html.indexOf("function resolveCostRow");
const resolverEnd = html.indexOf("function render", resolverStart);
assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, "could not locate cost resolver");
vm.runInContext(html.slice(resolverStart, resolverEnd), context);

const tierStart = html.indexOf("function tierOf");
const tierEnd = html.indexOf("// value-model state", tierStart);
assert.ok(tierStart >= 0 && tierEnd > tierStart, "could not locate model tiering");
vm.runInContext(html.slice(tierStart, tierEnd), context);
assert.equal(context.tierOf("gpt-5.6-sol"), "frontier");
assert.equal(context.tierOf("gpt-5.6-terra"), "mid");
assert.equal(context.tierOf("gpt-5.6-luna"), "cheap");

{
  const resolved = context.resolveCostRow("future-model-with-no-checked-rate", {
    cost: 0.02,
    costRows: 1,
    missingCostRows: 1,
    missing: { inp: 100, out: 10, cw: 0, cr: 0 },
  }, { csv: true, chatExport: false });
  assert.equal(resolved.cost, 0.02,
    "a known recorded amount must survive when another row for that model cannot be priced");
  assert.equal(resolved.complete, false);
}

assert.equal(context.valueModelAllowed([
  { model: "future-model-with-no-checked-rate", cost: 0.02, complete: true },
], true), false, "recorded cost alone must not enable a model-switching scenario for an unrecognized model");

{
  const result = context.parseCSV([
    "model,input_tokens,output_tokens,cost_usd\nclaude-opus-4-8,100,10,0.01\nclaude-opus-4-8,200,20,0.02",
  ]);
  assert.equal(result.estimate, false);
  assert.equal(result.costComplete, true);
  assert.equal(result.costRows, 2);
  assert.equal(result.missingCostRows, 0);
}

{
  const result = context.parseCSV([
    "model,input_tokens,output_tokens,cost_usd\nclaude-opus-4-8,100,10,0.01\nclaude-opus-4-8,200,20,",
  ]);
  assert.equal(result.estimate, true,
    "a CSV must not be called exact when even one row lacks a valid billed cost");
  assert.equal(result.costComplete, false);
  assert.equal(result.costRows, 1);
  assert.equal(result.missingCostRows, 1);
}

{
  const result = context.parseCSV([
    "model,input_tokens,output_tokens\nunknown-model,100,10",
  ]);
  assert.equal(result.estimate, true);
  assert.equal(result.costRows, 0);
  assert.equal(result.missingCostRows, 1);
}

{
  const result = context.parseCSV([
    "# Obsidian project note\nkey, value\nproject, active",
  ]);
  assert.equal(result.turns, 0,
    "a comma-containing Markdown note must not be accepted as a Console CSV");
  assert.deepEqual(Object.keys(result.by), []);
}

{
  const result = context.parseCSV([
    "model,input_tokens,output_tokens,cost_usd\nclaude-opus-4-8,0,0,",
  ]);
  assert.equal(result.turns, 0,
    "a CSV row with no usage or recorded cost must not create a fake record");
}

console.log("TOP Analyzer pricing and Console CSV regression tests passed");
