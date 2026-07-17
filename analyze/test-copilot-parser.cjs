const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const parserStart = html.indexOf("function splitCSV");
const parserEnd = html.indexOf("function estTokens", parserStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart, "could not locate CSV parser block");
const copilotMarker = html.indexOf("function parseCopilot", parserStart);
assert.ok(copilotMarker > parserStart && copilotMarker < parserEnd, "parseCopilot must sit between splitCSV and estTokens");

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(parserStart, parserEnd), context);

const PRIVATE = "PRIVATE_SENTINEL_MUST_NOT_LEAK";
function modelRow(entry) { return { ...entry, missing: { ...entry.missing } }; }
const BILLING_HEADER = "date,product,sku,quantity,unit_type,applied_cost_per_quantity,gross_amount,discount_amount,net_amount,organization,cost_center_name,model,username";
const LEGACY_HEADER = '"Timestamp","User","Model","Requests Used","Exceeds Monthly Quota","Total Monthly Quota"';
const DAILY_HEADER = "date,username,model,quantity,exceeds_quota,total_monthly_quota";
const CONSOLE_CSV = "model,input_tokens,output_tokens,cost_usd\nclaude-opus-4-8,100,10,0.01";
const CURSOR_CSV = "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n2026-07-10T09:00:00.000Z,On-Demand,composer-1,No,100,80,10,20,110,0.10";

// Modern AI usage report: premium requests and AI credits, an unknown SKU, an unknown model,
// and a fractional multiplier-weighted request quantity.
const billing = context.parseCopilot([[
  BILLING_HEADER,
  `2026-06-02,copilot,copilot_premium_request,12,requests,0.04,0.48,0.08,0.40,${PRIVATE}-org,${PRIVATE}-center,"Claude Sonnet 4.5",${PRIVATE}-user`,
  `2026-06-02,copilot,copilot_ai_credit,250.5,ai-credits,0.01,2.505,0,2.505,${PRIVATE}-org,${PRIVATE}-center,Claude Opus 4.6,${PRIVATE}-user`,
  `2026-06-03,copilot,coding_agent_ai_credit,40,ai-credits,0.01,0.4,0,0.4,${PRIVATE}-org,${PRIVATE}-center,GPT-5.2,${PRIVATE}-user`,
  `2026-06-03,copilot,copilot_mystery_thing,5,ai-credits,0.01,0.05,0,0.05,${PRIVATE}-org,${PRIVATE}-center,Claude Opus 4.6,${PRIVATE}-user`,
  `2026-06-03,copilot,copilot_ai_credit,5,ai-credits,0.01,0.05,0,0.05,${PRIVATE}-org,${PRIVATE}-center,totally-unknown-model,${PRIVATE}-user`,
  `2026-06-04,copilot,copilot_premium_request,0.25,requests,0.04,0.01,0,0.01,${PRIVATE}-org,${PRIVATE}-center,"Gemini 2.0 Flash",${PRIVATE}-user`,
].join("\n")]);
assert.equal(billing.kind, "GitHub Copilot usage report");
assert.equal(billing.copilot, true);
assert.equal(billing.csv, true);
assert.equal(billing.topSource, "copilot");
assert.equal(billing.turns, 4, "the unknown-SKU and unknown-model rows must be excluded from counted usage records");
assert.equal(billing.days, 3);
assert.equal(billing.estimate, false, "Copilot dollars are recorded billed amounts, never an estimate");
assert.equal(billing.costComplete, true);
assert.equal(billing.costRows, 4);
assert.equal(billing.missingCostRows, 0);
assert.deepEqual(Object.keys(billing.by).sort(), ["Claude Opus 4.6", "Claude Sonnet 4.5", "GPT-5.2", "Gemini 2.0 Flash"]);
assert.deepEqual(
  modelRow(billing.by["Claude Sonnet 4.5"]),
  { inp: 0, out: 0, cw: 0, cr: 0, turns: 1, cost: 0.4, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 }, credits: 0, requests: 12 },
  "a premium-request row must record requests and the billed net amount, with no invented tokens",
);
assert.deepEqual(
  modelRow(billing.by["Claude Opus 4.6"]),
  { inp: 0, out: 0, cw: 0, cr: 0, turns: 1, cost: 2.505, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 }, credits: 250.5, requests: 0 },
  "an AI-credit row must record credits, not requests",
);
assert.deepEqual(
  modelRow(billing.by["Gemini 2.0 Flash"]),
  { inp: 0, out: 0, cw: 0, cr: 0, turns: 1, cost: 0.01, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 }, credits: 0, requests: 0.25 },
  "model multipliers make quantities fractional and must be kept, not rounded",
);
assert.equal(billing.credits, 290.5);
assert.equal(billing.requests, 12.25);
assert.equal(billing.excludedRows, 2);
assert.deepEqual({ ...billing.excludedSkus }, { copilot_mystery_thing: 1 }, "unknown SKUs must be excluded and named, never guessed");
assert.deepEqual({ ...billing.excludedModels }, { "totally-unknown-model": 1 }, "unknown models must be excluded and named, never priced");
assert.equal(billing.coverage.complete, false, "excluded rows must fail the coverage-complete claim");
assert.doesNotMatch(JSON.stringify(billing), new RegExp(PRIVATE), "organization, cost center and username columns must never reach the parsed result");

