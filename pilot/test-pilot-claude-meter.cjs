const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Meter = require("./pilot-claude-meter.js");

const SNAPSHOT_KEYS = ["schema_version", "pricing_version", "call_count", "totals", "by_model"];
const TOTAL_KEYS = ["input_tokens", "output_tokens", "cache_write_tokens", "cache_read_tokens", "total_tokens"];
const MODEL_KEYS = ["model", "call_count", "input_tokens", "output_tokens", "cache_write_tokens", "cache_read_tokens", "total_tokens"];
const DELTA_KEYS = ["schema_version", "pricing_version", "actual_usd", "call_count", "totals", "by_model"];
const DELTA_MODEL_KEYS = ["model", "call_count", "input_tokens", "output_tokens", "cache_write_tokens", "cache_read_tokens", "total_tokens", "actual_usd"];

function usageLine({
  messageId = "msg-1",
  requestId = "req-1",
  model = "claude-opus-4-8",
  input = 0,
  output = 0,
  cacheWrite = 0,
  cacheRead = 0,
  content = "PRIVATE PROMPT AND REPLY",
  extra = {}
} = {}) {
  const record = {
    type: "assistant",
    message: {
      id: messageId,
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheWrite,
        cache_read_input_tokens: cacheRead
      },
      content
    },
    requestId,
    cwd: "C:\\private\\client-project",
    sessionId: "private-session-id",
    toolUseResult: "PRIVATE TOOL OUTPUT",
    ...extra
  };
  if (messageId === undefined) delete record.message.id;
  if (requestId === undefined) delete record.requestId;
  return JSON.stringify(record);
}

function fails(fn, code) {
  assert.throws(fn, error => error instanceof Error && error.message === code, code);
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function assertDeepPrivacy(value) {
  const forbiddenKeys = new Set([
    "id", "message_id", "request_id", "path", "file", "filename", "text", "content",
    "prompt", "reply", "code", "timestamp", "session", "session_id", "project", "cwd"
  ]);
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, `forbidden output key: ${key}`);
      walk(child);
    }
  })(value);
}

assert.equal(Meter.PRICING_VERSION, "top-forecast-prices-2026-07-06-v1");
assert.deepEqual(Object.keys(Meter), ["PRICING_VERSION", "scanClaudeUsage", "measureDelta"]);

const empty = Meter.scanClaudeUsage(["\n", "  \r\n"]);
assert.deepEqual(Object.keys(empty), SNAPSHOT_KEYS);
assert.deepEqual(Object.keys(empty.totals), TOTAL_KEYS);
assert.deepEqual(empty.totals, {
  input_tokens: 0,
  output_tokens: 0,
  cache_write_tokens: 0,
  cache_read_tokens: 0,
  total_tokens: 0
});
assert.equal(empty.call_count, 0);
assert.deepEqual(empty.by_model, []);
assert.ok(Object.isFrozen(empty) && Object.isFrozen(empty.totals) && Object.isFrozen(empty.by_model));

const emptyWithZeroAssistant = Meter.scanClaudeUsage([
  usageLine({ messageId: null, requestId: null, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })
]);
assert.deepEqual(emptyWithZeroAssistant, empty, "all-zero assistant usage is not a metered call and needs no dedup key");

// Only assistant usage rows count. Private fields are never inspected or returned.
const ignoredUser = JSON.stringify({
  type: "user",
  message: {
    id: "user-private-id",
    model: "claude-opus-4-8",
    usage: { input_tokens: -500 },
    content: "PRIVATE USER PROMPT"
  }
});
const first = Meter.scanClaudeUsage([
  ignoredUser + "\n" + usageLine({ input: 100, output: 20, cacheWrite: 30, cacheRead: 40 })
]);
assert.deepEqual(Object.keys(first), SNAPSHOT_KEYS);
assert.deepEqual(Object.keys(first.by_model[0]), MODEL_KEYS);
assert.deepEqual(first.by_model, [{
  model: "claude-opus-4-8",
  call_count: 1,
  input_tokens: 100,
  output_tokens: 20,
  cache_write_tokens: 30,
  cache_read_tokens: 40,
  total_tokens: 190
}]);
assert.deepEqual(first.totals, {
  input_tokens: 100,
  output_tokens: 20,
  cache_write_tokens: 30,
  cache_read_tokens: 40,
  total_tokens: 190
});
const serializedFirst = JSON.stringify(first);
for (const secret of ["PRIVATE", "client-project", "session-id", "msg-1", "req-1"]) {
  assert.equal(serializedFirst.includes(secret), false, `snapshot leaked ${secret}`);
}
assertDeepPrivacy(first);

