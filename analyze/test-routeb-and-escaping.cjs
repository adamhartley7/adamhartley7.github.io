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
loadFunction("csvEsc", "function buildBSessionRows");
loadFunction("buildBSessionRows", "function buildBCSV");
loadFunction("buildBCSV", "function buildBJSON");
loadFunction("buildBJSON", "function dlFile");

assert.equal(
  context.esc('<img src=x onerror="globalThis.pwned=1">'),
  "&lt;img src=x onerror=&quot;globalThis.pwned=1&quot;&gt;",
  "imported labels must be escaped before entering table HTML",
);

function stripped({
  messageId,
  requestId,
  sessionId = "RAW-SESSION-SECRET",
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
  stripped({ messageId: "RAW-MESSAGE-1", requestId: "RAW-REQUEST-1", output: 10 }),
  stripped({ messageId: "RAW-MESSAGE-1", requestId: "RAW-REQUEST-1", output: 25 }),
  stripped({ messageId: "RAW-MESSAGE-2", requestId: "RAW-REQUEST-2", output: 7 }),
].join("\n")]);

assert.equal(result.turns, 2, "Route B must deduplicate repeated call records");
assert.equal(result.by["claude-opus-4-8"].out, 32, "Route B must retain max counters for each unique call");
assert.equal(Object.values(result.sess)[0].turns, 2, "session totals must use unique calls");

const usage = result.by["claude-opus-4-8"];
context.ROUTEB = {
  res: result,
  rows: [{ model: "claude-opus-4-8", e: usage, cost: 0 }],
  totInp: usage.inp,
  totOut: usage.out,
  totCw: usage.cw,
  totCr: usage.cr,
  totTok: usage.inp + usage.out + usage.cw + usage.cr,
  totCost: 0,
  costAvailable: true,
};

const csv = context.buildBCSV();
const json = context.buildBJSON();
for (const raw of ["RAW-SESSION-SECRET", "RAW-MESSAGE-1", "RAW-MESSAGE-2", "RAW-REQUEST-1", "RAW-REQUEST-2"]) {
  assert.doesNotMatch(csv, new RegExp(raw), "CSV must not export raw identifiers");
  assert.doesNotMatch(json, new RegExp(raw), "JSON and the common safe copy must not export raw identifiers");
}
assert.match(csv, /^session_number,/);
assert.doesNotMatch(csv, /session_id/);
const parsed = JSON.parse(json);
assert.equal(parsed.sessions[0].session_number, 1);
assert.equal("session_id" in parsed.sessions[0], false);

Object.values(result.sess)[0].costAvailable = false;
context.ROUTEB = {
  ...context.ROUTEB,
  rows: [{ model: "future-model-with-no-checked-rate", e: usage, cost: null }],
  costAvailable: false,
};
const unpricedJson = JSON.parse(context.buildBJSON());
const unpricedCsv = context.buildBCSV();
assert.equal(unpricedJson.totals.est_cost_usd, null,
  "an unrecognized model must not turn into a zero-dollar total");
assert.equal(unpricedJson.by_model[0].est_cost_usd, null);
assert.equal(unpricedJson.sessions[0].est_cost_usd, null);
assert.match(unpricedCsv, /,[^,]*,$/m,
  "an unrecognized session price must be blank in the CSV instead of zero");

const scriptStart = html.indexOf('<textarea id="scripttext"');
const scriptBodyStart = html.indexOf(">", scriptStart) + 1;
const scriptEnd = html.indexOf("</textarea>", scriptBodyStart);
const script = html.slice(scriptBodyStart, scriptEnd);
const keepTop = script.slice(script.indexOf("KEEP_TOP"), script.indexOf("KEEP_USAGE"));
assert.doesNotMatch(keepTop, /sessionId|requestId|uuid|message_id/,
  "the stripped file allowlist must exclude raw identifiers");
assert.doesNotMatch(script, /out\["message_id"\]/,
  "the privacy script must never write raw message IDs");
assert.match(script, /out\["session_number"\] = session_number/);
assert.match(script, /Raw IDs are used only in memory/);

console.log("TOP Analyzer Route B and escaping regression tests passed");
