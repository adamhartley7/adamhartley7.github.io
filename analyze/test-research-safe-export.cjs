const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

assert.match(html, /id="downloadResearchJSON">Download Complete Research-Safe JSON/);
assert.match(html, /inspect the exact JSON below/);
assert.match(html, /scenario only when the report qualifies/);
assert.match(html, /Nothing is sent until you deliberately use a sharing action\./);
assert.match(html, /res\.valueModelEligible=false/,
  "the cleaned Claude route must not export a scenario that is not visibly shown");
assert.doesNotMatch(html, /var PRICING_EDITED=false/,
  "pricing provenance must be tracked per exact family and field");

const pricingStart = html.indexOf('var PRICING_CHECKED=');
const pricingEnd = html.indexOf('var VM=', pricingStart);
const researchStart = html.indexOf('var RESEARCH_SCHEMA_VERSION=');
const researchEnd = html.indexOf('document.getElementById("downloadResearchJSON")', researchStart);
const routeBStart = html.indexOf('// ---------- Route B:', researchEnd);
assert.ok(pricingStart >= 0 && pricingEnd > pricingStart, "pricing helpers not found");
assert.ok(researchStart >= 0 && researchEnd > researchStart, "research-safe builder not found");
assert.ok(routeBStart > researchEnd, "research-safe listener boundary not found");

const context = { Date, JSON, Math, Number, Object, String, Array, RegExp, Map, Set };
vm.createContext(context);
vm.runInContext(html.slice(pricingStart, pricingEnd), context);
vm.runInContext(html.slice(researchStart, researchEnd), context);

// Date-like suffixes are removed before a constrained allowlist is applied.
const modelCases = [
  ["claude-opus-4-8-20260716", "claude-opus-4-8"],
  ["claude-3-5-sonnet-2024-10-22", "claude-3-5-sonnet"],
  ["gpt-5.6-sol-20260716", "gpt-5.6-sol"],
  ["gpt-5.6-terra-2026-07-16", "gpt-5.6-terra"],
  ["gpt-5.6-codex-mini", "gpt-5.6-codex-mini"],
  ["o3-20260716", "o3"],
  ["o3-mini-2026-07-16", "o3-mini"],
  ["deepseek-v4-pro-20260716", "deepseek-v4-pro"],
  ["deepseek-v4-reasoner-2026-07-16", "deepseek-v4-reasoner"],
];
for (const [raw, expected] of modelCases) assert.equal(context.strictResearchModelLabel(raw), expected);
for (const raw of [
  "claude-opus-4-8-private-customer-20260716",
  "gpt-5.6-sol-private-project-20260716",
  "o3-private-project-20260716",
  "deepseek-v4-pro-private-project-20260716",
  "claude-opus-4-8-1234567",
  "claude-opus-4-8-123456789",
  "gpt-5.6-sol-1234567",
  "gpt-5.6-sol-123456789",
  "deepseek-v4-pro-1234567",
  "deepseek-v4-pro-123456789",
  "C:\\Users\\Adam\\PRIVATE_PROJECT\\claude-opus-4-8",
  "<img src=x onerror=alert(1)>",
]) assert.equal(context.strictResearchModelLabel(raw), "Unrecognized AI version");

const questionnaire = {
  what_to_improve: ["running_out_of_ai_usage", "PRIVATE FREE TEXT"],
  source_selected: "claude_code",
  route_selected: "show_report_first",
  kinds_of_work: ["bounded_agent_loop", "C:\\Users\\Adam\\secret"],
  frequency: ["six_plus_hours_daily"],
  main_uses: ["coding"],
  effort_level: ["max"],
  goals: ["predict_cost"],
  account_category: ["paid_individual"],
  arbitrary_free_text: "adam@example.com PRIVATE_PROJECT",
};

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function claudeResult(model = "claude-opus-4-8") {
  return {
    by: { [model]: { inp: 100, out: 20, cw: 30, cr: 40, turns: 2 } },
    turns: 2, sessions: 1, days: 1, filesOpened: 4, estimate: true, valueModelEligible: true,
  };
}

