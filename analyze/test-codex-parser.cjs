const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const parserStart = html.indexOf("function safeCodexCount");
const parserEnd = html.indexOf("function splitCSV", parserStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart, "could not locate Codex parser");

const context = { fmtInt(value) { return String(Math.round(Number(value) || 0)); } };
vm.createContext(context);
vm.runInContext(html.slice(parserStart, parserEnd), context);

const PRIVATE = "PRIVATE_SENTINEL_MUST_NOT_LEAK";
function usage(input, cached, output, reasoning, total = input + output) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total,
  };
}
function line(timestamp, type, payload) {
  return JSON.stringify({ timestamp, type, payload });
}
function token(timestamp, total, last = total, extras = {}) {
  return line(timestamp, "event_msg", {
    type: "token_count",
    info: { total_token_usage: total, last_token_usage: last, model_context_window: 200000 },
    rate_limits: {
      plan_type: PRIVATE,
      limit_id: PRIVATE,
      primary: { used_percent: 94, resets_at: 123456789 },
      credits: { balance: PRIVATE },
    },
    ...extras,
  });
}

const fixture = [
  line("2026-07-15T09:00:00Z", "session_meta", {
    id: PRIVATE,
    session_id: PRIVATE,
    cwd: `C:\\${PRIVATE}`,
    base_instructions: PRIVATE,
    git: { repository_url: PRIVATE },
  }),
  line("2026-07-15T09:00:01Z", "response_item", {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: PRIVATE }],
  }),
  line("2026-07-15T09:00:02Z", "event_msg", { type: "agent_message", message: PRIVATE }),
  line("2026-07-15T09:00:03Z", "turn_context", {
    model: "gpt-5.6-sol",
    turn_id: PRIVATE,
    cwd: PRIVATE,
    workspace_roots: [PRIVATE],
    effort: PRIVATE,
  }),
  token("2026-07-15T09:00:04Z", usage(100, 40, 20, 5)),
  token("2026-07-15T09:00:05Z", usage(100, 40, 20, 5), usage(100, 40, 20, 5)),
  token("2026-07-15T09:00:06Z", usage(150, 50, 30, 8), usage(50, 10, 10, 3)),
  line("2026-07-16T10:00:00Z", "turn_context", { model: "gpt-5.6-terra", turn_id: PRIVATE }),
  token("2026-07-16T10:00:01Z", usage(170, 60, 40, 10), usage(20, 10, 10, 2)),
  token("2026-07-16T10:00:02Z", usage(10, 2, 4, 1), usage(10, 2, 4, 1)),
  line("2026-07-16T10:00:03Z", "world_state", { full: PRIVATE }),
  line("2026-07-16T10:00:04Z", "compacted", { message: PRIVATE, replacement_history: PRIVATE }),
].join("\n");

const result = context.parseCodex([fixture]);
assert.equal(result.kind, "Codex local session logs");
assert.equal(result.codex, true);
assert.equal(result.turns, 4, "equal cumulative snapshots must not be counted twice");
assert.equal(result.sessions, 1);
assert.equal(result.days, 2);
assert.equal(result.coverage.counter_resets, 1);
assert.equal(result.coverage.complete, false);
assert.deepEqual(
  { ...result.by["gpt-5.6-sol"] },
  { inp: 100, out: 30, cw: 0, cr: 50, reasoning: 8, turns: 2 },
);
assert.deepEqual(
  { ...result.by["gpt-5.6-terra"] },
  { inp: 18, out: 14, cw: 0, cr: 12, reasoning: 3, turns: 2 },
);

const exportStart = html.indexOf("function codexCoverageForExport");
const exportEnd = html.indexOf('document.getElementById("downloadAIEvents")', exportStart);
assert.ok(exportStart >= 0 && exportEnd > exportStart, "could not locate Codex export builders");
vm.runInContext(html.slice(exportStart, exportEnd), context);

