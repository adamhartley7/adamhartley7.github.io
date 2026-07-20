const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const parserStart = html.indexOf("function splitCSV");
const parserEnd = html.indexOf("function estTokens", parserStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart, "could not locate CSV parser block");
const cursorMarker = html.indexOf("function parseCursor", parserStart);
assert.ok(cursorMarker > parserStart && cursorMarker < parserEnd, "parseCursor must sit between splitCSV and estTokens");

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(parserStart, parserEnd), context);

const PRIVATE = "PRIVATE_SENTINEL_MUST_NOT_LEAK";
function modelRow(entry) { return { ...entry, missing: { ...entry.missing } }; }
const HEADER = "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";
const TEAM_HEADER = "Date,User,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";

const standard = context.parseCursor([[
  HEADER,
  "2026-07-10T09:00:00.375Z,Included,composer-1,No,1200,1000,500,300,2000,0.05",
  "2026-07-10T10:00:00.000Z,On-Demand,claude-4.5-sonnet,No,2000,1500,0,400,2400,1.95",
  '2026-07-11T09:30:00.000Z,"Errored, Not Charged",gpt-5,No,100,100,0,0,100,-',
].join("\n")]);
assert.equal(standard.kind, "Cursor usage CSV");
assert.equal(standard.cursor, true);
assert.equal(standard.csv, true);
assert.equal(standard.topSource, "cursor");
assert.equal(standard.turns, 3, "the standard known-model rows must all be counted");
assert.equal(standard.days, 2);
assert.equal(standard.estimate, false, "a fully recorded Cursor export must not be labeled an estimate");
assert.equal(standard.costComplete, true);
assert.equal(standard.costRows, 3);
assert.equal(standard.missingCostRows, 0);
assert.deepEqual(Object.keys(standard.by).sort(), ["claude-4.5-sonnet", "composer-1", "gpt-5"]);
assert.deepEqual(
  modelRow(standard.by["composer-1"]),
  { inp: 1000, out: 300, cw: 200, cr: 500, turns: 1, cost: 0.05, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 }, coveredRows: 1, chargeKnownRows: 1 },
  "cache write must be the difference between the two input columns",
);
assert.deepEqual(
  modelRow(standard.by["claude-4.5-sonnet"]),
  { inp: 1500, out: 400, cw: 500, cr: 0, turns: 1, cost: 1.95, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 }, coveredRows: 0, chargeKnownRows: 1 },
);
assert.deepEqual(
  modelRow(standard.by["gpt-5"]),
  { inp: 100, out: 0, cw: 0, cr: 0, turns: 1, cost: 0, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 }, coveredRows: 0, chargeKnownRows: 1 },
  "an errored, not-charged row must record a zero cost instead of a missing one",
);
assert.deepEqual({ ...standard.composer }, { rows: 1, tokens: 2000, cost: 0.05 }, "Composer rows must be separated for the agent-versus-other breakdown");
assert.deepEqual({ ...standard.otherModels }, { rows: 2, tokens: 2500, cost: 1.95 });
assert.equal(standard.includedRows, 1);
assert.equal(standard.includedCost, 0.05);
assert.equal(standard.notChargedRows, 1);
assert.equal(standard.excludedRows, 0);
assert.deepEqual({ ...standard.excludedModels }, {});
assert.equal(standard.coverage.complete, true, "a fully parsed standard export must keep complete coverage");