// Preview-era generation: aic_quantity and aic_gross_amount must never be summed with the
// billing-of-record quantity and net_amount for the same row.
const preview = context.parseCopilot([[
  BILLING_HEADER + ",exceeds_quota,total_monthly_quota,aic_quantity,aic_gross_amount",
  `2026-05-20,copilot,copilot_premium_request,10,requests,0.04,0.40,0.40,0.00,${PRIVATE}-org,${PRIVATE}-center,GPT-4.5,${PRIVATE}-user,False,300,100,1.00`,
].join("\n")]);
assert.equal(preview.turns, 1);
assert.equal(preview.requests, 10, "the billed quantity is the quantity of record");
assert.equal(preview.credits, 0, "preview aic_quantity must not be added to credits");
assert.equal(preview.by["GPT-4.5"].cost, 0, "the discounted net amount is used, not aic_gross_amount");
assert.equal(preview.costComplete, true, "a present zero net amount is a recorded cost, not a missing one");

// Legacy per-interaction report: no dollar column exists, so cost stays missing and is never guessed.
const legacy = context.parseCopilot(["﻿" + [
  LEGACY_HEADER,
  `"2025-06-11T05:13:27.8766440Z","${PRIVATE}-user","gpt-4.1-2025-04-14","1","False","Unlimited"`,
  `"2025-06-12T08:00:00.0000000Z","${PRIVATE}-user","gpt-4.1-2025-04-14","0.25","False","Unlimited"`,
].join("\n")]);
assert.equal(legacy.turns, 2, "a BOM and fully quoted legacy header must be tolerated");
assert.equal(legacy.days, 2);
assert.equal(legacy.estimate, false);
assert.equal(legacy.costComplete, false);
assert.equal(legacy.missingCostRows, 2);
assert.deepEqual(
  modelRow(legacy.by["gpt-4.1-2025-04-14"]),
  { inp: 0, out: 0, cw: 0, cr: 0, turns: 2, cost: 0, costRows: 0, missingCostRows: 2, missing: { inp: 0, out: 0, cw: 0, cr: 0 }, credits: 0, requests: 1.25 },
  "legacy Requests Used quantities are multiplier-weighted premium requests with no billed dollars",
);
assert.doesNotMatch(JSON.stringify(legacy), new RegExp(PRIVATE), "the legacy User column must never reach the parsed result");

// Legacy daily-aggregate report with display-style model names.
const daily = context.parseCopilot([[
  DAILY_HEADER,
  `2025-10-06,${PRIVATE}-user,GPT-5,4,false,300`,
].join("\n")]);
assert.equal(daily.turns, 1);
assert.equal(daily.requests, 4);
assert.equal(daily.by["GPT-5"].missingCostRows, 1, "the daily aggregate has no dollar column, so cost is missing");
assert.doesNotMatch(JSON.stringify(daily), new RegExp(PRIVATE));

// Saved ai_credit/usage API JSON payload: detected by shape, dated from timePeriod, sku display strings accepted.
const apiPayload = JSON.stringify({
  timePeriod: { year: 2026, month: 7, day: 2 },
  user: `${PRIVATE}-user`,
  product: "copilot",
  model: "all",
  usageItems: [
    { product: "Copilot", sku: "Copilot AI Credits", model: "Auto: Claude Haiku 4.5", unitType: "ai-credits", pricePerUnit: 0.01, grossQuantity: 120, grossAmount: 1.2, discountQuantity: 20, discountAmount: 0.2, netQuantity: 100, netAmount: 1 },
    { product: "Copilot", sku: "Copilot Mystery Credits", model: "Claude Haiku 4.5", unitType: "ai-credits", pricePerUnit: 0.01, grossQuantity: 5, grossAmount: 0.05, discountQuantity: 0, discountAmount: 0, netQuantity: 5, netAmount: 0.05 },
  ],
});
const api = context.parseCopilot([apiPayload]);
assert.equal(api.apiFiles, 1);
assert.equal(api.turns, 1);
assert.equal(api.days, 1);
assert.equal(api.credits, 100, "the billed netQuantity is preferred over grossQuantity");
assert.deepEqual(
  modelRow(api.by["Auto: Claude Haiku 4.5"]),
  { inp: 0, out: 0, cw: 0, cr: 0, turns: 1, cost: 1, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 }, credits: 100, requests: 0 },
  "the API display SKU must normalize to the known copilot_ai_credit SKU",
);
assert.deepEqual({ ...api.excludedSkus }, { "Copilot Mystery Credits": 1 }, "unknown API SKUs must be excluded and named");
assert.doesNotMatch(JSON.stringify(api), new RegExp(PRIVATE), "the API user field must never reach the parsed result");