const jsonl = context.buildAIEventsJSONL(result, "2026-07-16T12:00:00Z");
const aggregate = JSON.parse(jsonl.trim());
assert.deepEqual(Object.keys(aggregate), [
  "schema_version", "provider", "surface", "generated_date", "coverage", "totals", "by_model",
]);
assert.deepEqual(Object.keys(aggregate.coverage), [
  "files_selected", "files_parsed", "files_with_usage", "files_skipped", "malformed_lines", "oversized_lines", "counter_resets", "complete",
]);
assert.deepEqual(Object.keys(aggregate.totals), [
  "input_tokens", "cached_input_tokens", "noncached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens", "sessions", "active_days",
]);
for (const row of aggregate.by_model) {
  assert.deepEqual(Object.keys(row), [
    "model", "input_tokens", "cached_input_tokens", "noncached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens", "usage_updates",
  ]);
}
assert.equal(aggregate.totals.input_tokens, 180);
assert.equal(aggregate.totals.cached_input_tokens, 62);
assert.equal(aggregate.totals.noncached_input_tokens, 118);
assert.equal(aggregate.totals.output_tokens, 44);
assert.equal(aggregate.totals.reasoning_output_tokens, 11);
assert.equal(aggregate.totals.total_tokens, 224, "cached and reasoning tokens must not be added twice");

const markdown = context.buildObsidianAIHistory(result, "2026-07-16");
for (const output of [jsonl, markdown]) {
  assert.doesNotMatch(output, new RegExp(PRIVATE));
  for (const denied of ["session_id", "turn_id", "cwd", "workspace_roots", "rate_limits", "plan_type", "credits", "repository_url", "response_item"]) {
    assert.doesNotMatch(output, new RegExp(denied));
  }
}
assert.match(markdown, /does not connect Obsidian to AI memory automatically/);
assert.match(markdown, /Keep raw Codex rollout files outside synced vaults/);

const roundTrip = context.parseCodex([jsonl]);
const roundTripAggregate = context.buildCodexAggregateObject(roundTrip, "2026-07-16");
for (const key of ["input_tokens", "cached_input_tokens", "noncached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"]) {
  assert.equal(roundTripAggregate.totals[key], aggregate.totals[key], `${key} must survive aggregate round trip`);
}

const lines = [];
let oversized = 0;
const collector = context.createBoundedLineCollector(lineValue => lines.push(lineValue), () => { oversized += 1; }, 10);
collector.push("one\r\ntw");
collector.push("o\nthis line is much too long");
collector.push("\nlast");
collector.finish();
assert.deepEqual(lines, ["one", "two", "last"]);
assert.equal(oversized, 1);