// Team header variant: extra User column, lowercase headers, a BOM, quoted model,
// the alternate not-charged wording, and a literal Free cost.
const team = context.parseCursor(["\uFEFF" + TEAM_HEADER.toLowerCase() + "\n" + [
  `2026-07-12T08:00:00.000Z,${PRIVATE}@example.com,"Aborted, No Charge",composer-2.5,No,10,10,0,0,10,-`,
  `2026-07-12T09:00:00.000Z,${PRIVATE}@example.com,On-Demand,"gemini-2.5-pro",${PRIVATE},500,400,100,50,650,0.42`,
  `2026-07-12T10:00:00.000Z,${PRIVATE}@example.com,On-Demand,composer-2.5-fast,No,20,20,0,5,25,Free`,
].join("\n")]);
assert.equal(team.turns, 3, "the optional User column and lowercase headers must be tolerated");
assert.equal(team.days, 1);
assert.equal(team.costComplete, true);
assert.deepEqual(
  modelRow(team.by["composer-2.5"]),
  { inp: 10, out: 0, cw: 0, cr: 0, turns: 1, cost: 0, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 }, coveredRows: 0, chargeKnownRows: 1 },
);
assert.equal(team.by["gemini-2.5-pro"].cost, 0.42, "a quoted model field must be read through RFC 4180 parsing");
assert.equal(team.composer.rows, 2, "composer-2.5 and composer-2.5-fast are both Composer variants");
assert.equal(team.otherModels.rows, 1);
assert.doesNotMatch(JSON.stringify(team), new RegExp(PRIVATE), "the User column must never reach the parsed result");

// A row without a recorded cost keeps its tokens on the fail-closed missing path.
const missingCost = context.parseCursor([[
  HEADER,
  "2026-07-13T09:00:00.000Z,On-Demand,claude-4.5-sonnet,No,100,80,20,30,150,",
  "2026-07-13T10:00:00.000Z,On-Demand,composer-1,No,10,10,0,5,15,0.01",
].join("\n")]);
assert.equal(missingCost.estimate, true, "a Cursor export must not be called fully recorded when a row lacks a cost");
assert.equal(missingCost.costComplete, false);
assert.equal(missingCost.costRows, 1);
assert.equal(missingCost.missingCostRows, 1);
assert.deepEqual({ ...missingCost.by["claude-4.5-sonnet"].missing }, { inp: 80, out: 30, cw: 20, cr: 20 });

// Composer detection is exact: auto and cursor-small are recognized Cursor models but not Composer.
assert.equal(context.isComposerModel("composer-1"), true);
assert.equal(context.isComposerModel("composer-2.5-fast"), true);
assert.equal(context.isComposerModel("auto"), false);
assert.equal(context.cursorRecognizedModel("auto"), true);
assert.equal(context.cursorRecognizedModel("cursor-small"), true);
assert.equal(context.cursorRecognizedModel("grok-code-fast-1"), true);
assert.equal(context.cursorRecognizedModel("totally-unknown-model-x"), false);
assert.equal(context.cursorRecognizedModel(""), false);

// Subscription-covered detection. The founder's real export is every row Kind "Included", Cost
// "Included", Model "auto": no money changed hands, but ~9.8M real tokens did. The report must be able
// to tell that apart from "no data", so the parser records covered rows, covered tokens and the fact
// that no model was ever disclosed.
const covered = context.parseCursor([[
  HEADER,
  "2026-07-18T10:26:09.565Z,Included,auto,No,0,77554,356352,6578,440484,Included",
  "2026-07-18T10:25:45.159Z,Included,auto,No,0,143210,268288,7602,419100,Included",
].join("\n")]);
assert.equal(covered.subscriptionCovered, true, "all-Included rows carrying real tokens must be flagged subscription-covered");
assert.equal(covered.coveredRows, 2);
assert.equal(covered.coveredTokens, 859584);
assert.equal(covered.recordedCostTotal, 0);
assert.equal(covered.totalTokens, 859584);
assert.equal(covered.undisclosedRows, 2);
assert.equal(covered.modelsUndisclosed, true, "Cursor Auto never names the model, so no per-model split is possible");
assert.equal(covered.costComplete, false, "an Included cost cell is not a priced row; pricing must stay fail-closed");

// A Cost cell reading "Included" counts as covered even when the Kind column says otherwise.
const coveredByCostCell = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,On-Demand,auto,No,0,100,200,50,350,Included",
].join("\n")]);
assert.equal(coveredByCostCell.subscriptionCovered, true);
assert.equal(coveredByCostCell.coveredRows, 1);