const exported = plain(context.buildResearchSafeObject(claudeResult(), null, questionnaire, 0.4, "2026-07-16"));
for (const key of ["schema_version", "collector", "generated_date", "source", "measurement", "scope", "coverage", "totals", "activity", "cost", "pricing", "permission_mode_counts", "by_model", "questionnaire", "value_model", "privacy"]) {
  assert.ok(Object.prototype.hasOwnProperty.call(exported, key), `missing top-level field: ${key}`);
}
assert.equal(exported.schema_version, "top.research-safe-usage.v1");
assert.deepEqual(Object.keys(exported), ["schema_version", "collector", "generated_date", "source", "measurement", "scope", "coverage", "totals", "activity", "cost", "pricing", "permission_mode_counts", "by_model", "questionnaire", "value_model", "privacy"],
  "v1 output shape and key order must remain unchanged");
assert.equal(exported.collector.collector_version, "top.local-analyzer.2026-07-16.1");
assert.equal(exported.collector.parser_version, "top.usage-parser.2026-07-16.1");
assert.equal(exported.generated_date, "2026-07-16");
assert.deepEqual(Object.keys(exported.totals).sort(),
  ["cache_read_tokens", "cache_write_tokens", "input_tokens", "output_tokens", "reasoning_tokens", "total_tokens"].sort());
assert.equal(exported.totals.input_tokens, 100);
assert.equal(exported.totals.output_tokens, 20);
assert.equal(exported.totals.cache_write_tokens, 30);
assert.equal(exported.totals.cache_read_tokens, 40);
assert.equal(exported.totals.reasoning_tokens, null);
assert.equal(exported.totals.total_tokens, 190);
assert.equal(exported.activity.ai_replies, 2);
assert.equal(exported.coverage.files_opened, 4);
assert.equal(exported.cost.subscription_bill, false);
assert.equal(exported.pricing.reference_checked_date, "2026-07-16");
assert.equal(exported.pricing.status, "checked_reference_rates");
assert.equal(exported.pricing.applied_rates[0].field_provenance.input, "checked_reference_rate");
assert.equal(exported.value_model.truth_status, "illustrative_unvalidated");
assert.equal(exported.value_model.algorithm_version, "top.value-model.v0.1-illustrative");
assert.ok(exported.value_model.inputs && exported.value_model.outputs);
assert.ok(exported.value_model.assumptions.includes("the_output_value_index_is_not_measured"));
assert.deepEqual(exported.questionnaire.what_to_improve, ["running_out_of_ai_usage"]);
assert.deepEqual(exported.questionnaire.kinds_of_work, ["bounded_agent_loop"]);
assert.equal(Object.prototype.hasOwnProperty.call(exported.questionnaire, "arbitrary_free_text"), false);
for (const row of exported.by_model) {
  for (const key of ["model", "input_tokens", "output_tokens", "cache_write_tokens", "cache_read_tokens", "reasoning_tokens", "total_tokens", "events_or_replies", "cost"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, key), `missing per-model field: ${key}`);
  }
}