// Hostile labels are sanitized before being named, and dangerous keys stay safe.
const hostile = context.parseCopilot([[
  BILLING_HEADER,
  "2026-06-05,copilot,copilot_ai_credit,1,ai-credits,0.01,0.01,0,0.01,org,cc,<img src=x onerror=alert(1)>,user",
  "2026-06-05,copilot,copilot_ai_credit,1,ai-credits,0.01,0.01,0,0.01,org,cc,__proto__,user",
  "2026-06-05,copilot,copilot_ai_credit,1,ai-credits,0.01,0.01,0,0.01,org,cc,constructor,user",
  "2026-06-05,copilot,<script>alert(1)</script>,1,ai-credits,0.01,0.01,0,0.01,org,cc,Claude Haiku 4.5,user",
].join("\n")]);
assert.equal(hostile.turns, 0);
assert.equal(hostile.excludedRows, 4);
assert.deepEqual(Object.keys(hostile.by), []);
assert.ok(Object.keys(hostile.excludedModels).every(name => !/[<>\\/]/.test(name)), "excluded model names must not carry HTML or path characters");
assert.ok(Object.keys(hostile.excludedSkus).every(name => !/[<>\\/]/.test(name)), "excluded SKU names must not carry HTML or path characters");
assert.equal(hostile.excludedModels["__proto__"], 1);
assert.equal(hostile.excludedModels["constructor"], 1);

// Model recognition is exact: routed and display names pass, everything else is excluded.
assert.equal(context.copilotRecognizedModel("Claude Sonnet 4.5"), true);
assert.equal(context.copilotRecognizedModel("claude-sonnet-4"), true);
assert.equal(context.copilotRecognizedModel("gpt-4.1-2025-04-14"), true);
assert.equal(context.copilotRecognizedModel("Auto: Claude Haiku 4.5"), true);
assert.equal(context.copilotRecognizedModel("Gemini 2.0 Flash"), true);
assert.equal(context.copilotRecognizedModel("auto"), true);
assert.equal(context.copilotRecognizedModel("totally-unknown"), false);
assert.equal(context.copilotRecognizedModel(""), false);

// Files whose format is not a Copilot export are skipped and counted, not guessed.
const wrongFile = context.parseCopilot([CONSOLE_CSV]);
assert.equal(wrongFile.turns, 0, "a Console CSV must not be ingested by the Copilot reader");
assert.equal(wrongFile.unrecognizedFiles, 1);
const cursorFile = context.parseCopilot([CURSOR_CSV]);
assert.equal(cursorFile.turns, 0, "a Cursor usage CSV must not be ingested by the Copilot reader");
assert.equal(cursorFile.unrecognizedFiles, 1);

// Multiple Copilot files sum per model regardless of file order.
const fileA = BILLING_HEADER + `\n2026-06-02,copilot,copilot_ai_credit,10,ai-credits,0.01,0.1,0,0.1,org,cc,Claude Haiku 4.5,user`;
const fileB = BILLING_HEADER + `\n2026-06-03,copilot,copilot_ai_credit,30,ai-credits,0.01,0.3,0,0.3,org,cc,Claude Haiku 4.5,user`;
const forward = context.parseCopilot([fileA, fileB]);
const backward = context.parseCopilot([fileB, fileA]);
for (const result of [forward, backward]) {
  const { cost, ...counts } = modelRow(result.by["Claude Haiku 4.5"]);
  assert.deepEqual(counts, { inp: 0, out: 0, cw: 0, cr: 0, turns: 2, costRows: 2, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 }, credits: 40, requests: 0 });
  assert.ok(Math.abs(cost - 0.4) < 1e-9, "recorded billed amounts must sum across files in any order");
  assert.equal(result.days, 2);
  assert.equal(result.coverage.files_with_usage, 2);
  assert.equal(result.coverage.complete, true);
}

// Header-based detection separates Copilot exports from Cursor and Console CSVs and fails closed on mixes.
assert.equal(context.detectUsageCsvKind([fileA]), "copilot");
assert.equal(context.detectUsageCsvKind([apiPayload]), "copilot");
assert.equal(context.detectUsageCsvKind([CURSOR_CSV]), "cursor");
assert.equal(context.detectUsageCsvKind([CONSOLE_CSV]), "");
assert.equal(context.detectUsageCsvKind([fileA, CURSOR_CSV]), "mixed");
assert.equal(context.detectUsageCsvKind([fileA, CONSOLE_CSV]), "mixed");

console.log("TOP Analyzer Copilot parser regression tests passed");
