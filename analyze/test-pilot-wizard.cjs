const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

// A stranger opening plain /analyze/ gets the guided route. Explicit direct-source
// links and ?full=1 remain deliberate escape hatches into the advanced analyzer.
assert.match(html, /new URLSearchParams\(window\.location\.search\)/);
assert.match(html, /if\(query\.get\("full"\)==="1"\|\|start==="chat"\|\|start==="openai"\)return/);
assert.match(html, /PILOT_MODE=true;document\.documentElement\.classList\.add\("pilot-mode"\);document\.getElementById\("pilotFlow"\)\.hidden=false/);
assert.match(html, /id="pilotFlow" hidden/);
assert.match(html, /class="resonance-step" id="resonanceStep"/);
assert.match(html, /\.pilot-mode #resonanceStep[^}]*#providerStep[^}]*#routechooser[^}]*#obsidianPanel/);

// One source decision, then the preparation panel for that source. Browser-chat
// exports have direct guided links, while local sources stay inside the two-step flow.
assert.equal((html.match(/data-pilot-source=/g) || []).length, 4);
assert.equal((html.match(/data-pilot-entry=/g) || []).length, 2);
assert.match(html, /data-pilot-entry="chat" href="\/analyze\/\?start=chat"/);
assert.match(html, /data-pilot-entry="openai" href="\/analyze\/\?start=openai"/);
assert.match(html, /data-pilot-source="cursor"/);
assert.match(html, /data-pilot-source="copilot"/);
assert.match(html, /id="pilotCursorFile" accept="\.csv"/);
assert.match(html, /id="pilotCopilotFile" accept="\.csv,\.json"/);
assert.match(html, /Step 1 of 2/);
assert.match(html, /Step 2 of 2/);

// Local Claude Code and Codex users get two explicit, separate methods. The
// recommended collector route is pinned and inspectable, and the folder picker is a
// fallback for machines without Node.js.
assert.equal((html.match(/data-pilot-method=/g) || []).length, 2);
assert.match(html, /data-pilot-method="agent"[^>]*><strong>Use my coding agent<\/strong>/);
assert.match(html, /data-pilot-method="folder"[^>]*><strong>Use the folder fallback<\/strong>/);
assert.match(html, /id="pilotAgentPanel" hidden/);
assert.match(html, /id="pilotAgentPrompt" readonly/);
assert.match(html, /id="pilotCopyAgentPrompt"/);
assert.match(html, /id="pilotSafeFile" accept="\.json"/);
assert.match(html, /function pilotChooseMethod\(method\)/);
assert.match(html, /pilotCopyAgentPrompt"\)\.addEventListener\("click"/);
assert.match(html, /id="pilotBackToSource"/);
assert.match(html, /Complete this analysis on the computer that holds your Claude Code or Codex history/);
assert.match(html, /Need Claude Console, Obsidian, or the manual controls\?/);
assert.match(html, /href="\/analyze\/\?full=1">Open the advanced analyzer<\/a>/);

// The pinned collector prompt is inspectable and locks the exact released file.
assert.match(html, /https:\/\/adamhartley7\.github\.io\/analyze\/collector\/top-collector\.mjs/);
assert.match(html, /328209D2C41624C325D7C11B1EBA6D9CCA28479B4B4459E44B9F6B2E16E917DC/);
assert.match(html, /PILOT_COLLECTOR_VERSION="top\.local-collector\.2026-07-20\.3"/);
assert.match(html, /--schema v2/);
assert.doesNotMatch(html, /COLLECTOR_(?:SHA256|VERSION)_PLACEHOLDER/);

// The prompt must be one an aligned agent can safely accept. A prompt that gags the
// agent, or tells it to withhold detail from its own user, reads as an injection
// attack and gets refused. It got refused in the field on 2026-07-17. So the prompt
// invites scrutiny instead of demanding compliance, and these assertions lock that in.
assert.match(html, /READ IT FIRST and tell me plainly what it does/);
assert.match(html, /Show me the full contents of the file it produced/);
assert.match(html, /Please tell me everything you observe, including anything that looks wrong/);
assert.match(html, /If you think this is a bad idea, say so and I will not run it/);
assert.match(html, /be skeptical/);
assert.doesNotMatch(html, /Do not print, quote, summarize/);
assert.doesNotMatch(html, /return only the generated TOP filename/);
assert.doesNotMatch(html, /without its full path/);
assert.match(html, /ONE small JSON of aggregate numbers/,
  "the collector prompt must describe exactly the aggregate file it creates");
assert.match(html, /stream complete local JSONL records/);
assert.match(html, /temporarily parse each record/);
assert.match(html, /run-private fingerprints in memory/);
assert.match(html, /exact timestamp metadata in encrypted temporary files only until aggregation finishes/);
assert.match(html, /temporary material should be deleted before the run completes/);
assert.match(html, /must not export my prompts/);
assert.match(html, /exact timestamps/);
assert.doesNotMatch(html, /read only token counters and date prefixes/);
assert.doesNotMatch(html, /read usage counters only|usage counters only|never the content of a session/i);

// Folder fallback exposes the exact paths. Copying an address and opening the picker
// are separate deliberate actions, so clipboard failure cannot block the picker.
assert.match(html, /%USERPROFILE%\\\.claude\\projects/);
assert.match(html, /%USERPROFILE%\\\\\.codex\\\\sessions/);
assert.match(html, /pilotCopyFolderPath"\)\.addEventListener\("click",function\(\)\{return copyPlainText\(document\.getElementById\("pilotFolderPath"\)\.textContent,this,"Folder Address Copied"\)\}\)/);
assert.match(html, /document\.getElementById\("pilotHistoryFolder"\)\.click\(\)/);
const copyFolderHandler = html.slice(
  html.indexOf('getElementById("pilotCopyFolderPath").addEventListener'),
  html.indexOf('getElementById("pilotChooseFolder").addEventListener')
);
assert.doesNotMatch(copyFolderHandler, /pilotHistoryFolder"\)\.click\(\)/,
  "copying the path must not also open the picker");
assert.match(html, /id="pilotHistoryFolder" webkitdirectory/);
assert.match(html, /Reading "\+files\.length\+" files on this device/);
assert.match(html, /No folder was chosen, or the picker was cancelled/);
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
    collector_version: "top.local-collector.2026-07-20.1",
    parser_version: "top.usage-parser.2026-07-20.1",
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
  value.collector_version = "top.local-collector.2026-07-20.2";
  value.parser_version = "top.usage-parser.2026-07-20.2";
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
assert.equal(context.pilotModel("codex-auto-review"), "codex-auto-review");
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

const outdatedV2 = validV2Envelope("codex");
outdatedV2.collector_version = "top.local-collector.2026-07-16.2";
outdatedV2.parser_version = "top.usage-parser.2026-07-16.3";
let outdatedError;
try { context.pilotValidateSafeUsage(outdatedV2); } catch (error) { outdatedError = error; }
assert.match(outdatedError?.message || "", /unsupported_safe_file_version/);
assert.match(context.pilotSafeFileErrorMessage(outdatedError), /collector or parser version this page does not accept/);
assert.match(context.pilotSafeFileErrorMessage(outdatedError), /Rerun the current pinned collector prompt/);

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
assert.equal(codexResult.estimate, false);
assert.equal(codexResult.costLabel, "Actual cost unavailable");
assert.match(codexResult.estimateReason, /plan allowance, credits charged or billed dollars/);
const codexV2 = context.pilotValidateSafeUsage(validV2Envelope("codex"));
const codexV2Result = context.pilotResultFromSafeUsage(codexV2);
assert.equal(codexV2Result.pilotSafeSchemaVersion, "top.safe-usage.v2");
assert.equal(codexV2Result.pilotV2Aggregate.session_distributions.session_definition, "codex_rollout_file_proxy");
assert.equal(codexV2Result.by["gpt-5.6-codex-mini"].reasoning, 10);
const codexAutoReviewV2 = validV2Envelope("codex");
codexAutoReviewV2.by_model[0].model = "codex-auto-review";
assert.equal(context.pilotValidateSafeUsage(codexAutoReviewV2).by_model[0].model, "codex-auto-review");
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