function v2Result() {
  const result = claudeResult();
  Object.assign(result, {
    pilotSafe: true,
    pilotSafeSchemaVersion: "top.safe-usage.v2",
    pilotCollectorVersion: "top.local-collector.2026-07-16.2",
    pilotParserVersion: "top.usage-parser.2026-07-16.3",
    pilotV2Aggregate: {
      timeline: {
        status: "available", granularity: "calendar_month",
        timestamp_basis: "source_date_prefix_not_timezone_normalized",
        periods: [{
          period: "2026-07", input_tokens: 100, cache_write_input_tokens: 30,
          cache_read_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 0,
          usage_records: 2, total_tokens: 190, active_days: 1,
          logical_sessions_started: 1,
        }],
      },
      session_distributions: {
        status: "available", session_definition: "deduplicated_logical_session",
        thresholds_version: "top.session-buckets.v1",
        elapsed_time_basis: "wall_clock_span_between_first_and_last_supported_usage_record",
        logical_sessions_analyzed: 1,
        usage_records_per_session: { zero: 0, one: 0, two_to_four: 1, five_to_nineteen: 0, twenty_plus: 0 },
        total_tokens_per_session: { under_10k: 1, ten_to_49k: 0, fifty_to_199k: 0, two_hundred_to_999k: 0, one_million_plus: 0 },
        elapsed_time_per_session: { under_10m: 1, ten_to_59m: 0, one_to_3h: 0, four_to_11h: 0, twelve_h_plus: 0, unknown: 0 },
      },
      workflow_shape: {
        status: "available", algorithm_version: "top.workflow-shape.v1",
        basis: "deduplicated_usage_record_count_only",
        sessions: { single_exchange: 0, short_multi_exchange: 1, sustained: 0, high_iteration: 0, unclassified: 0 },
      },
    },
  });
  return result;
}

const exportedV2 = plain(context.buildResearchSafeObject(v2Result(), null, null, 0.4, "2026-07-16"));
assert.equal(exportedV2.schema_version, "top.research-safe-usage.v2");
assert.deepEqual(Object.keys(exportedV2), Object.keys(exported).concat(["timeline", "session_distributions", "workflow_shape"]));
assert.equal(exportedV2.collector.collector_version, "top.local-collector.2026-07-16.2");
assert.equal(exportedV2.timeline.periods[0].total_tokens, exportedV2.totals.total_tokens);
assert.equal(exportedV2.session_distributions.logical_sessions_analyzed, exportedV2.activity.sessions);
assert.equal(exportedV2.workflow_shape.sessions.short_multi_exchange, 1);
assert.deepEqual(Object.keys(exportedV2.timeline), ["status", "granularity", "timestamp_basis", "periods"]);
assert.deepEqual(Object.keys(exportedV2.session_distributions), ["status", "session_definition", "thresholds_version", "elapsed_time_basis", "logical_sessions_analyzed", "usage_records_per_session", "total_tokens_per_session", "elapsed_time_per_session"]);
assert.deepEqual(Object.keys(exportedV2.workflow_shape), ["status", "algorithm_version", "basis", "sessions"]);
const earlyYearResearchV2 = v2Result();
earlyYearResearchV2.pilotV2Aggregate.timeline.periods[0].period = "0000-02";
assert.equal(context.buildResearchSafeObject(earlyYearResearchV2, null, null, 0.4, "2026-07-16").timeline.periods[0].period, "0000-02");
for (const forbidden of ["prompt", "reply", "code", "tool_output", "filename", "path", "semantic_category"]) {
  assert.equal(Object.prototype.hasOwnProperty.call(exportedV2.timeline, forbidden), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exportedV2.session_distributions, forbidden), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exportedV2.workflow_shape, forbidden), false);
}
const v2WithPrivateField = v2Result();
v2WithPrivateField.pilotV2Aggregate.timeline.periods[0].prompt = "PRIVATE";
assert.throws(() => context.buildResearchSafeObject(v2WithPrivateField, null, null, 0.4, "2026-07-16"), /v2_period_unsupported_field/);
const v2WithBadTotals = v2Result();
v2WithBadTotals.pilotV2Aggregate.timeline.periods[0].input_tokens++;
v2WithBadTotals.pilotV2Aggregate.timeline.periods[0].total_tokens++;
assert.throws(() => context.buildResearchSafeObject(v2WithBadTotals, null, null, 0.4, "2026-07-16"), /v2_reconciliation_failed/);
const v2WithUnknownCollector = v2Result();
v2WithUnknownCollector.pilotCollectorVersion = "latest";
assert.throws(() => context.buildResearchSafeObject(v2WithUnknownCollector, null, null, 0.4, "2026-07-16"), /v2_source_not_accepted/);
const undatedV2 = v2Result();
undatedV2.days = 0;
undatedV2.pilotV2Aggregate.timeline.periods[0].period = "undated";
undatedV2.pilotV2Aggregate.timeline.periods[0].active_days = 0;
const exportedUndatedV2 = plain(context.buildResearchSafeObject(undatedV2, null, null, 0.4, "2026-07-16"));
assert.equal(exportedUndatedV2.activity.active_days, 0, "v2 must preserve a valid zero active-day count");
const codexResearchV2 = v2Result();
codexResearchV2.by = { "gpt-5.6-codex-mini": { inp: 100, out: 20, cw: 30, cr: 40, reasoning: 10, turns: 2 } };
codexResearchV2.codex = true;
codexResearchV2.pilotV2Aggregate.timeline.periods[0].reasoning_output_tokens = 10;
codexResearchV2.pilotV2Aggregate.session_distributions.session_definition = "codex_rollout_file_proxy";
const exportedCodexV2 = plain(context.buildResearchSafeObject(codexResearchV2, null, null, 0.4, "2026-07-16"));
assert.equal(exportedCodexV2.schema_version, "top.research-safe-usage.v2");
assert.equal(exportedCodexV2.activity.usage_events, 2);
assert.equal(exportedCodexV2.activity.ai_replies, null);
assert.equal(exportedCodexV2.totals.reasoning_tokens, 10);
assert.equal(exportedCodexV2.timeline.periods[0].reasoning_output_tokens, 10);
assert.equal(exportedCodexV2.cost.usd, null);
assert.equal(exportedCodexV2.measurement.cost_basis, "not_available_in_local_codex_history");
assert.equal(exportedCodexV2.cost.basis, "not_available_in_local_codex_history");
assert.equal(exportedCodexV2.pricing.status, "not_applied_source_has_no_billed_cost");
assert.equal(exportedCodexV2.pricing.applied_rates.length, 0);
assert.equal(exportedCodexV2.value_model.truth_status, "not_available");

