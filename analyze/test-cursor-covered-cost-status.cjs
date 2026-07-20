"use strict";

/*
 * The payload truth fix.
 *
 * A Cursor export whose every row is marked "Included" is a positively-known zero charge: the
 * subscription absorbed it and no money moved. TOP used to export that as cost status
 * "unavailable", which is the same status it uses for a file it genuinely could not price, and
 * which the share preview renders to the person about to share it as "no dollar figure, because
 * TOP could not price this file." That is a false statement about their own data, and it is on
 * screen at exactly the moment they decide whether to share.
 *
 * "We know it was free" and "we could not price it" are different facts and must carry different
 * statuses. This file pins that they do, and that every surface reading the payload agrees.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const REAL_CSV = process.env.TOP_CURSOR_REAL_CSV || "";

function slice(startNeedle, endNeedle) {
  const start = html.indexOf(startNeedle);
  assert.ok(start >= 0, `missing anchor: ${startNeedle}`);
  const end = html.indexOf(endNeedle, start);
  assert.ok(end > start, `missing closing anchor: ${endNeedle}`);
  return html.slice(start, end);
}

function makeContext() {
  const context = { Date, JSON, Math, Number, Object, String, Array, RegExp, Map, Set, isNaN, parseFloat, parseInt, isFinite };
  vm.createContext(context);
  vm.runInContext(slice("var PRICING_CHECKED=", "var VM="), context);
  vm.runInContext(slice("function splitCSV(", "function detectUsageCsvKind("), context);
  vm.runInContext(slice("var RESEARCH_SCHEMA_VERSION=", 'document.getElementById("downloadResearchJSON")'), context);
  vm.runInContext(slice("var RESEARCH_EXCLUSION_WORDS=", "function pilotShareScenario("), context);
  return context;
}

const context = makeContext();
const HEADER = "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";

function parse(rows) {
  context.__csv = [HEADER, ...rows].join("\n");
  return vm.runInContext("parseCursor([__csv])", context);
}
function safeObject(result) {
  context.__res = result;
  return vm.runInContext("buildResearchSafeObject(__res,null,null,0.4,'2026-07-19')", context);
}
function plain(data, covered) {
  context.__data = data;
  context.__covered = covered || null;
  return vm.runInContext("describeResearchSafePlain(__data,__covered)", context);
}

const COVERED_STATUS = "subscription_covered";

// ---------------------------------------------------------------- 1. a fully covered export
const covered = parse([
  "2026-07-18T10:26:09.565Z,Included,auto,No,0,77554,356352,6578,440484,Included",
  "2026-07-18T10:25:45.159Z,Included,auto,No,0,143210,268288,7602,419100,Included",
]);
assert.equal(covered.subscriptionCovered, true, "fixture must be a subscription-covered export");

const coveredSafe = safeObject(covered);
assert.equal(coveredSafe.cost.status, COVERED_STATUS,
  "a positively-known zero charge must not be exported as unavailable");
assert.equal(coveredSafe.cost.usd, 0,
  "a known zero charge is a number, and the number is zero");
assert.equal(coveredSafe.by_model.length, 1);
assert.equal(coveredSafe.by_model[0].cost.status, COVERED_STATUS);
assert.equal(coveredSafe.by_model[0].cost.usd, 0);
assert.match(coveredSafe.cost.basis, /subscription_covered/,
  "the cost basis must record that a subscription covered the charge");
assert.match(coveredSafe.measurement.cost_basis, /included|covered/i,
  "the measurement basis must not claim checked rates were applied to a covered export");
assert.equal(coveredSafe.pricing.unpriced_model_groups, 0,
  "a row whose charge is known is not an unpriced model group");

// no saving is claimed anywhere on this path
assert.equal(coveredSafe.value_model.truth_status, "not_available",
  "a covered export must not carry a routing-saving illustration");

// ---------------------------------------------------------------- 2. the rendered words agree
const coveredPlain = plain(coveredSafe, null);
const costLine = coveredPlain.contains.find((line) => line.startsWith("Cost:"));
assert.ok(costLine, "the share preview must state a cost line");
assert.doesNotMatch(costLine, /could not price/i,
  "a covered export must never be described as one TOP could not price");
assert.match(costLine, /subscription covered|no charge/i,
  "the share preview must say the subscription covered it");
assert.doesNotMatch(coveredPlain.oneLine, /\$0\.00/,
  "the pinned one-line summary must never lead with a zero-dollar figure");
assert.doesNotMatch(coveredPlain.oneLine, /could not price/i);
assert.match(coveredPlain.oneLine, /no charge/i,
  "the pinned one-line summary must state the known zero charge in words");

const versionsLine = coveredPlain.contains.find((line) => line.startsWith("AI versions:"));
assert.ok(versionsLine);
assert.doesNotMatch(versionsLine, /and cost figure/i,
  "a covered export must not promise a per-model billed cost figure");

// ---------------------------------------------------------------- 3. unpriceable stays unpriceable
// One Included row cannot vouch for rows whose Cost cell TOP could not read. That file is still
// genuinely unpriceable and must keep the old status, or the fix would have papered over the very
// thing it exists to separate.
const partly = parse([
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
  "2026-07-18T11:00:00.000Z,On-Demand,auto,No,0,1000,2000,500,3500,",
  "2026-07-18T12:00:00.000Z,On-Demand,auto,No,0,1000,2000,500,3500,N/A",
]);
assert.equal(partly.subscriptionCovered, false, "an unreadable Cost cell withdraws the covered claim");
const partlySafe = safeObject(partly);
assert.equal(partlySafe.cost.status, "unavailable",
  "a file TOP genuinely could not price must keep the unavailable status");
assert.equal(partlySafe.cost.usd, null,
  "an unknown cost must never be rendered as zero");
const partlyPlain = plain(partlySafe, null);
assert.match(partlyPlain.contains.find((line) => line.startsWith("Cost:")), /could not price/i,
  "a genuinely unpriceable file must still say so");

// ---------------------------------------------------------------- 4. a real charge is still a charge
const charged = parse([
  "2026-07-18T10:00:00.000Z,Included,auto,No,0,1000,2000,500,3500,Included",
  "2026-07-18T11:00:00.000Z,On-Demand,auto,No,0,1000,2000,500,3500,0.42",
]);
assert.equal(charged.subscriptionCovered, false, "a real recorded charge is not free usage");
const chargedSafe = safeObject(charged);
assert.notEqual(chargedSafe.cost.status, COVERED_STATUS,
  "an export carrying a real charge must never claim a zero charge");
assert.ok(chargedSafe.cost.usd === null || chargedSafe.cost.usd > 0);

// ---------------------------------------------------------------- 5. the two statuses are distinct
assert.notEqual(COVERED_STATUS, "unavailable");
assert.ok(html.includes(COVERED_STATUS), "the covered status must be declared in the page");

// ---------------------------------------------------------------- 6. the delivery worker agrees
const worker = fs.readFileSync(path.join(__dirname, "delivery-worker/src/index.mjs"), "utf8");
assert.ok(worker.includes(`"${COVERED_STATUS}"`),
  "the delivery worker must accept the covered status the page emits");
assert.match(worker, new RegExp(`${COVERED_STATUS}[\\s\\S]{0,400}usd !== 0`),
  "the worker must assert that a covered cost is exactly zero, never merely nullable");

// ---------------------------------------------------------------- 7. the founder's real export
// Optional: only runs when the real file is supplied, so the committed suite stays self-contained.
if (REAL_CSV && fs.existsSync(REAL_CSV)) {
  // Parsed with its own header: the real export carries extra columns the synthetic fixtures omit.
  context.__csv = fs.readFileSync(REAL_CSV, "utf8");
  const real = vm.runInContext("parseCursor([__csv])", context);
  assert.equal(real.turns, 34, "the real Cursor export must still yield 34 rows");
  assert.equal(real.totalTokens, 9829194, "the real Cursor export must still yield 9,829,194 tokens");
  assert.equal(real.subscriptionCovered, true);
  const realSafe = safeObject(real);
  assert.equal(realSafe.cost.status, COVERED_STATUS);
  assert.equal(realSafe.cost.usd, 0);
  assert.equal(realSafe.totals.total_tokens, 9829194);
  const realPlain = plain(realSafe, null);
  assert.doesNotMatch(realPlain.contains.join(" "), /could not price/i);
  process.stdout.write("cursor covered cost status: verified against the real 34-row export\n");
}

process.stdout.write("cursor covered cost status: known zero and unpriceable are separate everywhere\n");
