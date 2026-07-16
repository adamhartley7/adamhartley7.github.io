const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const parserStart = html.indexOf("function splitCSV");
const parserEnd = html.indexOf("function estTokens", parserStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart, "could not locate Cursor parser");

const context = { Date, Number, String, Object, Array, RegExp, Math, JSON };
vm.createContext(context);
vm.runInContext(html.slice(parserStart, parserEnd), context);

const canonical = [
  "timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens",
  "2026-07-16T23:30:00+01:00,composer-1,0.010001,100,20,30,40",
  "2026-07-17T00:30:00+01:00,composer-1,0.020002,200,30,50,60",
  "2026-07-18T01:00:00Z,gpt-5.6-sol,0,10,2,3,4",
].join("\r\n");

const result = context.parseCursorCSV([canonical]);
assert.equal(result.cursor, true);
assert.equal(result.csv, true);
assert.equal(result.topSource, "cursor");
assert.equal(result.turns, 3);
assert.equal(result.sessions, 0);
assert.equal(result.days, 2, "active days are derived in UTC");
assert.equal(result.periodStart, "2026-07-16");
assert.equal(result.periodEnd, "2026-07-18");
assert.equal(result.costRows, 3);
assert.equal(result.missingCostRows, 0);
assert.equal(result.costComplete, true);
assert.equal(result.estimate, false);
assert.equal(result.valueModelEligible, false);
assert.equal(result.by["composer-1"].inp, 300);
assert.equal(result.by["composer-1"].out, 50);
assert.equal(result.by["composer-1"].cr, 80);
assert.equal(result.by["composer-1"].cw, 100);
assert.equal(result.by["composer-1"].cost, 0.030003);
assert.equal(result.by["composer-1"].turns, 2);
assert.equal(result.dailyByModel.length, 2);
assert.doesNotMatch(JSON.stringify(result), /23:30:00|00:30:00|01:00:00/,
  "exact timestamps must not survive local aggregation");

const aliases = [
  "\uFEFFdate,model,cost,input tokens,output tokens,cache read,cache write",
  "2026-07-16 12:00:00Z,claude-sonnet-5,0.1,1,2,3,4",
].join("\r\n");
assert.equal(context.parseCursorCSV([aliases]).turns, 1,
  "the narrow documented aliases and BOM/CRLF must be accepted");

const quotedBomHeader = [
  '\uFEFF"timestamp","model","cost_usd","input_tokens","output_tokens","cache_read_tokens","cache_write_tokens"',
  '"2026-07-16T12:00:00Z","composer-1","0.1","1","2","3","4"',
].join("\r\n");
assert.equal(context.parseCursorCSV([quotedBomHeader]).turns, 1,
  "a UTF-8 BOM before a quoted first header must be accepted");

const acceptedModels = [
  "claude-3-5-sonnet-20241022",
  "gpt-4o",
  "gpt-5.6-codex-preview",
  "o3-mini-high",
  "gemini-2.5-pro-preview",
  "deepseek-v4-reasoner",
  "grok-4-fast",
  "grok-code-fast-1",
  "composer-1-thinking",
  "cursor-fast-preview",
  "Auto",
];
for (const model of acceptedModels) {
  const csv = [
    "timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens",
    `2026-07-16T12:00:00Z,${model},0.1,1,1,1,1`,
  ].join("\n");
  assert.equal(context.parseCursorCSV([csv]).turns, 1, `expected public Cursor model label to be accepted: ${model}`);
}

function distinctComposerCsv(count) {
  return [
    "timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens",
    ...Array.from({ length: count }, (_, index) => `2026-07-16T12:00:00Z,composer-${index + 1},0,1,0,0,0`),
  ].join("\n");
}
const sixtyFourModels = context.parseCursorCSV([distinctComposerCsv(64)]);
assert.equal(Object.keys(sixtyFourModels.by).length, 64, "the browser boundary must accept exactly 64 distinct Cursor models");
assert.throws(() => context.parseCursorCSV([distinctComposerCsv(65)]), /at most 64 distinct public model labels/,
  "the browser boundary must reject a 65th distinct Cursor model before export");