// Exact edit provenance persists by price family and affects only the edited fields.
context.PRICING_EDITED_FIELDS["opusNew:in"] = true;
let edited = plain(context.buildResearchSafeObject(claudeResult(), null, null, 0.4, "2026-07-16"));
let opusRate = edited.pricing.applied_rates[0];
assert.equal(opusRate.field_provenance.input, "user_edited_in_tab");
assert.equal(opusRate.field_provenance.cache_write, "derived_from_user_edited_input");
assert.equal(opusRate.field_provenance.cache_read, "derived_from_user_edited_input");
assert.equal(opusRate.field_provenance.output, "checked_reference_rate");
assert.equal(edited.pricing.status, "mixed_checked_and_user_edited_rates");
const laterReport = claudeResult("claude-sonnet-5");
edited = plain(context.buildResearchSafeObject(laterReport, null, null, 0.4, "2026-07-16"));
assert.equal(edited.pricing.applied_rates[0].field_provenance.input, "checked_reference_rate",
  "editing Opus input must not label Sonnet input as edited on a later report");
context.PRICING_EDITED_FIELDS["opusNew:out"] = true;
edited = plain(context.buildResearchSafeObject(claudeResult(), null, null, 0.4, "2026-07-16"));
assert.equal(edited.pricing.status, "user_edited_in_tab");
assert.equal(edited.pricing.applied_rates[0].field_provenance.output, "user_edited_in_tab");

// Invalid scenario values clamp or fall back without changing the truth label.
const lowScenario = plain(context.buildResearchSafeObject(claudeResult(), null, null, -100, "2026-07-16"));
const highScenario = plain(context.buildResearchSafeObject(claudeResult(), null, null, Infinity, "2026-07-16"));
const fallbackScenario = plain(context.buildResearchSafeObject(claudeResult(), null, null, NaN, "2026-07-16"));
assert.equal(lowScenario.value_model.inputs.scenario_slider, 0);
assert.equal(highScenario.value_model.inputs.scenario_slider, 1);
assert.equal(fallbackScenario.value_model.inputs.scenario_slider, 0.4);
for (const item of [lowScenario, highScenario, fallbackScenario]) assert.equal(item.value_model.truth_status, "illustrative_unvalidated");

