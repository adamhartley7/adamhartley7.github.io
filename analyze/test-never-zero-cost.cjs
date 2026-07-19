// The never-zero rule.
//
// An unknown, missing or unparseable cost must always reach the reader as "unpriced", with the
// token counts still visible, and must never be printed as $0.00. Rendering a cost TOP could not
// work out as zero is a false money claim, and TOP's credibility rests on never making one.
//
// A charge that really is zero stays expressible: a subscription-covered, included or
// not-charged row is a different statement about the world and must read differently from a row
// TOP could not price. These tests pin both halves of that rule across all seven sources.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

function slice(startMarker, endMarker, label) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `could not locate ${label}`);
  return html.slice(start, end);
}

const fmtSlice = slice("function fmt$(x)", "function esc(value)", "the number formatters");
const pricingSlice = slice("var PRICING_CHECKED=", "function fmt$(x)", "the pricing table");
const resolverSlice = slice("function resolveCostRow", "function renderPilotPatterns", "the cost resolver");
const plainSlice = slice(
  "var RESEARCH_EXCLUSION_WORDS=",
  "function pilotShareScenario()",
  "the plain-English share describer",
);
const parserSlice = slice("function splitCSV", "function estTokens", "the CSV parsers");
const researchSlice = slice(
  "var RESEARCH_SCHEMA_VERSION=",
  'document.getElementById("downloadResearchJSON")',
  "the research-safe builder",
);

function makeContext(...parts) {
  const context = { Math, Number, String, Array, Object, JSON, Date, RegExp, isNaN };
  vm.createContext(context);
  parts.forEach((part) => vm.runInContext(part, context));
  return context;
}

const fmt = makeContext(fmtSlice);
const report = makeContext(pricingSlice, fmtSlice, resolverSlice, plainSlice);
const parsers = makeContext(parserSlice);
const research = makeContext(pricingSlice, fmtSlice, researchSlice);

// ---------------------------------------------------------------------------
// 1. The shared chokepoint every dollar cell passes through.
// ---------------------------------------------------------------------------

assert.equal(fmt.costCell(null, true, ""), "Unpriced",
  "a null cost is unknown, not free, and must never render as a dollar figure");
assert.equal(fmt.costCell(undefined, true, ""), "Unpriced",
  "a missing cost is unknown, not free");
assert.equal(fmt.costCell(NaN, true, ""), "Unpriced",
  "an unparseable cost is unknown, not free");
assert.equal(fmt.costCell(0, false, ""), "Unpriced",
  "a partial row that priced nothing has no figure to show, so it must not claim zero");

// fmt$ is the last line of defence: no caller may drive it into printing a broken number.
assert.equal(fmt.fmt$(null), "Unpriced", "fmt$ must not format a null as a dollar amount");
assert.equal(fmt.fmt$(undefined), "Unpriced", "fmt$ must not format an undefined as a dollar amount");
assert.equal(fmt.fmt$(NaN), "Unpriced", "fmt$ must never emit $NaN");
assert.equal(fmt.fmt$(Infinity), "Unpriced", "fmt$ must never emit an infinite dollar amount");
assert.doesNotMatch(fmt.fmt$(NaN), /\$/, "an unpriced value must carry no dollar sign at all");

// The genuinely-zero case stays expressible, and reads differently from the unpriced case.
// Resolved in favour of main: a genuine zero is stated in WORDS, never as the string $0.00. The
// founder's rule is "an unknown model shows unpriced with the token count still visible, never zero
// dollars", and a real zero printed as $0.00 sitting beside an unpriced row is indistinguishable
// from one. Both facts stay expressible; neither is ever a dollar figure.
const zeroText = fmt.costCell(0, true, "");
assert.doesNotMatch(zeroText, /\$0\.00/,
  "a charge that really is zero must be said in words, never rendered as the string $0.00");