// Repeated updates are one logical call. Each usage field takes its maximum.
const deduped = Meter.scanClaudeUsage([
  [
    usageLine({ messageId: "m-a", requestId: null, input: 100, output: 2, cacheWrite: 50, cacheRead: 1 }),
    usageLine({ messageId: "m-a", requestId: "r-a", input: 5, output: 30, cacheWrite: 3, cacheRead: 80 }),
    usageLine({ messageId: null, requestId: "r-a", input: 70, output: 20, cacheWrite: 60, cacheRead: 40 })
  ].join("\n")
]);
assert.equal(deduped.call_count, 1);
assert.deepEqual(deduped.by_model[0], {
  model: "claude-opus-4-8",
  call_count: 1,
  input_tokens: 100,
  output_tokens: 30,
  cache_write_tokens: 60,
  cache_read_tokens: 80,
  total_tokens: 270
});
const sameMessageDifferentRequests = Meter.scanClaudeUsage([[
  usageLine({ messageId: "stable-message", requestId: "request-one", input: 10, output: 1 }),
  usageLine({ messageId: "stable-message", requestId: "request-two", input: 5, output: 20 })
].join("\n")]);
assert.equal(sameMessageDifferentRequests.call_count, 1);
assert.equal(sameMessageDifferentRequests.totals.input_tokens, 10);
assert.equal(sameMessageDifferentRequests.totals.output_tokens, 20);

// Exact aliases are canonicalized, models are sorted, and totals stay content-free.
const models = Meter.scanClaudeUsage([[
  usageLine({ messageId: "m-z", requestId: "r-z", model: "claude-sonnet-5", input: 10 }),
  usageLine({ messageId: "m-h", requestId: "r-h", model: "claude-haiku-4-5-20251001", output: 7 }),
  usageLine({ messageId: "m-o", requestId: "r-o", model: "claude-opus-4-8", cacheRead: 9 })
].join("\n")]);
assert.deepEqual(models.by_model.map(row => row.model), ["claude-haiku-4-5", "claude-opus-4-8", "claude-sonnet-5"]);

// An unrecognized label is reduced to a safe sentinel. Its raw value cannot leak.
const unpricedBefore = Meter.scanClaudeUsage([
  usageLine({ messageId: "m-u", requestId: "r-u", model: "C:\\secret\\deepseek-v4-pro", input: 5 })
]);
assert.equal(unpricedBefore.by_model[0].model, "unpriced");
assert.equal(JSON.stringify(unpricedBefore).includes("secret"), false);
const exactLookalikes = Meter.scanClaudeUsage([[
  usageLine({ messageId: "look-1", requestId: "look-r1", model: "claude-opus-4-8-private", input: 1 }),
  usageLine({ messageId: "look-2", requestId: "look-r2", model: "CLAUDE-OPUS-4-8", input: 1 }),
  usageLine({ messageId: "look-3", requestId: "look-r3", model: "prefix/claude-opus-4-8", input: 1 })
].join("\n")]);
assert.deepEqual(exactLookalikes.by_model, [{
  model: "unpriced",
  call_count: 3,
  input_tokens: 3,
  output_tokens: 0,
  cache_write_tokens: 0,
  cache_read_tokens: 0,
  total_tokens: 3
}]);