// Codex records expose reasoning, usage-event, and detailed parser coverage fields.
const codex = plain(context.buildResearchSafeObject({
  by: { "gpt-5.6-codex-mini": { inp: 80, out: 30, cw: 0, cr: 20, reasoning: 10, turns: 3 } },
  turns: 3, sessions: 2, days: 2, filesOpened: 3, estimate: true, valueModelEligible: true, codex: true,
  coverage: { files_selected: 3, files_parsed: 3, files_with_usage: 2, files_skipped: 0, malformed_lines: 1, oversized_lines: 0, counter_resets: 1, complete: false },
}, null, null, 0.4, "2026-07-16"));
assert.equal(codex.source.surface, "codex");
assert.equal(codex.totals.reasoning_tokens, 10);
assert.equal(codex.activity.usage_events, 3);
assert.equal(codex.activity.ai_replies, null);
assert.equal(codex.coverage.files_selected, 3);
assert.equal(codex.coverage.complete, false);
assert.equal(codex.by_model[0].model, "gpt-5.6-codex-mini");
assert.equal(codex.cost.usd, null, "Codex research exports must not turn token counters into billed dollars");
assert.equal(codex.measurement.cost_basis, "not_available_in_local_codex_history");
assert.equal(codex.cost.basis, "not_available_in_local_codex_history");
assert.equal(codex.pricing.status, "not_applied_source_has_no_billed_cost");
assert.equal(codex.pricing.applied_rates.length, 0);
assert.equal(codex.by_model[0].cost.usd, null);
assert.equal(codex.value_model.truth_status, "not_available");

// Cleaned Claude data keeps only allowlisted permission modes and never exports a hidden Route A scenario.
const routeB = { res: {
  by: { "claude-opus-4-8": { inp: 10, out: 5, cw: 2, cr: 3, turns: 1 } },
  turns: 1, sessions: 1, days: 1, filesOpened: 1, valueModelEligible: false,
  perm: { plan: 2, acceptEdits: 1, "C:\\Users\\Adam\\PRIVATE_MODE": 4 },
} };
const cleaned = plain(context.buildResearchSafeObject(null, routeB, null, 0.4, "2026-07-16"));
assert.equal(cleaned.source.input_form, "locally_cleaned_usage_export");
assert.deepEqual(cleaned.permission_mode_counts, { plan: 2, accept_edits: 1, unrecognized: 4 });
assert.equal(cleaned.value_model.truth_status, "not_available");
assert.equal(cleaned.value_model.reason, "scenario_control_not_shown_for_this_route");

// Chat export fields remain unavailable rather than being silently represented as zero or billed usage.
const chat = plain(context.buildResearchSafeObject({
  by: { "claude.ai (est.)": { inp: 100, out: 200, cw: 0, cr: 0, turns: 6 } },
  turns: 6, sessions: 2, days: 0, filesOpened: 1, chatExport: true, chatProvider: "Claude Chat", valueModelEligible: false,
  ignoredRecords: 3, ignoredMessages: 4, duplicateRecords: 1,
}, null, null, 0.4, "2026-07-16"));
assert.equal(chat.totals.cache_write_tokens, null);
assert.equal(chat.totals.cache_read_tokens, null);
assert.equal(chat.totals.reasoning_tokens, null);
assert.equal(chat.cost.status, "unavailable");
assert.equal(chat.pricing.status, "not_applied");
assert.equal(chat.activity.text_messages, 6);
assert.equal(chat.value_model.truth_status, "not_available");