assert.doesNotMatch(zeroText, /\$/, "a recorded zero carries no dollar sign at all");
assert.notEqual(zeroText, "Unpriced", "a recorded zero is not the same claim as an unpriced row");
assert.notEqual(zeroText, "$0.00",
  "a bare $0.00 is indistinguishable from an unpriced row, so it must say what the zero means");
assert.match(zeroText, /no charge/i, "a recorded zero must say it was a recorded no-charge");

// Ordinary priced values are untouched.
assert.equal(fmt.costCell(1.95, true, ""), "$1.95");
assert.equal(fmt.costCell(12.5, true, "~"), "~$12.50", "the estimate marker still prefixes a figure");
assert.equal(fmt.costCell(0.02, false, ""), "Partial $0.02",
  "a partly priced model still shows what TOP could price, labelled partial");

// ---------------------------------------------------------------------------
// 2. All seven sources: an unpriceable model never resolves to a zero cost.
// ---------------------------------------------------------------------------

const UNKNOWN = "future-model-with-no-checked-rate";
const tokens = { inp: 62000, out: 4000, cw: 0, cr: 0, turns: 3 };
const noRecordedCost = {
  ...tokens,
  cost: 0,
  costRows: 0,
  missingCostRows: 3,
  missing: { inp: 62000, out: 4000, cw: 0, cr: 0 },
  credits: 0,
  requests: 0,
};

const sevenSources = [
  ["Claude Code", { chatExport: false }, tokens],
  ["Codex", { codex: true, chatExport: false }, tokens],
  ["Claude Console CSV", { csv: true, chatExport: false }, noRecordedCost],
  ["Claude Chat", { chatExport: true }, tokens],
  ["ChatGPT", { chatExport: true }, tokens],
  ["Cursor", { csv: true, cursor: true, chatExport: false }, noRecordedCost],
  ["GitHub Copilot", { copilot: true, chatExport: false }, noRecordedCost],
];

sevenSources.forEach(([name, res, entry]) => {
  const resolved = report.resolveCostRow(UNKNOWN, entry, res);
  assert.equal(resolved.cost, null,
    `${name}: an unpriceable model must resolve to no cost at all, never to zero dollars`);
  assert.equal(resolved.complete, false,
    `${name}: an unpriceable model must not be reported as a complete cost`);
  assert.equal(report.costCell(resolved.cost, resolved.complete, ""), "Unpriced",
    `${name}: an unpriceable model must reach the reader as unpriced`);
});

// The token counts stay visible for every one of those rows: unpriced is not the same as hidden.
sevenSources.forEach(([name, , entry]) => {
  assert.ok(entry.inp > 0 && report.fmtN(entry.inp) === "62,000",
    `${name}: the token count must remain readable alongside the unpriced label`);
});

// A recorded amount is still honoured when only some rows for that model are missing.
{
  const resolved = report.resolveCostRow(UNKNOWN, {
    cost: 0.02, costRows: 1, missingCostRows: 1, missing: { inp: 100, out: 10, cw: 0, cr: 0 },
  }, { csv: true, chatExport: false });
  assert.equal(resolved.cost, 0.02, "a real recorded amount must survive a sibling row TOP cannot price");
  assert.equal(resolved.complete, false);
}

// ---------------------------------------------------------------------------
// 3. Cursor: the worst offender. Bucket totals must not invent a recorded zero.
// ---------------------------------------------------------------------------

const CURSOR_HEADER =
  "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";

// Every Composer row here has an empty Cost cell, so Cursor recorded no charge for any of them.
const cursorNoCost = parsers.parseCursor([[
  CURSOR_HEADER,
  "2026-07-10T09:00:00.000Z,On-Demand,composer-1,No,1200,1000,500,300,2000,",
  "2026-07-10T11:00:00.000Z,On-Demand,composer-1,No,600,500,100,200,800,",
].join("\n")]);

assert.equal(cursorNoCost.composer.rows, 2);
assert.equal(cursorNoCost.composerMissingCostRows, 2,
  "rows Cursor never priced must be counted, not silently folded into the bucket as zero");
