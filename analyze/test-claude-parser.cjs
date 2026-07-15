const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const start = html.indexOf("function createClaudeCodeAccumulator");
const end = html.indexOf("function splitCSV", start);
assert.ok(start >= 0 && end > start, "could not locate Claude Code parser in analyze/index.html");

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

function line({
  messageId,
  requestId,
  sessionId = "session-1",
  timestamp = "2026-07-15T00:00:00Z",
  model = "claude-opus-4-8",
  input = 100,
  output = 10,
  cacheWrite = 5,
  cacheRead = 20,
} = {}) {
  const record = {
    type: "assistant",
    sessionId,
    timestamp,
    message: {
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheWrite,
        cache_read_input_tokens: cacheRead,
      },
    },
  };
  if (messageId !== undefined) record.message.id = messageId;
  if (requestId !== undefined) record.requestId = requestId;
  return JSON.stringify(record);
}

function modelRow(result, model = "claude-opus-4-8") {
  assert.ok(result.by[model], `missing aggregate for ${model}`);
  return result.by[model];
}

{
  const result = context.parseClaudeCode([[
    line({ messageId: "msg-1", requestId: "req-1", output: 10, cacheWrite: 3 }),
    line({ messageId: "msg-1", requestId: "req-1", output: 25, cacheWrite: 5 }),
    line({ messageId: "msg-1", requestId: "req-1", output: 18, cacheWrite: 4 }),
  ].join("\n")]);
  assert.equal(result.turns, 1, "repeated content blocks must count as one call");
  assert.deepEqual(
    { ...modelRow(result) },
    { inp: 100, out: 25, cw: 5, cr: 20, turns: 1 },
    "a repeated call must use the maximum of each usage field",
  );
}

{
  const original = line({ messageId: "msg-resumed", requestId: "req-resumed", output: 31 });
  const copied = line({
    messageId: "msg-resumed",
    requestId: "req-resumed",
    sessionId: "session-2",
    timestamp: "2026-07-16T00:00:00Z",
    output: 31,
  });
  const result = context.parseClaudeCode([original, copied]);
  assert.equal(result.turns, 1, "a resumed copy in another file must not be billed twice");
  assert.equal(modelRow(result).out, 31);
}

{
  const result = context.parseClaudeCode([[
    line({ messageId: "msg-same", requestId: "req-a" }),
    line({ messageId: "msg-same", requestId: "req-b" }),
    line({ messageId: "msg-other", requestId: "req-b" }),
  ].join("\n")]);
  assert.equal(result.turns, 3, "different message/request identity pairs are distinct calls");
  assert.equal(modelRow(result).turns, 3);
}

{
  const result = context.parseClaudeCode([[line(), line()].join("\n"), line()]);
  assert.equal(result.turns, 3, "records with no stable IDs need collision-safe per-line identities");
  assert.equal(modelRow(result).turns, 3);
}

{
  const result = context.parseClaudeCode([[
    line({ messageId: "msg-only", output: 8 }),
    line({ messageId: "msg-only", output: 13 }),
    line({ requestId: "req-only", output: 7 }),
    line({ requestId: "req-only", output: 11 }),
  ].join("\n")]);
  assert.equal(result.turns, 2, "either stable ID can deduplicate when its partner is absent");
  assert.equal(modelRow(result).out, 24);
}

{
  const result = context.parseClaudeCode([[
    line({ messageId: "msg-zero", requestId: "req-zero", input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }),
    line({ messageId: "msg-real", requestId: "req-real", output: 9 }),
  ].join("\n")]);
  assert.equal(result.turns, 1, "zero-token bookkeeping records must not count as billable turns");
  assert.equal(modelRow(result).out, 9);
}

console.log("TOP Analyzer Claude parser regression tests passed");
