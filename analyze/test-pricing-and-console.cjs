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

const context = {
  safeUsageAdd(left, right) {
    const next = left + right;
    if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0 || !Number.isSafeInteger(next)) {
      throw new Error("Usage counters exceed the safe local reporting limit");
    }
    return next;
  },
};
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
assert.equal(context.costOf("gpt-5.6-sol", 0, 1e6, 0, 0), 30,
  "one million Sol output tokens must cost $30, not $30,000");
assert.equal(context.costOf("gpt-5.6-sol", 0, 1000, 0, 0), 0.03,
  "the per-million rate must be scaled down for ordinary token counts");

const exactCodexApi = context.codexApiEquivalent([
  { model: "gpt-5.6-sol", e: { inp: 80, out: 30, cw: 0, cr: 20 } },
], true);
assert.ok(Math.abs(exactCodexApi.amount - 0.00131) < 1e-12);
assert.equal(exactCodexApi.partial, false);
assert.equal(exactCodexApi.pricedTokens, 130);
assert.equal(exactCodexApi.unpricedTokens, 0);

const originalSolInput = context.PRICES.gpt56sol.in;
const originalSolOutput = context.PRICES.gpt56sol.out;
context.PRICES.gpt56sol.in = 500;
context.PRICES.gpt56sol.out = 3000;
const stableCodexApi = context.codexApiEquivalent([
  { model: "gpt-5.6-sol", e: { inp: 80, out: 30, cw: 0, cr: 20 } },
], true);
assert.ok(Math.abs(stableCodexApi.amount - 0.00131) < 1e-12,
  "Codex must use immutable checked base rates, not values edited for a prior report in the same tab");
context.PRICES.gpt56sol.in = originalSolInput;
context.PRICES.gpt56sol.out = originalSolOutput;

const unsupportedCodexCacheWrite = context.codexApiEquivalent([
  { model: "gpt-5.6-sol", e: { inp: 80, out: 30, cw: 1, cr: 20 } },
], true);
assert.equal(unsupportedCodexCacheWrite.pricedTokens, 130);
assert.equal(unsupportedCodexCacheWrite.unpricedTokens, 1,
  "a Codex-only cache-write category must stay unpriced instead of inheriting Anthropic's multiplier");
assert.equal(unsupportedCodexCacheWrite.partial, true);

const partialCodexApi = context.codexApiEquivalent([
  { model: "gpt-5.6-sol", e: { inp: 80, out: 30, cw: 0, cr: 20 } },
  { model: "Unknown Codex model", e: { inp: 100, out: 10, cw: 0, cr: 0 } },
  { model: "codex-auto-review", e: { inp: 20, out: 5, cw: 0, cr: 0 } },
], true);
assert.ok(Math.abs(partialCodexApi.amount - 0.00131) < 1e-12);
assert.equal(partialCodexApi.partial, true);
assert.equal(partialCodexApi.pricedTokens, 130);
assert.equal(partialCodexApi.unpricedTokens, 135);
assert.deepEqual([...partialCodexApi.rateKeys], ["gpt56sol"]);

const unknownCodexApi = context.codexApiEquivalent([
  { model: "Unknown Codex model", e: { inp: 100, out: 10, cw: 0, cr: 0 } },
], true);
assert.equal(unknownCodexApi.amount, null, "an all-unknown Codex report must remain unpriced, never zero");
assert.equal(unknownCodexApi.partial, false);
assert.equal(context.codexApiEquivalent([
  { model: "gpt-5.6-sol", e: { inp: 80, out: 30, cw: 0, cr: 20 } },
], false).partial, true, "incomplete parser coverage must make the API equivalent partial");
assert.equal(context.coverageShareText(1, 1001), "<1%",
  "a small nonzero unpriced share must never render as zero percent");
assert.equal(context.coverageShareText(1000, 1001), ">99%",
  "a partial priced share must never round up to complete coverage");

// The API-equivalent range is what a subscription user gets instead of an invented model attribution.
// It must span the whole checked table, name both ends, and never collapse to a single guessed model.
const range = context.apiEquivalentRange(1e6, 0, 0, 0);
assert.equal(range.count, Object.keys(context.PRICES).length,
  "the range must price against every checked rate family, not a hand-picked subset");
assert.equal(range.low.key, "haiku35");
assert.equal(range.high.key, "opusOld");
assert.ok(range.low.cost < range.high.cost, "the low end must be cheaper than the high end");
assert.equal(range.low.label, context.PRICES.haiku35.label, "both ends must be named so the assumption is visible");
assert.equal(range.high.label, context.PRICES.opusOld.label);
// One million input tokens: 0.8 at the cheapest checked input rate, 15 at the dearest.
assert.ok(Math.abs(range.low.cost - 0.8) < 1e-9);
assert.ok(Math.abs(range.high.cost - 15) < 1e-9);
// Cache reads are billed at a tenth of input, so a cache-heavy range must reflect that, not the input rate.
const cacheRange = context.apiEquivalentRange(0, 0, 0, 1e6);
assert.ok(Math.abs(cacheRange.low.cost - 0.08) < 1e-9, "cache reads must use the checked cache-read discount");
assert.ok(Math.abs(cacheRange.high.cost - 1.5) < 1e-9);
// The range tracks edited rates, so a corrected price moves the reported figure.
const originalHaiku35In = context.PRICES.haiku35.in;
context.PRICES.haiku35.in = 0.4;
assert.ok(Math.abs(context.apiEquivalentRange(1e6, 0, 0, 0).low.cost - 0.4) < 1e-9,
  "the range must be derived from PRICES at call time so a rate edit re-renders it");
context.PRICES.haiku35.in = originalHaiku35In;

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

{
  const resolved = context.resolveCostRow("gpt-5.6-sol", {
    inp: 1_432_000_000,
    cr: 38_056_000_000,
    cw: 0,
    out: 129_550_000,
  }, { codex: true, chatExport: false });
  assert.equal(resolved.cost, null, "Codex token counters must never be presented as an actual dollar charge");
  assert.equal(resolved.key, null, "Codex reports must not attach an API rate card to actual-cost output");
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

{
  // A negative billed amount is a refund or credit adjustment, not a discount on this row's usage.
  // Netting it against a sibling row would understate what was actually charged, so the row stays
  // unpriced and counted, exactly as parseCursor and parseCopilot already do.
  const result = context.parseCSV([
    "model,input_tokens,output_tokens,cost_usd\nclaude-opus-4-8,100,10,20.00\nclaude-opus-4-8,200,20,-15.00",
  ]);
  assert.equal(result.costRows, 1,
    "a negative billed amount must not be counted as a recorded cost");
  assert.equal(result.missingCostRows, 1,
    "a negative billed amount must be routed to the unpriced count");
  assert.equal(result.by["claude-opus-4-8"].cost, 20,
    "a refund row must not be netted against a genuinely billed row");
  assert.equal(result.costComplete, false);
  assert.equal(result.estimate, true,
    "a CSV containing a negative billed amount must not be called exact");
}

{
  const result = context.parseCSV([
    "model,input_tokens,output_tokens,cost_usd\nclaude-opus-4-8,100,10,-15.00",
  ]);
  assert.equal(result.costRows, 0);
  assert.equal(result.missingCostRows, 1);
  assert.equal(result.by["claude-opus-4-8"].cost, 0,
    "a lone negative billed amount must never reach the report as a negative dollar figure");
  assert.equal(result.turns, 1,
    "the row still has real token usage, so it must still be counted as usage");
}

console.log("TOP Analyzer pricing and Console CSV regression tests passed");