// The immutable snapshot locks every allowed model to the frozen forecast rates.
const lockedRates = [
  ["claude-opus-4-8", "claude-opus-4-8", 36.75],
  ["claude-fable-5", "claude-fable-5", 73.5],
  ["claude-sonnet-5", "claude-sonnet-5", 22.05],
  ["claude-sonnet-4-6", "claude-sonnet-4-6", 22.05],
  ["claude-haiku-4-5", "claude-haiku-4-5", 7.35],
  ["claude-haiku-4-5-20251001", "claude-haiku-4-5", 7.35]
];
for (const [rawModel, canonicalModel, expectedUsd] of lockedRates) {
  const pricedAfter = Meter.scanClaudeUsage([usageLine({
    messageId: `price-${rawModel}`,
    requestId: `price-request-${rawModel}`,
    model: rawModel,
    input: 1000000,
    output: 1000000,
    cacheWrite: 1000000,
    cacheRead: 1000000
  })]);
  const pricedDelta = Meter.measureDelta(empty, pricedAfter);
  assert.equal(pricedDelta.by_model[0].model, canonicalModel);
  assert.equal(pricedDelta.actual_usd, expectedUsd);
}

// A normal before/after measurement returns fixed keys, sorted rows, and exact API-rate math.
const before = Meter.scanClaudeUsage([[
  usageLine({ messageId: "old", requestId: "old-r", model: "claude-opus-4-8", input: 100, output: 20 }),
  usageLine({ messageId: "u-old", requestId: "u-old-r", model: "deepseek-v4-pro", input: 99 })
].join("\n")]);
const after = Meter.scanClaudeUsage([[
  usageLine({ messageId: "old", requestId: "old-r", model: "claude-opus-4-8", input: 100, output: 20 }),
  usageLine({ messageId: "u-old", requestId: "u-old-r", model: "deepseek-v4-pro", input: 99 }),
  usageLine({ messageId: "new-s", requestId: "new-s-r", model: "claude-sonnet-5", input: 1000000, output: 1000000, cacheWrite: 1000000, cacheRead: 1000000 }),
  usageLine({ messageId: "new-o", requestId: "new-o-r", model: "claude-opus-4-8", input: 1000000, output: 1000000, cacheWrite: 1000000, cacheRead: 1000000 })
].join("\n")]);
const delta = Meter.measureDelta(clone(before), clone(after));
assert.deepEqual(Object.keys(delta), DELTA_KEYS);
assert.deepEqual(Object.keys(delta.totals), TOTAL_KEYS);
assert.deepEqual(delta.by_model.map(row => row.model), ["claude-opus-4-8", "claude-sonnet-5"]);
assert.deepEqual(Object.keys(delta.by_model[0]), DELTA_MODEL_KEYS);
assert.equal(delta.call_count, 2);
assert.deepEqual(delta.totals, {
  input_tokens: 2000000,
  output_tokens: 2000000,
  cache_write_tokens: 2000000,
  cache_read_tokens: 2000000,
  total_tokens: 8000000
});
assert.equal(delta.by_model[0].actual_usd, 36.75);
assert.equal(delta.by_model[1].actual_usd, 22.05);
assert.equal(delta.actual_usd, 58.8);
assert.ok(Object.isFrozen(delta) && Object.isFrozen(delta.by_model[0]));
const serializedDelta = JSON.stringify(delta);
for (const secret of ["old-r", "new-s", "deepseek", "PRIVATE", "\\secret\\"]) {
  assert.equal(serializedDelta.includes(secret), false, `delta leaked ${secret}`);
}
assertDeepPrivacy(delta);

// Same-call max counters can grow after the before snapshot without a new call.
const partialBefore = Meter.scanClaudeUsage([
  usageLine({ messageId: "stream", requestId: "stream-r", model: "claude-sonnet-4-6", input: 100, output: 5 })
]);
const partialAfter = Meter.scanClaudeUsage([
  usageLine({ messageId: "stream", requestId: "stream-r", model: "claude-sonnet-4-6", input: 100, output: 25 })
]);
const streamedDelta = Meter.measureDelta(partialBefore, partialAfter);
assert.equal(streamedDelta.call_count, 0);
assert.equal(streamedDelta.totals.output_tokens, 20);
assert.equal(streamedDelta.actual_usd, 0.0003);