// Fail-closed boundaries: one real charge anywhere puts the report back on the recorded-cost path,
// and an Included marker with no tokens behind it is not a covered-usage story worth leading with.
const mixedCharge = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,100,200,50,350,Included",
  "2026-07-18T11:00:00.000Z,On-Demand,claude-4.5-sonnet,No,2000,1500,0,400,2400,1.95",
].join("\n")]);
assert.equal(mixedCharge.subscriptionCovered, false, "a real recorded charge must suppress the covered-usage framing");
assert.equal(mixedCharge.recordedCostTotal, 1.95);
assert.equal(mixedCharge.modelsUndisclosed, false, "a named model alongside auto means the split is only partly unavailable");

const includedButCharged = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,100,200,50,350,0.42",
].join("\n")]);
assert.equal(includedButCharged.subscriptionCovered, false, "an Included row carrying a real dollar amount is not free usage");

const includedNoTokens = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,0,0,0,0,Included",
].join("\n")]);
assert.equal(includedNoTokens.subscriptionCovered, false, "no tokens means there is no consumed-usage story to tell");

const erroredOnly = context.parseCursor([[
  HEADER,
  '2026-07-18T10:00:00.000Z,"Errored, Not Charged",gpt-5,No,100,100,0,0,100,-',
].join("\n")]);
assert.equal(erroredOnly.subscriptionCovered, false, "a zero total with no Included marker is not a subscription-covered export");
assert.equal(erroredOnly.coveredRows, 0);

// "Nothing extra was charged and the recorded charge is zero" is a claim about EVERY row, so it needs
// every row's charge to be known. A Cost cell TOP cannot read leaves that row's charge unknown, and an
// unknown charge is not a zero one. One Included row among rows whose cost is blank, "N/A" or
// "Free trial" is not a subscription-covered export, and must degrade to the ordinary recorded-cost
// path rather than assert coverage over rows TOP knows nothing about.
const partialCoverage = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
  "2026-07-18T11:00:00.000Z,On-Demand,auto,No,0,1000,2000,500,3500,",
  "2026-07-18T12:00:00.000Z,On-Demand,auto,No,0,1000,2000,500,3500,N/A",
  "2026-07-18T13:00:00.000Z,On-Demand,auto,No,0,1000,2000,500,3500,Free trial",
].join("\n")]);
assert.equal(partialCoverage.turns, 4);
assert.equal(partialCoverage.coveredRows, 1, "only the explicitly Included row is covered");
assert.equal(partialCoverage.missingCostRows, 4);
assert.equal(partialCoverage.recordedCostTotal, 0, "no row recorded a readable charge");
assert.equal(partialCoverage.chargeKnownRows, 1,
  "three rows carry a Cost cell TOP cannot read, so their charge is unknown");
assert.equal(partialCoverage.subscriptionCovered, false,
  "one Included row cannot vouch for three rows whose charge TOP does not know");

// The tightening must not swing the other way. A row Cursor recorded as genuinely not charged has a
// KNOWN charge of zero, so it does not withdraw the covered claim.
const coveredWithNotCharged = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
  '2026-07-18T11:00:00.000Z,"Errored, Not Charged",auto,No,0,100,200,50,350,-',
].join("\n")]);
assert.equal(coveredWithNotCharged.chargeKnownRows, 2);
assert.equal(coveredWithNotCharged.subscriptionCovered, true,
  "a recorded not-charged row is a known zero, not an unknown");

// The founder's real shape: every row Included, so every row's charge is known and the claim holds.
const fullyCovered = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
  "2026-07-18T11:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
].join("\n")]);
assert.equal(fullyCovered.chargeKnownRows, fullyCovered.turns);
assert.equal(fullyCovered.subscriptionCovered, true);

// A single unreadable Cost cell anywhere is enough to withdraw the claim.
const oneUnreadable = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
  "2026-07-18T11:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
  "2026-07-18T12:00:00.000Z,On-Demand,claude-4.5-sonnet,No,0,1000,2000,500,3500,pending",
].join("\n")]);
assert.equal(oneUnreadable.coveredRows, 2);
assert.equal(oneUnreadable.chargeKnownRows, 2);
assert.equal(oneUnreadable.subscriptionCovered, false,
  "an unreadable charge on one row withdraws a claim made about all of them");