// Console costs distinguish complete recorded exports from mixed recorded and estimated rows.
const completeCsv = plain(context.buildResearchSafeObject({
  by: { "claude-opus-4-8": { inp: 10, out: 5, cw: 0, cr: 0, turns: 1, cost: 4.2, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 } } },
  turns: 1, sessions: 1, days: 0, filesOpened: 1, csv: true, costComplete: true, costRows: 1, missingCostRows: 0, valueModelEligible: true,
}, null, null, 0.4, "2026-07-16"));
assert.equal(completeCsv.cost.status, "recorded");
assert.equal(completeCsv.cost.usd, 4.2);
assert.equal(completeCsv.pricing.status, "not_needed_recorded_cost");
assert.equal(completeCsv.pricing.applied_rates.length, 0);
assert.equal(completeCsv.activity.sessions, null, "Console rows are not work-session counts");
const mixedCsv = plain(context.buildResearchSafeObject({
  by: { "claude-sonnet-5": { inp: 100, out: 50, cw: 10, cr: 20, turns: 2, cost: 1.5, costRows: 1, missingCostRows: 1, missing: { inp: 40, out: 10, cw: 5, cr: 8 } } },
  turns: 2, sessions: 2, days: 0, filesOpened: 1, csv: true, costComplete: false, costRows: 1, missingCostRows: 1, valueModelEligible: true,
}, null, null, 0.4, "2026-07-16"));
assert.equal(mixedCsv.cost.status, "mixed_recorded_and_estimated");
assert.ok(mixedCsv.cost.usd > 1.5);
assert.equal(mixedCsv.pricing.applied_rates.length, 1);

// Private fields and arbitrary questionnaire text never flow through the whitelist-based builder.
const privateResult = claudeResult("C:\\Users\\Adam\\PRIVATE_PROJECT\\claude-opus-4-8");
Object.assign(privateResult, { prompt: "PRIVATE PROMPT TEXT", email: "adam@example.com", timestamp: "2026-07-16T18:46:19.288Z", sessionId: "ORIGINAL-SESSION-ID" });
const privateJson = context.buildResearchSafeJSON(privateResult, null, questionnaire, 0.4, "2026-07-16");
for (const sentinel of ["PRIVATE_PROJECT", "C:\\\\Users", "PRIVATE PROMPT TEXT", "adam@example.com", "2026-07-16T18:46:19.288Z", "ORIGINAL-SESSION-ID", "private-customer"]) {
  assert.equal(privateJson.includes(sentinel), false, `privacy sentinel leaked: ${sentinel}`);
}
assert.match(privateJson, /Unrecognized AI version/);
assert.equal(JSON.parse(privateJson).value_model.truth_status, "not_available");
const questionnaireSource = html.slice(html.indexOf("function collectResearchQuestionnaire"), html.indexOf("function safeResearchQuestionnaire"));
assert.doesNotMatch(questionnaireSource, /primaryother|resonanceOtherText/);

// Exercise the real download function and the actual button/listener registration.
let downloaded = null, registered = null;
const statusNode = { textContent: "" };
const buttonNode = { addEventListener(type, handler) { registered = { type, handler }; } };
context.document = { getElementById(id) {
  if (id === "vmg") return { value: "0.4" };
  if (id === "shareStatus") return statusNode;
  if (id === "downloadResearchJSON") return buttonNode;
  return null;
} };
context.LAST_RESULT = claudeResult();
context.ROUTEB = null;
context.collectResearchQuestionnaire = () => null;
context.dlFile = (name, text, type) => { downloaded = { name, text, type }; };
vm.runInContext(html.slice(researchEnd, routeBStart), context);
assert.equal(registered.type, "click");
assert.equal(registered.handler, context.downloadResearchSafeJSON);
assert.equal(registered.handler(), true);
assert.match(downloaded.name, /^top-research-safe-usage-\d{4}-\d{2}-\d{2}\.json$/);
assert.equal(downloaded.type, "application/json");
assert.equal(JSON.parse(downloaded.text).schema_version, "top.research-safe-usage.v1");
assert.match(statusNode.textContent, /Nothing was submitted/);

console.log("TOP Analyzer research-safe JSON tests passed");