function rejects(csv, pattern) {
  assert.throws(() => context.parseCursorCSV([csv]), pattern);
}

assert.throws(() => context.parseCursorCSV([canonical, canonical]), /exactly one Cursor usage CSV/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens\n2026-07-16T00:00:00Z,gpt-5.6-sol,1,1,1,1", /cache_write_tokens/);
rejects("timestamp,timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00Z,2026-07-16T00:00:00Z,gpt-5.6-sol,1,1,1,1,1", /duplicate header/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_tokens\n2026-07-16T00:00:00Z,gpt-5.6-sol,1,1,1,1", /requires separate cache_read_tokens and cache_write_tokens/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00Z,gpt-5.6-sol,1,1,1", /wrong number of columns/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n\"2026-07-16T00:00:00Z,gpt-5.6-sol,1,1,1,1,1", /unclosed quoted field/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00Z,\"gpt-5.6-sol\"x,1,1,1,1,1", /characters after a closing quote/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00,gpt-5.6-sol,1,1,1,1,1", /timezone/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-02-30T00:00:00Z,gpt-5.6-sol,1,1,1,1,1", /real calendar time/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00Z,gpt-5.6-sol,Included,1,1,1,1", /recorded nonnegative decimal/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00Z,gpt-5.6-sol,-1,1,1,1,1", /recorded nonnegative decimal/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00Z,gpt-5.6-sol,1,1.5,1,1,1", /whole number/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00Z,gpt-5.6-sol,1,1e3,1,1,1", /whole number/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00Z,gpt-5.6-sol,1,9007199254740992,1,1,1", /supported range/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00Z,gpt-5.6-sol,1,9007199254740991,1,0,0", /total exceeds the supported range/);
for (const model of [
  "Adam Secret Project",
  "customer-847291",
  "C:\\private\\project",
  "claude-sonnet-4-5-private-project",
  "gpt-5.6-customer847",
  "composer-adam",
  "cursor-secret",
  "account-12345",
]) {
  rejects([
    "timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens",
    `2026-07-16T00:00:00Z,${model},1,1,1,1,1`,
  ].join("\n"), /model label/);
}
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00Z,unknown,1,1,1,1,1", /model label/);
rejects("timestamp,model,cost_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens\n2026-07-16T00:00:00Z,gpt-5.6-sol,1,0,0,0,0", /no recorded token usage/);
rejects(canonical + "\n2026-07-19T00:00:00Z,gpt-5.6-sol,,1,1,1,1", /recorded nonnegative decimal/);

const markdownStart = html.indexOf("function cursorUsageTotals");
const markdownEnd = html.indexOf('document.getElementById("downloadAIEvents")', markdownStart);
assert.ok(markdownStart >= 0 && markdownEnd > markdownStart, "could not locate Cursor Markdown builder");
context.safeCodexDay = value => String(value).slice(0, 10);
context.markdownSafe = value => String(value).replace(/\|/g, "\\|");
vm.runInContext(html.slice(markdownStart, markdownEnd), context);
const note = context.buildCursorObsidianReport(result, "2026-07-19");
assert.match(note, /^---\ntop_source: cursor\naccount_scope: self\nperiod: 2026-07-16\.\.2026-07-18\ncurrency: USD\n/m);
assert.match(note, /  cost: 0\.030003\n/);
assert.match(note, /  requests: 3\n  credits: null\n/);
assert.match(note, /\| UTC day \| AI version \| Requests \|/);
assert.match(note, /## Model mix/);
assert.doesNotMatch(note, /23:30:00|00:30:00|01:00:00|C:\\private/i);

console.log("TOP Analyzer strict Cursor CSV tests passed");