// Scanning fails closed instead of silently undercounting malformed or ambiguous data.
fails(() => Meter.scanClaudeUsage("not-an-array"), "invalid_text_collection");
fails(() => Meter.scanClaudeUsage([{}]), "invalid_jsonl_text");
fails(() => Meter.scanClaudeUsage(["{not-json}"]), "malformed_jsonl");
fails(() => Meter.scanClaudeUsage([usageLine({ messageId: null, requestId: null, input: 1 })]), "missing_dedup_key");
fails(() => Meter.scanClaudeUsage([usageLine({ messageId: " bad ", input: 1 })]), "invalid_dedup_key");
fails(() => Meter.scanClaudeUsage([usageLine({ input: -1 })]), "invalid_token_count");
fails(() => Meter.scanClaudeUsage([usageLine({ input: 1.5 })]), "invalid_token_count");
fails(() => Meter.scanClaudeUsage([usageLine({ input: "1" })]), "invalid_token_count");
fails(() => Meter.scanClaudeUsage([usageLine({ input: Number.MAX_SAFE_INTEGER + 1 })]), "invalid_token_count");
fails(() => Meter.scanClaudeUsage([usageLine({ input: 1 }).replace('"input_tokens":1', '"input_tokens":1e400')]), "invalid_token_count");
fails(() => Meter.scanClaudeUsage([[
  usageLine({ messageId: "m-1", requestId: "r-shared", model: "claude-opus-4-8", input: 1 }),
  usageLine({ messageId: "m-2", requestId: "r-2", model: "claude-opus-4-8", input: 1 }),
  usageLine({ messageId: "m-2", requestId: "r-shared", model: "claude-opus-4-8", input: 1 })
].join("\n")]), "dedup_key_collision");
fails(() => Meter.scanClaudeUsage([[
  usageLine({ messageId: "m-conflict", requestId: "r-conflict", model: "claude-opus-4-8", input: 1 }),
  usageLine({ messageId: "m-conflict", requestId: "r-conflict", model: "claude-sonnet-5", input: 1 })
].join("\n")]), "dedup_model_conflict");

// Measurement fails closed on no work, changed scope, unpriced work, or tampered/partial snapshots.
fails(() => Meter.measureDelta(before, clone(before)), "zero_delta");
fails(() => Meter.measureDelta(after, before), "negative_scope_delta");
const unpricedAfter = Meter.scanClaudeUsage([[
  usageLine({ messageId: "m-u", requestId: "r-u", model: "C:\\secret\\deepseek-v4-pro", input: 5 }),
  usageLine({ messageId: "m-u2", requestId: "r-u2", model: "another-private-model", output: 1 })
].join("\n")]);
fails(() => Meter.measureDelta(unpricedBefore, unpricedAfter), "unpriced_positive_delta");
const partialPricingAfter = Meter.scanClaudeUsage([[
  usageLine({ messageId: "known", requestId: "known-r", model: "claude-opus-4-8", input: 10 }),
  usageLine({ messageId: "unknown", requestId: "unknown-r", model: "private-model", input: 10 })
].join("\n")]);
fails(() => Meter.measureDelta(empty, partialPricingAfter), "unpriced_positive_delta");

const extraKey = clone(before);
extraKey.private_path = "C:\\private";
fails(() => Meter.measureDelta(extraKey, after), "invalid_snapshot_shape");
const wrongPricing = clone(before);
wrongPricing.pricing_version = "latest";
fails(() => Meter.measureDelta(wrongPricing, after), "pricing_version_mismatch");
const brokenTotals = clone(before);
brokenTotals.totals.total_tokens += 1;
fails(() => Meter.measureDelta(brokenTotals, after), "snapshot_total_mismatch");
const unsorted = clone(models);
unsorted.by_model.reverse();
fails(() => Meter.measureDelta(unsorted, after), "unsorted_snapshot_models");

// Browser and CommonJS surfaces expose the same narrow API without network primitives.
const source = fs.readFileSync(path.join(__dirname, "pilot-claude-meter.js"), "utf8");
for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "navigator.", "localStorage", "sessionStorage"]) {
  assert.equal(source.includes(forbidden), false, `meter must not contain ${forbidden}`);
}
const browserContext = { globalThis: {} };
vm.createContext(browserContext);
vm.runInContext(source, browserContext);
assert.deepEqual(Object.keys(browserContext.globalThis.PilotClaudeMeter), ["PRICING_VERSION", "scanClaudeUsage", "measureDelta"]);
assert.equal(browserContext.globalThis.PilotClaudeMeter.PRICING_VERSION, Meter.PRICING_VERSION);

console.log("TOP prospective-pilot Claude meter tests passed");