const oversizedPadding = "x".repeat(2 * 1024 * 1024);
const oversizedProjection = context.parseCodex([[
  line("2026-07-16T13:00:00Z", "session_meta", { id: "large-session" }),
  JSON.stringify({ padding_before: oversizedPadding, timestamp: "2026-07-16T13:00:01Z", type: "turn_context", payload: { model: "gpt-5.6-sol" } }),
  JSON.stringify({ timestamp: "2026-07-16T13:00:02Z", type: "response_item", payload: { content: `${PRIVATE} \\\"type\\\":\\\"token_count\\\" ${oversizedPadding}` } }),
  JSON.stringify({ timestamp: "2026-07-16T13:00:03Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage(1000, 200, 80, 20), last_token_usage: usage(1000, 200, 80, 20) } }, padding_after: oversizedPadding }),
].join("\n")]);
assert.equal(oversizedProjection.coverage.oversized_lines, 0, "large supported records and proven non-usage records must not be blindly dropped");
assert.equal(oversizedProjection.turns, 1);
assert.deepEqual({ ...oversizedProjection.by["gpt-5.6-sol"] }, { inp: 800, out: 80, cw: 0, cr: 200, reasoning: 20, turns: 1 });

function projectOversized(raw) {
  const projector = context.createCodexOversizedRecordProjector();
  projector.push(raw);
  return projector.finish();
}

const duplicatePayloadProjection = projectOversized('{"type":"turn_context","payload":{"model":"gpt-5.6-sol"},"payload":{}}');
assert.equal(duplicatePayloadProjection.status, "record");
assert.equal(Object.hasOwn(duplicatePayloadProjection.record.payload, "model"), false,
  "a later duplicate payload must supersede projected model descendants just as JSON.parse does");
const duplicateInfoProjection = projectOversized('{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":2,"reasoning_output_tokens":0,"total_tokens":12}},"info":{}}}');
assert.equal(duplicateInfoProjection.status, "unresolved",
  "a later duplicate info object must not retain counters from the superseded object");
assert.equal(projectOversized('{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1e309,"cached_input_tokens":0,"output_tokens":2,"reasoning_output_tokens":0,"total_tokens":2}}}}').status, "unresolved",
  "non-finite projected counters must fail closed");
assert.equal(projectOversized('{"type":"turn_context",\f"payload":{"model":"gpt-5.6-sol"}}').status, "unresolved",
  "the projector must reject whitespace that JSON itself rejects");
const numericSessionProjection = projectOversized('{"type":"session_meta","payload":{"id":12345}}');
assert.equal(numericSessionProjection.status, "record");
assert.equal(numericSessionProjection.record.payload.id, 12345,
  "oversized projection must preserve the numeric session IDs accepted by the ordinary parser");
const tooDeepProjection = projectOversized('{"padding":' + "[".repeat(129) + "0" + "]".repeat(129) + ',"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}');
assert.equal(tooDeepProjection.status, "unresolved",
  "deeply nested oversized records must stop at the structural depth bound");

const invalidCounterTypes = context.parseCodex([[
  line("2026-07-16T13:30:00Z", "turn_context", { model: "gpt-5.6-sol" }),
  token("2026-07-16T13:30:01Z", { ...usage(10, 0, 2, 0), cached_input_tokens: null, reasoning_output_tokens: "0" }),
].join("\n")]);
assert.equal(invalidCounterTypes.turns, 0,
  "null, booleans, and numeric strings must not be coerced into trusted Codex counters");
assert.equal(invalidCounterTypes.coverage.complete, false);

const missingTokenInfo = context.parseCodex([[
  line("2026-07-16T13:35:00Z", "turn_context", { model: "gpt-5.6-sol" }),
  line("2026-07-16T13:35:01Z", "event_msg", { type: "token_count" }),
].join("\n")]);
assert.equal(missingTokenInfo.turns, 0);
assert.equal(missingTokenInfo.coverage.complete, false,
  "a token_count record without an info object must make browser coverage incomplete");

const malformedContext = context.parseCodex([[
  line("2026-07-16T13:40:00Z", "turn_context", { model: "gpt-5.6-sol" }),
  token("2026-07-16T13:40:01Z", usage(10, 0, 2, 0)),
  '{"type":"turn_context","payload":{"model":',
  token("2026-07-16T13:40:02Z", usage(20, 0, 4, 0)),
].join("\n")]);
assert.equal(malformedContext.by["gpt-5.6-sol"].inp, 10);
assert.equal(malformedContext.by["Unknown Codex model"].inp, 10,
  "usage after a malformed possible model change must not inherit the prior model");
assert.equal(malformedContext.coverage.malformed_lines, 1);

const maximumUsage = usage(Number.MAX_SAFE_INTEGER, 0, 0, 0, Number.MAX_SAFE_INTEGER);
assert.throws(() => context.parseCodex([
  [line("2026-07-16T13:50:00Z", "turn_context", { model: "gpt-5.6-sol" }), token("2026-07-16T13:50:01Z", maximumUsage)].join("\n"),
  [line("2026-07-16T13:50:02Z", "turn_context", { model: "gpt-5.6-sol" }), token("2026-07-16T13:50:03Z", maximumUsage)].join("\n"),
]), /safe local reporting limit/i,
"aggregating individually safe Codex counters must fail before the browser total becomes unsafe");

const unresolvedAccumulator = context.createCodexAccumulator();
const unresolvedState = unresolvedAccumulator.beginFile(0);
const unresolvedCollector = context.createBoundedLineCollector(
  lineValue => unresolvedAccumulator.addLine(unresolvedState, lineValue),
  () => unresolvedAccumulator.noteOversized(unresolvedState),
  128,
  context.createCodexOversizedRecordProjector,
);
unresolvedCollector.push('{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1},"private":"');
unresolvedCollector.push("x".repeat(256));
unresolvedCollector.finish();
unresolvedAccumulator.endFile(unresolvedState, false);
const unresolvedOversized = unresolvedAccumulator.result();
assert.equal(unresolvedOversized.coverage.oversized_lines, 1, "malformed or incomplete oversized usage must remain fail-closed");
assert.equal(unresolvedOversized.coverage.complete, false);
assert.equal(unresolvedOversized.turns, 0);

const staleModelAccumulator = context.createCodexAccumulator();
const staleModelState = staleModelAccumulator.beginFile(0);
staleModelAccumulator.addLine(staleModelState, line("2026-07-16T14:00:00Z", "turn_context", { model: "gpt-5.6-sol" }));
staleModelAccumulator.addLine(staleModelState, token("2026-07-16T14:00:01Z", usage(10, 0, 2, 0)));
const staleModelCollector = context.createBoundedLineCollector(
  lineValue => staleModelAccumulator.addLine(staleModelState, lineValue),
  () => staleModelAccumulator.noteOversized(staleModelState),
  128,
  context.createCodexOversizedRecordProjector,
);
staleModelCollector.push(JSON.stringify({ type: "turn_context", payload: { model: "x".repeat(2048) }, padding: "x".repeat(256) }));
staleModelCollector.finish();
staleModelAccumulator.addLine(staleModelState, token("2026-07-16T14:00:02Z", usage(20, 0, 4, 0)));
staleModelAccumulator.endFile(staleModelState, false);
const staleModelResult = staleModelAccumulator.result();
assert.equal(staleModelResult.coverage.oversized_lines, 1);
assert.equal(staleModelResult.by["gpt-5.6-sol"].inp, 10);
assert.equal(staleModelResult.by["Unknown Codex model"].inp, 10,
  "usage after an unresolved model-changing record must not inherit the previous known model");

const hostile = context.parseCodex([[
  line("2026-07-16T12:00:00Z", "turn_context", { model: `<img src=x onerror=${PRIVATE}>` }),
  token("2026-07-16T12:00:01Z", usage(10, 2, 3, 1)),
].join("\n")]);
const hostileMarkdown = context.buildObsidianAIHistory(hostile, "2026-07-16");
assert.doesNotMatch(hostileMarkdown, /<img/i, "model labels must not become Markdown HTML");
const hostileAggregate = JSON.stringify(context.buildCodexAggregateObject(hostile, "2026-07-16"));
assert.doesNotMatch(hostileAggregate, new RegExp(PRIVATE, "i"),
  "unexpected model labels must not leak into the content-free aggregate");
assert.deepEqual(Object.keys(hostile.by), ["Unknown Codex model"]);

const prototypeHostile = context.parseCodex([[
  line("2026-07-16T12:00:00Z", "turn_context", { model: "__proto__" }),
  token("2026-07-16T12:00:01Z", usage(10, 2, 3, 1)),
  line("2026-07-16T12:00:02Z", "turn_context", { model: "constructor" }),
  token("2026-07-16T12:00:03Z", usage(15, 3, 5, 2), usage(5, 1, 2, 1)),
].join("\n")]);
assert.deepEqual(Object.keys(prototypeHostile.by), ["Unknown Codex model"]);
assert.equal(context.buildCodexAggregateObject(prototypeHostile, "2026-07-16").totals.total_tokens, 20);

const resetWithoutLast = context.parseCodex([[
  line("2026-07-16T12:00:00Z", "turn_context", { model: "gpt-5.6-sol" }),
  token("2026-07-16T12:00:01Z", usage(20, 4, 5, 1)),
  line("2026-07-16T12:00:02Z", "event_msg", { type: "token_count", info: { total_token_usage: usage(5, 1, 2, 1) } }),
].join("\n")]);
assert.equal(resetWithoutLast.turns, 1, "a reset without a last-usage fallback must not invent usage");
assert.equal(resetWithoutLast.coverage.counter_resets, 1);
assert.equal(resetWithoutLast.coverage.complete, false);

console.log("TOP Analyzer Codex parser and export regression tests passed");