assert.equal(cursorNoCost.composer.cost, 0,
  "an unpriced row contributes nothing, so the bucket total stays at its starting value");

const noCostText = report.cursorBucketCostText(
  cursorNoCost.composer, cursorNoCost.composerMissingCostRows,
);
assert.doesNotMatch(noCostText, /\$0\.00/,
  "a bucket Cursor never priced must not print $0.00: TOP saw no charge, not a charge of zero");
assert.match(noCostText, /no cost recorded/i,
  "a bucket Cursor never priced must say plainly that no cost was recorded");

const fullBreakdown = report.cursorBreakdownText(cursorNoCost);
assert.doesNotMatch(fullBreakdown, /\$0\.00 recorded/,
  "the Cursor breakdown must never assert that $0.00 was recorded for unpriced rows");
assert.doesNotMatch(fullBreakdown, /and \$0\.00 recorded across/,
  "the old wording claimed a recorded zero for rows that carried no cost at all");

// A row Cursor genuinely did not charge for still reads as a real zero, not as unpriced.
const cursorNotCharged = parsers.parseCursor([[
  CURSOR_HEADER,
  '2026-07-11T09:30:00.000Z,"Errored, Not Charged",composer-1,No,100,100,0,0,100,-',
].join("\n")]);
assert.equal(cursorNotCharged.composerMissingCostRows, 0,
  "a not-charged row is priced at zero by Cursor, so it is not a missing cost");
const notChargedText = report.cursorBucketCostText(cursorNotCharged.composer, 0);
// Resolved in favour of main, as above: the zero is stated, not printed as a dollar figure.
assert.doesNotMatch(notChargedText, /\$0\.00/,
  "a genuine no-charge row must state its zero in words, never as the string $0.00");
assert.match(notChargedText, /no charge/i, "a genuine no-charge row must say why it is zero");
assert.notEqual(notChargedText, noCostText,
  "an unpriced bucket and a genuinely-free bucket must never read the same way");

// A negative cost cell is a refund TOP cannot represent, and must not be clamped to zero.
const cursorNegative = parsers.parseCursor([[
  CURSOR_HEADER,
  "2026-07-12T09:00:00.000Z,On-Demand,composer-1,No,100,100,0,10,110,-4.50",
].join("\n")]);
assert.equal(cursorNegative.missingCostRows, 1,
  "a negative Cursor cost must be left unpriced rather than clamped to a recorded zero");
assert.equal(cursorNegative.costRows, 0);
assert.equal(cursorNegative.by["composer-1"].cost, 0,
  "the unpriced negative row contributes nothing to the model total");
assert.equal(cursorNegative.costComplete, false);

// ---------------------------------------------------------------------------
// 4. GitHub Copilot: a refunded row must not be reported as billed at zero.
// ---------------------------------------------------------------------------

const BILLING_HEADER =
  "date,product,sku,quantity,unit_type,applied_cost_per_quantity,gross_amount,discount_amount,net_amount,organization,cost_center_name,model,username";

const copilotRefund = parsers.parseCopilot([[
  BILLING_HEADER,
  "2026-06-02,copilot,copilot_ai_credit,10,ai-credits,0.01,0.1,0,0.1,org,cc,Claude Haiku 4.5,user",
  "2026-06-03,copilot,copilot_ai_credit,5,ai-credits,0.01,-0.4,0,-0.4,org,cc,Claude Haiku 4.5,user",
].join("\n")]);

assert.equal(copilotRefund.negativeCostRows, 1,
  "a negative billed amount must be counted, not clamped to zero and called recorded");
assert.equal(copilotRefund.missingCostRows, 1,
  "a refunded row has no representable cost, so it counts as missing");
assert.equal(copilotRefund.costRows, 1, "only the one genuinely billed row counts as recorded");
assert.ok(Math.abs(copilotRefund.by["Claude Haiku 4.5"].cost - 0.1) < 1e-9,
  "the refund must not be added to the billed total as a zero");