// Auto is the only undisclosed-model marker. Named models, including Cursor's own, stay attributable.
assert.equal(context.cursorUndisclosedModel("auto"), true);
assert.equal(context.cursorUndisclosedModel("AUTO"), true);
assert.equal(context.cursorUndisclosedModel(" auto "), true);
assert.equal(context.cursorUndisclosedModel("auto-2"), false);
assert.equal(context.cursorUndisclosedModel("cursor-small"), false);
assert.equal(context.cursorUndisclosedModel("claude-4.5-sonnet"), false);
assert.equal(context.cursorUndisclosedModel(""), false);

// A file whose header is not a Cursor usage export is skipped and counted, not guessed.
const wrongFile = context.parseCursor(["model,input_tokens,output_tokens,cost_usd\nclaude-opus-4-8,100,10,0.01"]);
assert.equal(wrongFile.turns, 0, "a Console CSV must not be ingested by the Cursor reader");
assert.equal(wrongFile.unrecognizedFiles, 1);
assert.deepEqual(Object.keys(wrongFile.by), []);

// Multiple Cursor files sum per model regardless of file order.
const fileA = HEADER + "\n2026-07-10T09:00:00.000Z,On-Demand,composer-1,No,100,80,10,20,110,0.10";
const fileB = HEADER + "\n2026-07-11T09:00:00.000Z,On-Demand,composer-1,No,200,150,30,40,270,0.20";
const forward = context.parseCursor([fileA, fileB]);
const backward = context.parseCursor([fileB, fileA]);
for (const result of [forward, backward]) {
  const { cost, ...counts } = modelRow(result.by["composer-1"]);
  assert.deepEqual(counts, { inp: 230, out: 60, cw: 70, cr: 40, turns: 2, costRows: 2, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 }, coveredRows: 0, chargeKnownRows: 2 });
  assert.ok(Math.abs(cost - 0.3) < 1e-9, "recorded costs must sum across files in any order");
  assert.equal(result.days, 2);
  assert.equal(result.coverage.files_with_usage, 2);
  assert.equal(result.coverage.complete, true);
}

// Header-based detection separates Cursor exports from Console CSVs and fails closed on mixes.
assert.equal(context.detectUsageCsvKind([fileA]), "cursor");
assert.equal(context.detectUsageCsvKind(["model,input_tokens,output_tokens,cost_usd\nclaude-opus-4-8,100,10,0.01"]), "");
assert.equal(context.detectUsageCsvKind([fileA, "model,input_tokens,output_tokens,cost_usd\nclaude-opus-4-8,100,10,0.01"]), "mixed");

// ---------- local-only time buckets for the token-over-time chart ----------
// A subscription-coveredExport export charges nothing, so a dollar axis is a flat line at zero. The chart
// is drawn in tokens instead, which needs real time buckets. These stay on this machine: they are
// charted locally and never enter the research-safe export, which excludes exact timestamps.
const coveredExport = context.parseCursor([[
  HEADER,
  '"2026-07-18T01:26:09.565Z","Included","auto","No","0","77554","356352","6578","440484","Included"',
  '"2026-07-18T01:59:00.000Z","Included","auto","No","0","1000","2000","500","3500","Included"',
  '"2026-07-18T10:26:09.565Z","Included","auto","No","0","143210","268288","7602","419100","Included"',
].join("\n")]);
assert.equal(coveredExport.subscriptionCovered, true);
assert.equal(coveredExport.modelsUndisclosed, true);
assert.equal(coveredExport.days, 1, "the whole export lands on one calendar day");
assert.deepEqual(Object.keys(coveredExport.tokenTimeline.byDay), ["2026-07-18"]);
assert.deepEqual(Object.keys(coveredExport.tokenTimeline.byHour).sort(), ["2026-07-18T01", "2026-07-18T10"],
  "rows must bucket by the hour their own timestamp records");
