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
// Sources: Claude Code, Codex, the Cursor CSV export, and the Copilot usage report.
assert.equal((html.match(/data-pilot-source=/g) || []).length, 4);
assert.match(html, /data-pilot-source="cursor"/);
assert.match(html, /data-pilot-source="copilot"/);
assert.match(html, /id="pilotCursorFile" accept="\.csv"/);
assert.match(html, /id="pilotCopilotFile" accept="\.csv,\.json"/);
assert.equal((html.match(/data-pilot-method=/g) || []).length, 2);
assert.ok(html.indexOf('data-pilot-method="agent"') < html.indexOf('data-pilot-method="folder"'));
assert.match(html, /Choice 1 of 2/);
assert.match(html, /Choice 2 of 2/);
assert.match(html, /id="pilotBackToSource"/);
assert.match(html, /Complete this analysis on the computer that holds your Claude Code or Codex history/);
assert.match(html, /Using Claude Chat, ChatGPT, Claude Console, or Obsidian\?/);
assert.match(html, /href="\/analyze\/">Open the full analyzer<\/a>/);

// The pinned collector prompt is inspectable and locks the exact released file.
assert.match(html, /https:\/\/adamhartley7\.github\.io\/analyze\/collector\/top-collector\.mjs/);
assert.match(html, /EB3F69B6FD6C0B9FB78E85548EB0767037CBB2F30657FA4619A85782B38403BE/);
assert.match(html, /PILOT_COLLECTOR_VERSION="top\.local-collector\.2026-07-16\.2"/);
assert.match(html, /using the explicit option --schema v2/);
assert.match(html, /single top\.safe-usage\.v2 JSON output/);
assert.doesNotMatch(html, /COLLECTOR_(?:SHA256|VERSION)_PLACEHOLDER/);
assert.match(html, /Do not print, quote, summarize, copy or transmit any prompt/);
assert.match(html, /generated TOP filename without its full path/);
assert.doesNotMatch(html, /return only the verified output path/);
assert.match(html, /id="pilotSafeFile" accept="\.json,application\/json"/);
assert.doesNotMatch(html, /id="pilotSafeFile"[^>]*multiple/);
assert.match(html, /small, content-free aggregate file/);
assert.match(html, /create one content-free aggregate file/);

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
function validV2Envelope(surface = "claude_code") {
  const value = validEnvelope(surface);
  value.schema_version = "top.safe-usage.v2";
  value.collector_version = "top.local-collector.2026-07-16.2";
  value.parser_version = "top.usage-parser.2026-07-16.3";
  value.timeline = {
    status: "available", granularity: "calendar_month",
    timestamp_basis: "source_date_prefix_not_timezone_normalized",
    periods: [{
      period: "2026-07", input_tokens: 100, cache_write_input_tokens: 20,
      cache_read_input_tokens: 30, output_tokens: 50,
      reasoning_output_tokens: surface === "codex" ? 10 : 0,
      usage_records: 5, total_tokens: 200, active_days: 1,
      logical_sessions_started: 2,
    }],
  };
  value.session_distributions = {
    status: "available",
    session_definition: surface === "codex" ? "codex_rollout_file_proxy" : "deduplicated_logical_session",
    thresholds_version: "top.session-buckets.v1",
    elapsed_time_basis: "wall_clock_span_between_first_and_last_supported_usage_record",
    logical_sessions_analyzed: 2,
    usage_records_per_session: { zero: 0, one: 1, two_to_four: 1, five_to_nineteen: 0, twenty_plus: 0 },
    total_tokens_per_session: { under_10k: 2, ten_to_49k: 0, fifty_to_199k: 0, two_hundred_to_999k: 0, one_million_plus: 0 },
    elapsed_time_per_session: { under_10m: 1, ten_to_59m: 0, one_to_3h: 0, four_to_11h: 0, twelve_h_plus: 0, unknown: 1 },
  };
  value.workflow_shape = {
    status: "available", algorithm_version: "top.workflow-shape.v1",
    basis: "deduplicated_usage_record_count_only",
    sessions: { single_exchange: 1, short_multi_exchange: 1, sustained: 0, high_iteration: 0, unclassified: 0 },
  };
  return value;
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
assert.equal(claudeResult.pilotSafeSchemaVersion, "top.safe-usage.v1");
assert.equal(claudeResult.pilotV2Aggregate, null);

const claudeV2 = context.pilotValidateSafeUsage(validV2Envelope());
const claudeV2Result = context.pilotResultFromSafeUsage(claudeV2);
assert.equal(claudeV2Result.pilotSafeSchemaVersion, "top.safe-usage.v2");
assert.equal(claudeV2Result.pilotV2Aggregate.timeline.periods[0].period, "2026-07");
assert.equal(claudeV2Result.pilotV2Aggregate.workflow_shape.sessions.short_multi_exchange, 1);
assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(claudeV2Result.pilotV2Aggregate))).sort(), ["session_distributions", "timeline", "workflow_shape"]);
const earlyYearV2 = validV2Envelope();
earlyYearV2.timeline.periods[0].period = "0000-02";
assert.equal(context.pilotValidateSafeUsage(earlyYearV2).timeline.periods[0].period, "0000-02",
  "browser validation must match the collector's four-digit-year contract");