assert.equal(copilotRefund.costComplete, false,
  "a report containing a row TOP could not price is not a complete cost");

const copilotText = report.copilotBreakdownText(copilotRefund);
assert.match(copilotText, /negative billed amount/i,
  "the reader must be told a row carried a negative amount rather than seeing it vanish into zero");
assert.match(copilotText, /left unpriced rather than counted as zero/i,
  "the disclosure must name the never-zero decision it made");

// ---------------------------------------------------------------------------
// 5. The research-safe export must not ship a hard zero for an unknown amount.
// ---------------------------------------------------------------------------

{
  // A non-finite billed amount is unknown. It must not export as 0 carrying a "recorded" status.
  const row = research.researchCostRow("Claude Haiku 4.5", {
    cost: NaN, costRows: 2, missingCostRows: 0, credits: 10, requests: 0,
  }, { copilot: true });
  assert.equal(row.cost, null, "an unparseable billed amount must export as null, never as 0");
  assert.equal(row.status, "unavailable",
    "an unparseable billed amount must not be exported with a recorded status");
  assert.equal(row.complete, false);
}

{
  const row = research.researchCostRow("Claude Haiku 4.5", {
    cost: 0.4, costRows: 2, missingCostRows: 0, credits: 40, requests: 0,
  }, { copilot: true });
  assert.equal(row.cost, 0.4, "a real billed amount still exports unchanged");
  assert.equal(row.status, "recorded");
}

{
  // A genuinely-zero billed amount is a recorded fact and stays exportable as zero.
  const row = research.researchCostRow("Claude Haiku 4.5", {
    cost: 0, costRows: 1, missingCostRows: 0, credits: 5, requests: 0,
  }, { copilot: true });
  assert.equal(row.cost, 0, "a recorded zero must remain expressible in the export");
  assert.equal(row.status, "recorded");
  assert.equal(row.complete, true);
}

{
  // A CSV model with a non-finite recorded amount and no priceable fallback is unavailable.
  const row = research.researchCostRow(UNKNOWN, {
    cost: NaN, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 },
  }, { csv: true });
  assert.equal(row.cost, null, "an unparseable CSV amount must export as null, never as 0");
  assert.equal(row.status, "unavailable");
  assert.equal(row.complete, false,
    "a row with no usable figure must not be marked complete");
}

// ---------------------------------------------------------------------------
// 6. The share preview describes a zero the same honest way the report does.
// ---------------------------------------------------------------------------

function describe(costUsd) {
  return report.describeResearchSafePlain({
    totals: { total_tokens: 62000 },
    activity: {},
    cost: { usd: costUsd, basis: "recorded" },
    pricing: { applied_rates: [] },
    by_model: [{ model: "Claude Haiku 4.5" }],
    privacy: { excluded: ["prompts"] },
  });
}

const zeroShare = describe(0);
assert.ok(zeroShare.contains.some((line) => /no charge/i.test(line)),
  "a shared zero must be described as a recorded no-charge, not as a priced comparison");
assert.ok(!zeroShare.contains.some((line) => /\$0\.00, as a comparison against published API rates/.test(line)),
  "a zero must not be presented as though TOP had priced it against API rates");
// Resolved in favour of main: the rail says the zero rather than printing it as a dollar figure.
assert.match(zeroShare.oneLine, /no charge recorded/,
  "the one-line share summary must say what the zero means");
assert.doesNotMatch(zeroShare.oneLine, /\$0\.00/,
  "the rail must never lead with a zero dollar figure");

const nullShare = describe(null);
assert.ok(nullShare.contains.some((line) => /could not price this file/.test(line)),
  "an unpriced report must still say plainly that TOP could not price it");
assert.doesNotMatch(nullShare.oneLine, /\$/,
  "an unpriced report must not carry a dollar figure into the share summary");

const pricedShare = describe(12.5);
assert.ok(pricedShare.contains.some((line) => /\$12\.50/.test(line)),
  "a real priced figure is still described as a figure");

console.log("never-zero cost rule: all assertions passed");