assert.equal(coveredExport.tokenTimeline.byHour["2026-07-18T01"].rows, 2, "two rows share the 01:00 hour");
assert.equal(coveredExport.tokenTimeline.byHour["2026-07-18T01"].cr, 358352);
assert.equal(coveredExport.tokenTimeline.hourRows, 3);
assert.equal(coveredExport.tokenTimeline.datedRows, 3);
assert.equal(coveredExport.tokenTimeline.undatedRows, 0);
// Day totals must agree with the report totals, or a chart could contradict the number beside it.
const dayBucket = coveredExport.tokenTimeline.byDay["2026-07-18"];
assert.equal(dayBucket.inp + dayBucket.out + dayBucket.cw + dayBucket.cr, coveredExport.totalTokens,
  "the charted day buckets must sum to the same tokens the report shows");

// A date cell with no time contributes a day bucket and no hour bucket, so an hourly axis is never
// drawn over a time the file did not record.
const dateOnly = context.parseCursor([[HEADER, "2026-07-12,Included,auto,No,100,80,10,20,110,Included"].join("\n")]);
assert.deepEqual(Object.keys(dateOnly.tokenTimeline.byDay), ["2026-07-12"]);
assert.deepEqual(Object.keys(dateOnly.tokenTimeline.byHour), [], "a date without an hour must not invent one");
assert.equal(dateOnly.tokenTimeline.hourRows, 0);
assert.equal(dateOnly.tokenTimeline.datedRows, 1);

// An unreadable date is counted as undated rather than dropped silently or coerced to a date.
const undated = context.parseCursor([[HEADER, "not-a-date,Included,auto,No,100,80,10,20,110,Included"].join("\n")]);
assert.equal(undated.tokenTimeline.undatedRows, 1);
assert.equal(undated.tokenTimeline.datedRows, 0);
assert.deepEqual(Object.keys(undated.tokenTimeline.byDay), []);
assert.equal(undated.turns, 1, "an undated row still counts toward the totals");

// Per-event token totals feed the concentration curve, and are bounded rather than grown without limit.
assert.deepEqual(Array.from(coveredExport.eventTokens), [440484, 3500, 419100]);
assert.equal(Array.from(coveredExport.eventTokens).reduce((s, v) => s + v, 0), coveredExport.totalTokens,
  "per-event samples must account for exactly the tokens the report totals");
assert.match(html, /var CURSOR_EVENT_SAMPLE_CAP=\d+;/, "the per-event sample must carry an explicit cap");
const cap = Number(/var CURSOR_EVENT_SAMPLE_CAP=(\d+);/.exec(html)[1]);
const huge = context.parseCursor([[HEADER, ...Array.from({ length: cap + 5 },
  () => "2026-07-12T01:00:00Z,Included,auto,No,100,80,10,20,110,Included")].join("\n")]);
assert.equal(huge.eventTokens, null,
  "beyond the cap the sample is dropped, never truncated into a distribution that would misstate the shape");
assert.equal(huge.turns, cap + 5, "dropping the sample must not change the counted usage events");

// ---------- a row TOP never read cannot be vouched for ----------
// chargeKnownRows===rows compares two counters that a dropped row is absent from on BOTH sides, so it
// passed trivially for anything discarded before rows++. Each case below carries a genuine $50 On-Demand
// charge that the covered claim would otherwise have declared "nothing extra was charged".

// 1. An unrecognized model name. Recognition remains fail closed for pricing. The dedicated never-zero
// contract requires the parser to retain its usage in an unpriced bucket. This regression independently
// pins the covered-plan boundary so an unknown charged row can never disappear into a zero-charge claim.
const chargeOnExcludedModel = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
  "2026-07-18T11:00:00.000Z,On-Demand,code-supernova,No,0,1000,2000,500,3500,50.00",
].join("\n")]);
assert.equal(chargeOnExcludedModel.subscriptionCovered, false,
  "a charged row with an unrecognized model must withdraw the covered claim");

