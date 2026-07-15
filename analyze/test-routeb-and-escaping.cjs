const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const context = { costOf: () => 0 };
vm.createContext(context);

function loadFunction(name, nextMarker) {
  const start = html.indexOf(`function ${name}`);
  const end = html.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, `could not locate ${name}`);
  vm.runInContext(html.slice(start, end), context);
}

loadFunction("esc", "// ---- model tiering");
loadFunction("parseStripped", "function renderB");

assert.equal(
  context.esc('<img src=x onerror="globalThis.pwned=1">'),
  "&lt;img src=x onerror=&quot;globalThis.pwned=1&quot;&gt;",
  "imported labels must be escaped before entering table HTML",
);

function stripped({
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
  return JSON.stringify({
    message_id: messageId,
    requestId,
    sessionId,
    timestamp,
    permissionMode: "bypassPermissions",
    model,
    usage: {
      input_tokens: input,
      output_tokens: output,
      cache_creation_input_tokens: cacheWrite,
      cache_read_input_tokens: cacheRead,
    },
  });
}

const result = context.parseStripped([[
  stripped({ messageId: "msg-1", requestId: "req-1", output: 10 }),
  stripped({ messageId: "msg-1", requestId: "req-1", output: 25 }),
  stripped({ messageId: "msg-2", requestId: "req-2", output: 7 }),
].join("\n")]);

assert.equal(result.turns, 2, "Route B must deduplicate repeated call records");
assert.equal(result.by["claude-opus-4-8"].out, 32, "Route B must retain max counters for each unique call");
assert.equal(result.sess["session-1"].turns, 2, "session totals must use unique calls");

console.log("TOP Analyzer Route B and escaping regression tests passed");
