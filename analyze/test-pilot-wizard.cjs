const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

// The pilot is an explicit deep link. The ordinary analyzer remains available.
assert.match(html, /new URLSearchParams\(window\.location\.search\)/);
assert.match(html, /query\.get\("pilot"\)!=="1"/);
assert.match(html, /id="pilotFlow" hidden/);
assert.match(html, /class="resonance-step" id="resonanceStep"/);
assert.match(html, /\.pilot-mode #resonanceStep[^}]*#providerStep[^}]*#routechooser[^}]*#obsidianPanel/);

// Two decisions only, with the AI-assisted route first and folder escape second.
assert.equal((html.match(/data-pilot-source=/g) || []).length, 2);
assert.equal((html.match(/data-pilot-method=/g) || []).length, 2);
assert.ok(html.indexOf('data-pilot-method="agent"') < html.indexOf('data-pilot-method="folder"'));
assert.match(html, /Choice 1 of 2/);
assert.match(html, /Choice 2 of 2/);
assert.match(html, /id="pilotBackToSource"/);
assert.match(html, /Complete this analysis on the computer that holds your Claude Code or Codex history/);

// The pinned collector prompt is inspectable and locks the exact released file.
assert.match(html, /https:\/\/adamhartley7\.github\.io\/analyze\/collector\/top-collector\.mjs/);
assert.match(html, /36A1FEE0205B6676974559DD34C0E9D1527CA4807B4056689F4DEFD7F70EB304/);
assert.match(html, /PILOT_COLLECTOR_VERSION="top\.local-collector\.2026-07-16\.1"/);
assert.doesNotMatch(html, /COLLECTOR_(?:SHA256|VERSION)_PLACEHOLDER/);
assert.match(html, /Do not print, quote, summarize, copy or transmit any prompt/);
assert.match(html, /generated TOP filename without its full path/);
assert.doesNotMatch(html, /return only the verified output path/);
assert.match(html, /id="pilotSafeFile" accept="\.json,application\/json"/);
assert.doesNotMatch(html, /id="pilotSafeFile"[^>]*multiple/);

// Folder fallback preselects a source, exposes the exact paths, copies, then opens
// the existing read-only folder input from the same deliberate button action.
assert.match(html, /%USERPROFILE%\\\.claude\\projects/);
assert.match(html, /%USERPROFILE%\\\\\.codex\\\\sessions/);
assert.match(html, /copyPlainText\(path,this,"Address Copied"\)/);
assert.match(html, /document\.getElementById\("historyFolder"\)\.click\(\)/);
assert.match(html, /data\.pilotSafe\?"Safe format verified\./);
assert.match(html, /Local folder read completed\. TOP used the supported usage counters/);

// Strict collector-envelope validator.
const validationStart = html.indexOf("var PILOT_MODE=");
const validationEnd = html.indexOf("function pilotPromptFor", validationStart);
assert.ok(validationStart >= 0 && validationEnd > validationStart, "pilot validator not found");
const context = { Number, Object, Array, String, RegExp, Math, JSON };
vm.createContext(context);
vm.runInContext(html.slice(validationStart, validationEnd), context);

function validEnvelope(surface = "claude_code") {
  const isCodex = surface === "codex";
  const model = isCodex ? "gpt-5.6-codex-mini" : "claude-opus-4-8";
  return {
    schema_version: "top.safe-usage.v1",
    collector_version: "top.local-collector.2026-07-16.1",
    parser_version: "top.usage-parser.2026-07-16.2",
    generated_date: "2026-07-16",
    source: { provider: isCodex ? "openai" : "anthropic", surface },
    coverage: {
      files_discovered: 4, files_parsed: 4, files_with_usage: 3,
      files_skipped: 0, malformed_lines: 0, oversized_lines: 0,
      counter_resets: 0, duplicate_usage_records: 2, complete: true,
    },
    totals: {
      input_tokens: 100, cache_write_input_tokens: 20,
      cache_read_input_tokens: 30, output_tokens: 50,
      reasoning_output_tokens: isCodex ? 10 : 0, total_tokens: 200,
      usage_records: 5,
    },
    activity: { sessions: 2, active_days: 1 },
    by_model: [{
      model, input_tokens: 100, cache_write_input_tokens: 20,
      cache_read_input_tokens: 30, output_tokens: 50,
      reasoning_output_tokens: isCodex ? 10 : 0, total_tokens: 200,
      usage_records: 5,
    }],
  };
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function rejects(mutator, code) {
  const value = validEnvelope();
  mutator(value);
  assert.throws(() => context.pilotValidateSafeUsage(value), code);
}

context.PILOT_SOURCE = "cc";
assert.equal(context.pilotModel("gpt-5.6-codex-mini"), "gpt-5.6-codex-mini");
const claude = context.pilotValidateSafeUsage(validEnvelope());
assert.equal(claude.source.surface, "claude_code");
const claudeResult = context.pilotResultFromSafeUsage(claude);
assert.equal(claudeResult.turns, 5);
assert.equal(claudeResult.by["claude-opus-4-8"].cr, 30);
assert.equal(claudeResult.pilotCoverage.complete, true);
assert.equal(claudeResult.estimate, true);
assert.match(claudeResult.estimateReason, /subscription charges may differ/);

context.PILOT_SOURCE = "codex";
const codex = context.pilotValidateSafeUsage(validEnvelope("codex"));
const codexResult = context.pilotResultFromSafeUsage(codex);
assert.equal(codexResult.codex, true);
assert.equal(codexResult.estimate, true);
assert.equal(codexResult.costLabel, "API-rate comparison");
assert.match(codexResult.estimateReason, /subscription limits and charges may differ/);
context.PILOT_SOURCE = "cc";

rejects(value => { value.prompt = "PRIVATE PROMPT"; }, /unexpected_object_fields/);
rejects(value => { value.source.path = "C:\\Users\\Adam\\Secret"; }, /unexpected_object_fields/);
rejects(value => { value.by_model[0].filename = "private-project.jsonl"; }, /unexpected_object_fields/);
rejects(value => { value.by_model[0].model = "claude-opus-4-8-private-client"; }, /invalid_model_label/);
rejects(value => { value.by_model[0].input_tokens = -1; }, /invalid_count/);
rejects(value => { value.by_model[0].total_tokens = 201; }, /invalid_model_math/);
rejects(value => { value.totals.total_tokens = 201; }, /invalid_total_math/);
rejects(value => { value.totals.input_tokens = 99; value.totals.total_tokens = 199; }, /model_total_mismatch/);
rejects(value => { value.coverage.files_skipped = 1; value.coverage.files_parsed = 3; }, /invalid_complete_claim/);
rejects(value => { value.source = { provider: "openai", surface: "claude_code" }; }, /source_mismatch/);
rejects(value => { value.collector_version = "latest"; }, /unsupported_safe_file_version/);
rejects(value => { value.by_model.push(clone(value.by_model[0])); }, /models_not_sorted_unique/);

// Complete aggregate sharing uses the local device share sheet only when file
// sharing is supported. Otherwise the exact JSON downloads locally.
assert.match(html, /new File\(\[json\],name,\{type:"application\/json"\}\)/);
assert.match(html, /navigator\.canShare\(\{files:\[payload\.file\]\}\)/);
assert.match(html, /navigator\.share\(\{files:\[payload\.file\]/);
assert.match(html, /cannot share a file directly, so the research-safe JSON was downloaded instead/);
assert.match(html, /TOP cannot confirm where the file went or whether it was delivered/);
assert.match(html, /Nothing was submitted by TOP/);

// The pilot adds no automatic delivery or browser persistence.
assert.match(html, /connect-src 'none'/);
for (const pattern of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /\bWebSocket\s*\(/, /localStorage/, /indexedDB/]) {
  assert.equal(pattern.test(html), false, `forbidden network or persistence primitive: ${pattern}`);
}

console.log("TOP Analyzer guided pilot tests passed");