// The eleven names Cursor ships today that fall outside the recognized pricing list. Each must withdraw
// the covered claim and remain unavailable for a guessed rate.
for (const unknown of ["code-supernova", "code-supernova-1-million", "sonic", "kimi-k2-instruct",
  "qwen3-coder", "minimax-m2", "glm-4.6", "o3", "llama-4-maverick", "default", "gpt5-codex"]) {
  assert.equal(context.cursorRecognizedModel(unknown), false, `${unknown} is outside the recognized list`);
  const withCharge = context.parseCursor([[
    HEADER,
    "2026-07-18T10:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
    `2026-07-18T11:00:00.000Z,On-Demand,${unknown},No,0,1000,2000,500,3500,50.00`,
  ].join("\n")]);
  assert.equal(withCharge.subscriptionCovered, false,
    `a real charge on ${unknown} must withdraw the covered claim`);
}

// 2. A truncated line. The row carries the same $50 and is dropped before anything can read its cost.
const chargeOnMalformedRow = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
  "2026-07-18T11:00:00.000Z,On-Demand,50.00",
].join("\n")]);
assert.equal(chargeOnMalformedRow.malformedRows, 1);
assert.equal(chargeOnMalformedRow.subscriptionCovered, false,
  "a line too short to read may be carrying a charge, and an unread row cannot be reported as a zero one");

// 3. A second file whose header TOP does not recognize. Its rows are never opened at all.
const chargeInUnreadFile = context.parseCursor([
  [HEADER, "2026-07-18T10:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included"].join("\n"),
  "something,else,entirely\n2026-07-18,On-Demand,50.00",
]);
assert.equal(chargeInUnreadFile.unrecognizedFiles, 1);
assert.equal(chargeInUnreadFile.subscriptionCovered, false,
  "a file TOP could not parse cannot be included in a claim about every row");

// The tightening must not swing the other way: a clean export where every row parses still qualifies.
const cleanCovered = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
  "2026-07-18T11:00:00.000Z,Included,claude-4.5-sonnet,No,0,1000,2000,500,3500,Included",
].join("\n")]);
assert.equal(cleanCovered.excludedRows, 0);
assert.equal(cleanCovered.malformedRows, 0);
assert.equal(cleanCovered.unrecognizedFiles, 0);
assert.equal(cleanCovered.subscriptionCovered, true,
  "an export where every row parses cleanly and every charge is a known zero is still subscription-covered");

// ---------- the mixed export: some rows named, some not ----------
// One disclosed row alongside Auto rows does not make the export model-disclosed. modelsUndisclosed is
// correctly false, and undisclosedRows is what the report must read to decide whether it may name a model.
const mixedDisclosure = context.parseCursor([[
  HEADER,
  ...Array.from({ length: 12 }, (_, i) =>
    `2026-07-18T1${i % 10}:00:00.000Z,Included,auto,No,0,100000,450000,10000,560000,Included`),
  "2026-07-18T23:00:00.000Z,Included,claude-4.5-sonnet,No,0,1000,0,300,1300,Included",
].join("\n")]);
assert.equal(mixedDisclosure.turns, 13);
assert.equal(mixedDisclosure.undisclosedRows, 12);
assert.equal(mixedDisclosure.modelsUndisclosed, false,
  "one named model means the export is not wholly undisclosed");
assert.ok(mixedDisclosure.undisclosedRows > 0 && mixedDisclosure.undisclosedRows < mixedDisclosure.turns,
  "the mixed case is exactly the one the all-or-nothing flag cannot describe");
assert.equal(mixedDisclosure.undisclosedTokens, 6720000);
assert.equal(mixedDisclosure.totalTokens, 6721300);
assert.ok(mixedDisclosure.totalTokens - mixedDisclosure.undisclosedTokens < mixedDisclosure.totalTokens / 1000,
  "the single named row is a rounding error of the work, which is why it must never be shown as 100%");