for (const [mutate, code] of [
  [value => { value.timeline.periods[0].prompt = "PRIVATE"; }, /unexpected_object_fields/],
  [value => { value.timeline.periods[0].input_tokens += 1; value.timeline.periods[0].total_tokens += 1; }, /timeline_total_mismatch/],
  [value => { value.timeline.periods[0].period = "2026-99"; }, /invalid_timeline_period/],
  [value => { value.session_distributions.usage_records_per_session.two_to_four = 0; value.session_distributions.usage_records_per_session.twenty_plus = 1; }, /bucket_range_mismatch/],
  [value => { value.workflow_shape.sessions.single_exchange = 0; value.workflow_shape.sessions.short_multi_exchange = 2; }, /workflow_shape_mismatch/],
]) {
  const value = validV2Envelope();
  mutate(value);
  assert.throws(() => context.pilotValidateSafeUsage(value), code);
}

context.PILOT_SOURCE = "codex";
const codex = context.pilotValidateSafeUsage(validEnvelope("codex"));
const codexResult = context.pilotResultFromSafeUsage(codex);
assert.equal(codexResult.codex, true);
assert.equal(codexResult.estimate, true);
assert.equal(codexResult.costLabel, "API-rate comparison");
assert.match(codexResult.estimateReason, /subscription limits and charges may differ/);
const codexV2 = context.pilotValidateSafeUsage(validV2Envelope("codex"));
const codexV2Result = context.pilotResultFromSafeUsage(codexV2);
assert.equal(codexV2Result.pilotSafeSchemaVersion, "top.safe-usage.v2");
assert.equal(codexV2Result.pilotV2Aggregate.session_distributions.session_definition, "codex_rollout_file_proxy");
assert.equal(codexV2Result.by["gpt-5.6-codex-mini"].reasoning, 10);
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

// The pilot adds no automatic delivery or browser persistence. The one fetch
// path is disabled by a blank endpoint and can run only from the Submit click.
assert.match(html, /connect-src 'none'/);
assert.equal((html.match(/\bfetch\s*\(/g) || []).length, 1);
assert.match(html, /var TOP_DELIVERY_ENDPOINT="";/);
for (const pattern of [/XMLHttpRequest/, /sendBeacon/, /\bWebSocket\s*\(/, /localStorage/, /indexedDB/]) {
  assert.equal(pattern.test(html), false, `forbidden network or persistence primitive: ${pattern}`);
}

console.log("TOP Analyzer guided pilot tests passed");