// Founder transition contracts. These replace the old model-drop assertions with stronger requirements
// in the same parser regression: hostile labels are made safe without losing usage, and safe unknown labels
// keep all source usage while remaining on the missing-cost path.
const retainedHostile = context.parseCursor([[
  HEADER,
  "2026-07-14T09:00:00.000Z,On-Demand,<img src=x onerror=alert(1)>,No,10,10,0,1,11,0.01",
  "2026-07-14T09:01:00.000Z,On-Demand,__proto__,No,10,10,0,1,11,0.01",
  "2026-07-14T09:02:00.000Z,On-Demand,constructor,No,10,10,0,1,11,0.01",
].join("\n")]);
assert.equal(retainedHostile.turns, 3, "hostile unknown labels must not erase their usage events");
assert.equal(Object.values(retainedHostile.by).reduce((total, entry) => total + entry.inp + entry.out + entry.cw + entry.cr, 0), 33,
  "all tokens from hostile unknown labels must remain visible");
assert.ok(Object.keys(retainedHostile.by).length > 0, "hostile labels must reach a safe unpriced bucket");
assert.ok(Object.keys(retainedHostile.by).every((name) => !/[<>\\/]/.test(name) && name !== "__proto__" && name !== "constructor"),
  "hostile model text and prototype keys must never become report keys");
assert.ok(Object.values(retainedHostile.by).every((entry) => entry.costRows === 0 && entry.missingCostRows > 0),
  "hostile unknown labels must remain unpriced rather than keeping a recorded or guessed zero");

const retainedUnknown = context.parseCursor([[
  HEADER,
  "2026-07-19T09:31:00.000Z,On-Demand,totally-unknown-model-x,No,50,50,0,10,60,",
].join("\n")]);
assert.equal(retainedUnknown.turns, 1, "a safe unknown-model row must remain in counted usage events");
assert.deepEqual(
  modelRow(retainedUnknown.by["totally-unknown-model-x"]),
  { inp: 50, out: 10, cw: 0, cr: 0, turns: 1, cost: 0, costRows: 0, missingCostRows: 1, missing: { inp: 50, out: 10, cw: 0, cr: 0 } },
  "unknown-model tokens must remain visible without a guessed or false-zero cost",
);
assert.equal(retainedUnknown.excludedRows, 0, "a safe unknown label is unpriceable, not disposable");
assert.equal(retainedUnknown.costComplete, false, "unknown cost must remain incomplete");

console.log("TOP Analyzer Cursor parser regression tests passed");

// Per-model subscription-covered counters. These are what lets a model group say its charge was
// positively nothing rather than merely absent, so each one is pinned against a mixed export.
const perModelCovered = context.parseCursor([[
  HEADER,
  "2026-07-18T10:00:00.000Z,Included,composer-1,No,0,100,200,50,350,Included",
  "2026-07-18T11:00:00.000Z,Included,composer-1,No,0,100,200,50,350,Included",
  '2026-07-18T12:00:00.000Z,"Errored, Not Charged",composer-1,No,0,10,0,0,10,-',
  "2026-07-18T13:00:00.000Z,On-Demand,claude-4.5-sonnet,No,0,100,200,50,350,",
].join("\n")]);
assert.equal(perModelCovered.by["composer-1"].coveredRows, 2,
  "only the explicitly Included rows count as covered for this model");
assert.equal(perModelCovered.by["composer-1"].chargeKnownRows, 3,
  "an errored not-charged row has a known charge even though it is not an Included row");
assert.equal(perModelCovered.by["claude-4.5-sonnet"].coveredRows, 0);
assert.equal(perModelCovered.by["claude-4.5-sonnet"].chargeKnownRows, 0,
  "a blank Cost cell leaves that row's charge unknown");
assert.equal(perModelCovered.subscriptionCovered, false,
  "one unreadable Cost cell withdraws the covered claim for the whole file");
assert.equal(
  perModelCovered.by["composer-1"].coveredRows + perModelCovered.by["claude-4.5-sonnet"].coveredRows,
  perModelCovered.coveredRows,
  "per-model covered counts must sum to the file-level count",
);
assert.equal(
  perModelCovered.by["composer-1"].chargeKnownRows + perModelCovered.by["claude-4.5-sonnet"].chargeKnownRows,
  perModelCovered.chargeKnownRows,
  "per-model known-charge counts must sum to the file-level count",
);
