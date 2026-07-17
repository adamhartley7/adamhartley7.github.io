import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  MAX_JSON_BYTES,
  REPORT_SCHEMA_VERSION_V2,
  createHandler,
  escapeHtml,
  validateResearchSafeUsage,
} from "../src/index.mjs";

const ORIGIN = "https://tokenoptimisationprotocol.org";
const SUBMISSION_ID = "018f62cc-d0cd-7bc0-bed9-1e0c86b41ef3";
const SELF_REPORTED_VALUE_LIMITATIONS = [
  "hours_saved_was_not_measured_or_verified_by_top",
  "value_per_hour_was_not_measured_or_verified_by_top",
  "top_does_not_claim_the_reported_value_was_caused_by_top",
  "non_usd_value_is_not_compared_with_usd_ai_cost",
  "top_2_and_top_3_are_not_included",
];

function reportFixture() {
  return {
    schema_version: "top.research-safe-usage.v1",
    collector: {
      collector_version: "top.local-collector.2026-07-16.1",
      parser_version: "top.usage-parser.2026-07-16.2",
    },
    generated_date: "2026-07-16",
    source: {
      provider: "anthropic",
      surface: "claude_code",
      input_form: "validated_top_safe_usage_export",
    },
    measurement: {
      token_basis: "recorded_usage_counters",
      cache_basis: "recorded_usage_counters",
      reasoning_basis: "not_separately_available",
      cost_basis: "checked_pay_as_you_go_rate_comparison",
    },
    scope: {
      selection: "supported_records_in_user_selected_local_data",
      full_account_or_subscription_claim: false,
      original_source_content_included: false,
    },
    coverage: {
      status: "available_from_local_collector",
      files_opened: null,
      files_discovered: 2,
      files_parsed: 2,
      files_with_usage: 1,
      files_skipped: 0,
      malformed_lines: 0,
      oversized_lines: 0,
      counter_resets: 0,
      duplicate_usage_records: 3,
      complete: true,
    },
    totals: {
      input_tokens: 10,
      output_tokens: 5,
      cache_write_tokens: 20,
      cache_read_tokens: 30,
      reasoning_tokens: null,
      total_tokens: 65,
    },
    activity: {
      ai_replies: 2,
      usage_events: null,
      console_records: null,
      text_messages: null,
      sessions: 1,
      active_days: 1,
    },
    cost: {
      status: "unavailable",
      usd: null,
      basis: "estimated_pay_as_you_go_comparison",
      currency: "USD",
      subscription_bill: false,
    },
    pricing: {
      status: "not_applied_no_recognized_rate",
      reference_checked_date: "2026-07-16",
      unit: "usd_per_million_tokens",
      applied_rates: [],
      unpriced_model_groups: 1,
    },
    permission_mode_counts: null,
    by_model: [{
      model: "deepseek-v4-pro",
      input_tokens: 10,
      output_tokens: 5,
      cache_write_tokens: 20,
      cache_read_tokens: 30,
      reasoning_tokens: null,
      total_tokens: 65,
      events_or_replies: 2,
      cost: { status: "unavailable", usd: null },
    }],
    questionnaire: null,
    value_model: {
      truth_status: "not_available",
      algorithm_version: "top.value-model.v0.1-illustrative",
      reason: "current_report_not_eligible",
    },
    privacy: {
      network_delivery: "none",
      inspect_before_attaching: true,
      excluded: [
        "prompts", "replies", "code", "tool_output", "paths", "filenames",
        "project_and_account_identifiers", "email_addresses", "exact_timestamps", "original_ids",
      ],
    },
  };
}

function submissionFixture() {
  return {
    submission_schema_version: "top.explicit-submission.v1",
    submission_id: SUBMISSION_ID,
    consent: {
      notice_version: "top.research-consent.2026-07-17.1",
      accepted: true,
      purposes: ["analyzer_validation", "forecast_calibration"],
      retention_days: 30,
    },
    report: reportFixture(),
  };
}

function pricedReportFixture(reportCost = 5) {
  const report = reportFixture();
  report.by_model[0].model = "claude-opus-4-8";
  report.by_model[0].cost = { status: "estimated", usd: reportCost };
  report.cost = {
    status: "estimated",
    usd: reportCost,
    basis: "estimated_pay_as_you_go_comparison",
    currency: "USD",
    subscription_bill: false,
  };
  report.pricing = {
    status: "checked_reference_rates",
    reference_checked_date: "2026-07-16",
    unit: "usd_per_million_tokens",
    applied_rates: [{
      model: "claude-opus-4-8",
      rate_family: "Claude Opus 4.5 to 4.8",
      input_usd_per_million: 15,
      cache_write_usd_per_million: 18.75,
      cache_read_usd_per_million: 1.5,
      output_usd_per_million: 75,
      field_provenance: {
        input: "checked_reference_rate",
        cache_write: "derived_from_checked_reference_input",
        cache_read: "derived_from_checked_reference_input",
        output: "checked_reference_rate",
      },
      reference_source_url: "https://platform.claude.com/docs/en/about-claude/pricing",
    }],
    unpriced_model_groups: 0,
  };
  return report;
}

function selfReportedValueFixture({ hoursSaved = 2, valuePerHour = 10, currency = "USD", reportCost = 5 } = {}) {
  const gross = Number((hoursSaved * valuePerHour).toFixed(2));
  return {
    truth_status: "self_reported_unverified",
    algorithm_version: "top.value-model.v0.2-self-reported",
    inputs: {
      hours_saved: hoursSaved,
      value_per_hour: valuePerHour,
      currency,
      provenance: "entered_by_user_in_browser",
    },
    calculation: "hours_saved_multiplied_by_value_per_hour",
    outputs: {
      self_reported_time_value: gross,
      value_currency: currency,
      analyzed_ai_cost_usd: reportCost,
      net_after_ai_cost_usd: currency === "USD" ? Number((gross - reportCost).toFixed(2)) : null,
      self_reported_value_per_ai_cost_usd: currency === "USD" && reportCost > 0
        ? Number((gross / reportCost).toFixed(6))
        : null,
    },
    limitations: [...SELF_REPORTED_VALUE_LIMITATIONS],
  };
}

function reportWithSelfReportedValue(options = {}) {
  const reportCost = options.reportCost ?? 5;
  const report = pricedReportFixture(reportCost);
  report.value_model = selfReportedValueFixture({ ...options, reportCost });
  return report;
}

function v2ReportFixture() {
  const report = reportFixture();
  report.schema_version = REPORT_SCHEMA_VERSION_V2;
  report.collector = {
    collector_version: "top.local-collector.2026-07-16.2",
    parser_version: "top.usage-parser.2026-07-16.3",
  };
  report.timeline = {
    status: "available",
    granularity: "calendar_month",
    timestamp_basis: "source_date_prefix_not_timezone_normalized",
    periods: [{
      period: "2026-07",
      input_tokens: 10,
      cache_write_input_tokens: 20,
      cache_read_input_tokens: 30,
      output_tokens: 5,
      reasoning_output_tokens: 0,
      usage_records: 2,
      total_tokens: 65,
      active_days: 1,
      logical_sessions_started: 1,
    }],
  };
  report.session_distributions = {
    status: "available",
    session_definition: "deduplicated_logical_session",
    thresholds_version: "top.session-buckets.v1",
    elapsed_time_basis: "wall_clock_span_between_first_and_last_supported_usage_record",
    logical_sessions_analyzed: 1,
    usage_records_per_session: { zero: 0, one: 0, two_to_four: 1, five_to_nineteen: 0, twenty_plus: 0 },
    total_tokens_per_session: { under_10k: 1, ten_to_49k: 0, fifty_to_199k: 0, two_hundred_to_999k: 0, one_million_plus: 0 },
    elapsed_time_per_session: { under_10m: 1, ten_to_59m: 0, one_to_3h: 0, four_to_11h: 0, twelve_h_plus: 0, unknown: 0 },
  };
  report.workflow_shape = {
    status: "available",
    algorithm_version: "top.workflow-shape.v1",
    basis: "deduplicated_usage_record_count_only",
    sessions: { single_exchange: 0, short_multi_exchange: 1, sustained: 0, high_iteration: 0, unclassified: 0 },
  };
  return report;
}

function v2CodexReportFixture() {
  const report = v2ReportFixture();
  report.source = { provider: "openai", surface: "codex", input_form: "validated_top_safe_usage_export" };
  report.measurement = {
    token_basis: "recorded_usage_counters",
    cache_basis: "recorded_usage_counters",
    reasoning_basis: "recorded_subset_of_output",
    cost_basis: "checked_pay_as_you_go_rate_comparison",
  };
  report.activity.ai_replies = null;
  report.activity.usage_events = 2;
  report.totals.reasoning_tokens = 1;
  report.by_model[0].model = "gpt-5.6-codex-mini";
  report.by_model[0].reasoning_tokens = 1;
  report.timeline.periods[0].reasoning_output_tokens = 1;
  report.session_distributions.session_definition = "codex_rollout_file_proxy";
  return report;
}

function v2SubmissionFixture() {
  const submission = submissionFixture();
  submission.report = v2ReportFixture();
  return submission;
}

// Exact aggregate values produced by the vetted collector test fixture in
// commit 8d23126743e66317ef498a0329e6845c48974653.
function vettedCollectorV2ClaudeAggregate() {
  return {
    schema_version: "top.safe-usage.v2",
    collector_version: "top.local-collector.2026-07-16.2",
    parser_version: "top.usage-parser.2026-07-16.3",
    generated_date: "2026-07-16",
    source: { provider: "anthropic", surface: "claude_code" },
    coverage: {
      files_discovered: 2,
      files_parsed: 2,
      files_with_usage: 2,
      files_skipped: 0,
      malformed_lines: 0,
      oversized_lines: 0,
      counter_resets: 0,
      duplicate_usage_records: 1,
      complete: true,
    },
    totals: {
      input_tokens: 1_270_027,
      cache_write_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      usage_records: 51,
      total_tokens: 1_270_027,
    },
    activity: { sessions: 6, active_days: 5 },
    by_model: [{
      model: "claude-opus-4-8",
      input_tokens: 1_270_027,
      cache_write_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      usage_records: 51,
      total_tokens: 1_270_027,
    }],
    timeline: {
      status: "available",
      granularity: "calendar_month",
      timestamp_basis: "source_date_prefix_not_timezone_normalized",
      periods: [
        { period: "2026-01", input_tokens: 69_999, cache_write_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, usage_records: 7, total_tokens: 69_999, active_days: 3, logical_sessions_started: 3 },
        { period: "2026-02", input_tokens: 1_200_008, cache_write_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, usage_records: 24, total_tokens: 1_200_008, active_days: 2, logical_sessions_started: 2 },
        { period: "undated", input_tokens: 20, cache_write_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, usage_records: 20, total_tokens: 20, active_days: 0, logical_sessions_started: 1 },
      ],
    },
    session_distributions: {
      status: "available",
      session_definition: "deduplicated_logical_session",
      thresholds_version: "top.session-buckets.v1",
      elapsed_time_basis: "wall_clock_span_between_first_and_last_supported_usage_record",
      logical_sessions_analyzed: 6,
      usage_records_per_session: { zero: 0, one: 1, two_to_four: 2, five_to_nineteen: 2, twenty_plus: 1 },
      total_tokens_per_session: { under_10k: 2, ten_to_49k: 1, fifty_to_199k: 1, two_hundred_to_999k: 1, one_million_plus: 1 },
      elapsed_time_per_session: { under_10m: 1, ten_to_59m: 1, one_to_3h: 1, four_to_11h: 1, twelve_h_plus: 1, unknown: 1 },
    },
    workflow_shape: {
      status: "available",
      algorithm_version: "top.workflow-shape.v1",
      basis: "deduplicated_usage_record_count_only",
      sessions: { single_exchange: 1, short_multi_exchange: 2, sustained: 2, high_iteration: 1, unclassified: 0 },
    },
  };
}

function researchReportFromVettedCollectorFixture() {
  const safe = vettedCollectorV2ClaudeAggregate();
  const report = reportFixture();
  report.schema_version = REPORT_SCHEMA_VERSION_V2;
  report.collector = { collector_version: safe.collector_version, parser_version: safe.parser_version };
  report.source = { ...safe.source, input_form: "validated_top_safe_usage_export" };
  report.coverage = { status: "available_from_local_collector", files_opened: null, ...safe.coverage };
  report.totals = {
    input_tokens: safe.totals.input_tokens,
    output_tokens: safe.totals.output_tokens,
    cache_write_tokens: safe.totals.cache_write_input_tokens,
    cache_read_tokens: safe.totals.cache_read_input_tokens,
    reasoning_tokens: null,
    total_tokens: safe.totals.total_tokens,
  };
  report.activity = { ai_replies: safe.totals.usage_records, usage_events: null, console_records: null, text_messages: null, sessions: safe.activity.sessions, active_days: safe.activity.active_days };
  report.by_model = safe.by_model.map((row) => ({
    model: row.model,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cache_write_tokens: row.cache_write_input_tokens,
    cache_read_tokens: row.cache_read_input_tokens,
    reasoning_tokens: null,
    total_tokens: row.total_tokens,
    events_or_replies: row.usage_records,
    cost: { status: "unavailable", usd: null },
  }));
  report.timeline = structuredClone(safe.timeline);
  report.session_distributions = structuredClone(safe.session_distributions);
  report.workflow_shape = structuredClone(safe.workflow_shape);
  return report;
}

function environment(rateSuccess = true) {
  return {
    RESEND_API_KEY: "synthetic-sending-only-key",
    RESEND_FROM: "TOP Analyzer <reports@send.tokenoptimisationprotocol.org>",
    SUBMISSION_TO: "adam-review@example.com",
    SUBMISSION_CC: "sam-review@example.com",
    SUBMIT_RATE_LIMITER: { limit: async () => ({ success: rateSuccess }) },
  };
}

function requestFor(body, options = {}) {
  return new Request("https://submit.example.workers.dev/v1/reports", {
    method: options.method || "POST",
    headers: {
      "Origin": options.origin || ORIGIN,
      "Content-Type": options.contentType || "application/json",
      ...(options.headers || {}),
    },
    body: options.method === "OPTIONS" ? undefined : body,
  });
}

async function responseJson(response) {
  return { response, body: await response.json() };
}

test("strict v1 fixture validates and totals reconcile", () => {
  assert.equal(validateResearchSafeUsage(reportFixture()), true);
});

test("legacy v0.1 value-model compatibility is limited to the exact not-available shape", () => {
  const currentNotAvailable = reportFixture();
  assert.equal(validateResearchSafeUsage(currentNotAvailable), true);

  const routeNotAvailable = reportFixture();
  routeNotAvailable.value_model.reason = "scenario_control_not_shown_for_this_route";
  assert.equal(validateResearchSafeUsage(routeNotAvailable), true);

  const legacyIllustrative = reportFixture();
  legacyIllustrative.value_model = {
    truth_status: "illustrative_unvalidated",
    algorithm_version: "top.value-model.v0.1-illustrative",
    inputs: {},
    assumptions: [],
    outputs: {},
  };
  assert.throws(() => validateResearchSafeUsage(legacyIllustrative), /legacy value model|unsupported or missing fields/i);

  const legacyExtraField = reportFixture();
  legacyExtraField.value_model.scenario_slider = 0.4;
  assert.throws(() => validateResearchSafeUsage(legacyExtraField), /unsupported or missing fields/i);
});

test("v0.2 status-only shapes are exact and version-specific", () => {
  const notAvailable = reportFixture();
  notAvailable.value_model = {
    truth_status: "not_available",
    algorithm_version: "top.value-model.v0.2-self-reported",
    reason: "current_report_not_eligible",
  };
  assert.throws(() => validateResearchSafeUsage(notAvailable), /status is not supported|unsupported or missing fields/i);

  const notProvided = reportFixture();
  notProvided.value_model = {
    truth_status: "not_provided",
    algorithm_version: "top.value-model.v0.2-self-reported",
    reason: "user_did_not_enter_both_value_inputs",
  };
  assert.equal(validateResearchSafeUsage(notProvided), true);

  const legacyReasonUnderV02 = structuredClone(notProvided);
  legacyReasonUnderV02.value_model.reason = "scenario_control_not_shown_for_this_route";
  assert.throws(() => validateResearchSafeUsage(legacyReasonUnderV02), /reason is not supported/i);

  const v02ReasonUnderLegacy = reportFixture();
  v02ReasonUnderLegacy.value_model.reason = "invalid_user_entered_value_inputs";
  assert.throws(() => validateResearchSafeUsage(v02ReasonUnderLegacy), /reason is not supported/i);
});

test("v0.2 self-reported values reconcile and preserve finite zero values", () => {
  assert.equal(validateResearchSafeUsage(reportWithSelfReportedValue()), true);
  assert.equal(validateResearchSafeUsage(reportWithSelfReportedValue({ hoursSaved: 1, valuePerHour: 5 })), true, "zero net value must remain a finite zero");
  assert.equal(validateResearchSafeUsage(reportWithSelfReportedValue({ hoursSaved: 0, valuePerHour: 999 })), true, "zero gross value and ratio must remain finite zeros");
  assert.equal(validateResearchSafeUsage(reportWithSelfReportedValue({ reportCost: 0 })), true, "zero AI cost requires a null ratio, not division by zero");
  assert.equal(validateResearchSafeUsage(reportWithSelfReportedValue({ currency: "EUR" })), true, "non-USD value remains uncombined with USD cost");
});

test("v0.2 self-reported values reject tampering, non-finite numbers and cross-version shapes", () => {
  const wrongGross = reportWithSelfReportedValue();
  wrongGross.value_model.outputs.self_reported_time_value += 1;
  assert.throws(() => validateResearchSafeUsage(wrongGross), /does not reconcile/i);

  const hiddenField = reportWithSelfReportedValue();
  hiddenField.value_model.inputs.private_note = "must not pass";
  assert.throws(() => validateResearchSafeUsage(hiddenField), /unsupported or missing fields/i);

  const nullInsteadOfZeroNet = reportWithSelfReportedValue({ hoursSaved: 1, valuePerHour: 5 });
  nullInsteadOfZeroNet.value_model.outputs.net_after_ai_cost_usd = null;
  assert.throws(() => validateResearchSafeUsage(nullInsteadOfZeroNet), /USD value outputs do not reconcile/i);

  const nullInsteadOfZeroRatio = reportWithSelfReportedValue({ hoursSaved: 0, valuePerHour: 999 });
  nullInsteadOfZeroRatio.value_model.outputs.self_reported_value_per_ai_cost_usd = null;
  assert.throws(() => validateResearchSafeUsage(nullInsteadOfZeroRatio), /USD value outputs do not reconcile/i);

  const infiniteInput = reportWithSelfReportedValue();
  infiniteInput.value_model.inputs.hours_saved = Infinity;
  assert.throws(() => validateResearchSafeUsage(infiniteInput), /nonnegative number/i);

  const crossedVersion = reportWithSelfReportedValue();
  crossedVersion.value_model.algorithm_version = "top.value-model.v0.1-illustrative";
  assert.throws(() => validateResearchSafeUsage(crossedVersion), /unsupported or missing fields/i);
});

test("strict v2 Claude Code and Codex fixtures validate without weakening v1", () => {
  assert.equal(validateResearchSafeUsage(v2ReportFixture()), true);
  assert.equal(validateResearchSafeUsage(v2CodexReportFixture()), true);
  const v1WithV2Field = reportFixture();
  v1WithV2Field.timeline = v2ReportFixture().timeline;
  assert.throws(() => validateResearchSafeUsage(v1WithV2Field), /unsupported or missing fields/i);
});

test("vetted collector v2 aggregate maps to the strict research-safe v2 contract", () => {
  const report = researchReportFromVettedCollectorFixture();
  assert.equal(validateResearchSafeUsage(report), true);
  assert.deepEqual(report.timeline, vettedCollectorV2ClaudeAggregate().timeline);
  assert.equal(report.activity.ai_replies, 51);
  assert.equal(report.activity.sessions, 6);
  assert.equal(report.activity.active_days, 5);
});

test("v2 requires the vetted collector versions, source and exact top-level shape", () => {
  const wrongCollector = v2ReportFixture();
  wrongCollector.collector.collector_version = "top.local-collector.2026-07-16.1";
  assert.throws(() => validateResearchSafeUsage(wrongCollector), /collector or parser version/i);

  const wrongSource = v2ReportFixture();
  wrongSource.source.input_form = "local_session_usage_records";
  assert.throws(() => validateResearchSafeUsage(wrongSource), /validated TOP safe-usage export/i);

  const extraField = v2ReportFixture();
  extraField.prompt_categories = { coding: 1 };
  assert.throws(() => validateResearchSafeUsage(extraField), /unsupported or missing fields/i);
});

test("v2 timeline rejects unsupported keys, invalid months and impossible ordering", () => {
  const extraKey = v2ReportFixture();
  extraKey.timeline.periods[0].filename = "private.jsonl";
  assert.throws(() => validateResearchSafeUsage(extraKey), /unsupported or missing fields/i);

  const invalidMonth = v2ReportFixture();
  invalidMonth.timeline.periods[0].period = "2026-13";
  assert.throws(() => validateResearchSafeUsage(invalidMonth), /calendar month/i);

  const duplicateMonth = v2ReportFixture();
  duplicateMonth.timeline.periods.push({ ...duplicateMonth.timeline.periods[0] });
  assert.throws(() => validateResearchSafeUsage(duplicateMonth), /uniquely sorted/i);

  const undatedNotLast = v2ReportFixture();
  undatedNotLast.timeline.periods = [
    { ...undatedNotLast.timeline.periods[0], period: "undated", active_days: 0 },
    { ...undatedNotLast.timeline.periods[0] },
  ];
  assert.throws(() => validateResearchSafeUsage(undatedNotLast), /undated last/i);
});

test("v2 timeline enforces cardinality, token math and aggregate reconciliation", () => {
  const impossibleDays = v2ReportFixture();
  impossibleDays.timeline.periods[0].period = "2026-02";
  impossibleDays.timeline.periods[0].active_days = 29;
  impossibleDays.timeline.periods[0].usage_records = 29;
  assert.throws(() => validateResearchSafeUsage(impossibleDays), /active-day cardinality/i);

  const wrongTokenMath = v2ReportFixture();
  wrongTokenMath.timeline.periods[0].total_tokens = 66;
  assert.throws(() => validateResearchSafeUsage(wrongTokenMath), /token totals do not reconcile/i);

  const wrongUsageCount = v2ReportFixture();
  wrongUsageCount.timeline.periods[0].usage_records = 3;
  assert.throws(() => validateResearchSafeUsage(wrongUsageCount), /usage records do not reconcile with activity/i);

  const hiddenReasoning = v2ReportFixture();
  hiddenReasoning.timeline.periods[0].reasoning_output_tokens = 1;
  assert.throws(() => validateResearchSafeUsage(hiddenReasoning), /reasoning tokens cannot be present/i);
});

test("v2 timeline is nonempty and requires source-specific activity counters", () => {
  const emptyTimeline = v2ReportFixture();
  emptyTimeline.timeline.periods = [];
  assert.throws(() => validateResearchSafeUsage(emptyTimeline), /nonempty list/i);

  const wrongActivityCounter = v2ReportFixture();
  wrongActivityCounter.activity.usage_events = 2;
  assert.throws(() => validateResearchSafeUsage(wrongActivityCounter), /unsupported counter/i);

  const byModelMismatch = v2ReportFixture();
  byModelMismatch.by_model[0].events_or_replies = 1;
  assert.throws(() => validateResearchSafeUsage(byModelMismatch), /Model usage records do not reconcile/i);
});

test("v2 session distributions enforce exact buckets, ranges and session definition", () => {
  const extraBucket = v2ReportFixture();
  extraBucket.session_distributions.usage_records_per_session.private = 1;
  assert.throws(() => validateResearchSafeUsage(extraBucket), /unsupported or missing fields/i);

  const wrongDefinition = v2ReportFixture();
  wrongDefinition.session_distributions.session_definition = "codex_rollout_file_proxy";
  assert.throws(() => validateResearchSafeUsage(wrongDefinition), /does not match the report source/i);

  const impossibleUsageRange = v2ReportFixture();
  impossibleUsageRange.session_distributions.usage_records_per_session = { zero: 0, one: 1, two_to_four: 0, five_to_nineteen: 0, twenty_plus: 0 };
  impossibleUsageRange.workflow_shape.sessions = { single_exchange: 1, short_multi_exchange: 0, sustained: 0, high_iteration: 0, unclassified: 0 };
  assert.throws(() => validateResearchSafeUsage(impossibleUsageRange), /aggregate total/i);

  const impossibleTokenRange = v2ReportFixture();
  impossibleTokenRange.session_distributions.total_tokens_per_session = { under_10k: 0, ten_to_49k: 1, fifty_to_199k: 0, two_hundred_to_999k: 0, one_million_plus: 0 };
  assert.throws(() => validateResearchSafeUsage(impossibleTokenRange), /aggregate total/i);
});

test("v2 workflow shape is structural, exact and reconciled to usage buckets", () => {
  const wrongAlgorithm = v2ReportFixture();
  wrongAlgorithm.workflow_shape.algorithm_version = "semantic-prompt-classifier";
  assert.throws(() => validateResearchSafeUsage(wrongAlgorithm), /workflow shape metadata/i);

  const wrongShape = v2ReportFixture();
  wrongShape.workflow_shape.sessions = { single_exchange: 0, short_multi_exchange: 0, sustained: 1, high_iteration: 0, unclassified: 0 };
  assert.throws(() => validateResearchSafeUsage(wrongShape), /does not reconcile with usage-record buckets/i);
});

test("current analyzer value-model outputs match the strict transition contract", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  const pricingStart = html.indexOf("var PRICING_CHECKED=");
  const pricingEnd = html.indexOf("var VM=", pricingStart);
  const researchStart = html.indexOf("var RESEARCH_SCHEMA_VERSION=");
  const researchEnd = html.indexOf('document.getElementById("downloadResearchJSON")', researchStart);
  assert.ok(pricingStart >= 0 && pricingEnd > pricingStart && researchStart >= 0 && researchEnd > researchStart);
  const context = { Date, JSON, Math, Number, Object, String, Array, RegExp, Map, Set };
  vm.createContext(context);
  vm.runInContext(html.slice(pricingStart, pricingEnd), context);
  vm.runInContext(html.slice(researchStart, researchEnd), context);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const missingValue = { status: "missing" };
  const validValue = { status: "complete", hours_saved: 8, value_per_hour: 40, currency: "EUR" };
  const reports = [
    context.buildResearchSafeObject({
      by: { "claude-opus-4-8": { inp: 100, out: 20, cw: 30, cr: 40, turns: 2 } },
      turns: 2, sessions: 1, days: 1, filesOpened: 4, estimate: true, valueModelEligible: true,
    }, null, null, missingValue, "2026-07-16"),
    context.buildResearchSafeObject({
      by: { "gpt-5.6-codex-mini": { inp: 80, out: 30, cw: 0, cr: 20, reasoning: 10, turns: 3 } },
      turns: 3, sessions: 2, days: 2, filesOpened: 3, estimate: true, valueModelEligible: true, codex: true,
      coverage: { files_selected: 3, files_parsed: 3, files_with_usage: 2, files_skipped: 0, malformed_lines: 1, oversized_lines: 0, counter_resets: 1, complete: false },
    }, null, null, validValue, "2026-07-16"),
    context.buildResearchSafeObject({
      by: { "claude.ai (est.)": { inp: 100, out: 200, cw: 0, cr: 0, turns: 6 } },
      turns: 6, sessions: 2, days: 0, filesOpened: 1, chatExport: true, chatProvider: "Claude Chat", valueModelEligible: false,
      ignoredRecords: 3, ignoredMessages: 4, duplicateRecords: 1,
    }, null, null, missingValue, "2026-07-16"),
    context.buildResearchSafeObject({
      by: { "claude-opus-4-8": { inp: 10, out: 5, cw: 0, cr: 0, turns: 1, cost: 4.2, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 } } },
      turns: 1, sessions: 1, days: 0, filesOpened: 1, csv: true, costComplete: true, costRows: 1, missingCostRows: 0, valueModelEligible: true,
    }, null, null, validValue, "2026-07-16"),
    context.buildResearchSafeObject(null, { res: {
      by: { "claude-opus-4-8": { inp: 10, out: 5, cw: 2, cr: 3, turns: 1 } },
      turns: 1, sessions: 1, days: 1, filesOpened: 1, valueModelEligible: false, perm: {},
    } }, null, validValue, "2026-07-16"),
  ].map(plain);
  for (const report of reports) assert.equal(validateResearchSafeUsage(report), true);
  assert.ok(reports.some((report) => report.value_model.truth_status === "not_provided"));
  assert.ok(reports.some((report) => report.value_model.truth_status === "self_reported_unverified"));
  assert.ok(reports.some((report) => report.value_model.truth_status === "not_available" && report.value_model.algorithm_version === "top.value-model.v0.1-illustrative"));
  assert.equal(reports.some((report) => report.value_model.truth_status === "illustrative_unvalidated"), false);
  assert.equal(reports.some((report) => report.value_model.truth_status === "not_available" && report.value_model.algorithm_version === "top.value-model.v0.2-self-reported"), false);
});

test("successful email body contains aggregates but not private source fields", async () => {
  let captured;
  const handler = createHandler({
    now: () => new Date("2026-07-17T12:34:56.000Z"),
    fetchImpl: async (url, init) => {
      captured = { url, init, email: JSON.parse(init.body) };
      return new Response(JSON.stringify({ id: "synthetic-email-id" }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), environment()));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(body.status, "accepted_for_delivery");
  assert.equal(body.delivered, false);
  assert.equal(body.receipt_id, SUBMISSION_ID);
  assert.equal(body.provider_message_id, "synthetic-email-id");
  assert.match(body.report_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(captured.email.to, ["adam-review@example.com"]);
  assert.deepEqual(captured.email.cc, ["sam-review@example.com"]);
  assert.equal(captured.init.headers["Idempotency-Key"], `top-usage/${SUBMISSION_ID}`);
  assert.equal(captured.init.headers["User-Agent"], "TOP-Analyzer-Delivery/1.0");
  assert.match(captured.email.text, /Total tokens: 65/);
  assert.match(captured.email.text, /privacy\.network_delivery value describes the analyzer state/i);
  assert.match(captured.email.text, /Delivery request date: 2026-07-17/);
  assert.match(captured.email.text, /Deletion due date: 2026-08-16 \(30 days after the delivery request date\)/);
  assert.match(captured.email.text, /Worker does not delete mailbox copies automatically/);
  assert.match(captured.email.html, /deepseek-v4-pro/);
  assert.match(captured.email.html, /<strong>Deletion due date:<\/strong> 2026-08-16/);
  assert.match(captured.email.html, /earlier if Adam receives an early deletion request/);
  assert.equal(/prompt text|reply text|source path|project identifier/i.test(captured.email.text), false);
  const attachmentBytes = Buffer.from(captured.email.attachments[0].content, "base64");
  assert.equal(createHash("sha256").update(attachmentBytes).digest("hex"), body.report_sha256);
  const attachment = JSON.parse(attachmentBytes.toString("utf8"));
  assert.deepEqual(attachment, reportFixture());
});

test("v2 email includes concise monthly and session-shape summaries plus the exact JSON", async () => {
  let captured;
  const handler = createHandler({
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "synthetic-v2-email-id" }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const submission = v2SubmissionFixture();
  const { response } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submission)), environment()));
  assert.equal(response.status, 202);
  assert.match(captured.text, /Source-month timeline \(1 dated periods; source date prefixes, not timezone-normalized\): 2026-07: 65 tokens, 1 session starts, 1 active days/);
  assert.match(captured.text, /Session shape: single exchange 0; short multi-exchange 1; sustained 0; high iteration 0; unclassified 0/);
  assert.match(captured.text, /separate deliberate submission.*explicit consent/i);
  assert.match(captured.html, /<h2>Source-month timeline<\/h2>/);
  assert.match(captured.html, /not timezone-normalized/);
  assert.match(captured.html, /<h2>Session shape<\/h2>/);
  const attachment = JSON.parse(Buffer.from(captured.attachments[0].content, "base64").toString("utf8"));
  assert.deepEqual(attachment, submission.report);
});

test("v2 email separates undated usage from the latest dated source months", async () => {
  let captured;
  const handler = createHandler({
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "synthetic-undated-email-id" }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const submission = submissionFixture();
  submission.report = researchReportFromVettedCollectorFixture();
  const { response } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submission)), environment()));
  assert.equal(response.status, 202);
  assert.match(captured.text, /Source-month timeline \(2 dated periods/);
  assert.match(captured.text, /2026-01: 69999 tokens/);
  assert.match(captured.text, /2026-02: 1200008 tokens/);
  assert.match(captured.text, /Undated usage: 20 tokens, 1 session starts/);
});

test("incomplete coverage is prominent in both email bodies with nonzero exclusion counts", async () => {
  let captured;
  const handler = createHandler({
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "synthetic-incomplete-email-id" }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const submission = v2SubmissionFixture();
  submission.report.coverage.complete = false;
  submission.report.coverage.files_skipped = 1;
  submission.report.coverage.files_parsed = 1;
  submission.report.coverage.malformed_lines = 2;
  submission.report.coverage.oversized_lines = 1;
  const { response } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submission)), environment()));
  assert.equal(response.status, 202);
  assert.match(captured.text, /COVERAGE WARNING: This report is incomplete/);
  assert.match(captured.text, /Skipped files 1; Malformed lines 2; Oversized lines 1/);
  assert.match(captured.html, /<h2>Coverage warning<\/h2>/);
  assert.match(captured.html, /This report is incomplete/);
  assert.match(captured.html, /Oversized lines 1/);
});

test("400 rejects unknown and forbidden report fields before delivery", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const submission = submissionFixture();
  submission.report.prompt = "private";
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submission)), environment()));
  assert.equal(response.status, 400);
  assert.equal(body.status, "not_sent");
  assert.equal(called, false);
});

test("400 rejects recipient injection in the client envelope", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const submission = submissionFixture();
  submission.to = "attacker@example.com";
  const { response } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submission)), environment()));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("400 rejects unreconciled token totals", async () => {
  const handler = createHandler({ fetchImpl: async () => { throw new Error("must not send"); } });
  const submission = submissionFixture();
  submission.report.totals.total_tokens = 66;
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submission)), environment()));
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "invalid_reconciliation");
});

test("409 provider idempotency conflict is not reported as delivered", async () => {
  const handler = createHandler({ fetchImpl: async () => new Response(JSON.stringify({ message: "conflict" }), { status: 409, headers: { "Content-Type": "application/json" } }) });
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), environment()));
  assert.equal(response.status, 409);
  assert.equal(body.status, "not_sent_by_this_request");
  assert.equal(body.receipt_id, SUBMISSION_ID);
});

test("413 rejects a body over 256 KiB before provider delivery", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const oversized = JSON.stringify({ padding: "x".repeat(MAX_JSON_BYTES) });
  const { response, body } = await responseJson(await handler.fetch(requestFor(oversized), environment()));
  assert.equal(response.status, 413);
  assert.equal(body.error.code, "payload_too_large");
  assert.equal(called, false);
});

test("429 rate limit prevents provider delivery", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), environment(false)));
  assert.equal(response.status, 429);
  assert.equal(body.status, "not_sent");
  assert.equal(called, false);
});

test("rate-limit service failure is a truthful not-sent response", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const env = environment();
  env.SUBMIT_RATE_LIMITER.limit = async () => { throw new Error("synthetic limit failure"); };
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), env));
  assert.equal(response.status, 503);
  assert.equal(body.status, "not_sent");
  assert.equal(body.error.code, "rate_limit_unavailable");
  assert.equal(called, false);
});

test("sender secret must use the verified sending subdomain", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const env = environment();
  env.RESEND_FROM = "TOP Analyzer <reports@example.com>";
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), env));
  assert.equal(response.status, 503);
  assert.equal(body.status, "not_sent");
  assert.equal(body.error.code, "delivery_unavailable");
  assert.equal(called, false);
});

test("both fixed recipient secrets are required and accept one address each", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  for (const mutate of [
    (env) => { delete env.SUBMISSION_CC; },
    (env) => { env.SUBMISSION_TO = "first@example.com,second@example.com"; },
  ]) {
    const env = environment();
    mutate(env);
    const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), env));
    assert.equal(response.status, 503);
    assert.equal(body.status, "not_sent");
    assert.equal(body.error.code, "delivery_unavailable");
  }
  assert.equal(called, false);
});

test("upstream 500 is converted to a truthful not-sent 502", async () => {
  const handler = createHandler({ fetchImpl: async () => new Response(JSON.stringify({ message: "provider failed" }), { status: 500, headers: { "Content-Type": "application/json" } }) });
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), environment()));
  assert.equal(response.status, 502);
  assert.equal(body.status, "not_sent");
  assert.equal(body.error.code, "delivery_rejected");
});

test("an upstream success without a safe nonempty Resend message ID fails closed", async () => {
  for (const id of ["", "   ", "unsafe/id", null]) {
    const handler = createHandler({
      fetchImpl: async () => new Response(JSON.stringify({ id }), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), environment()));
    assert.equal(response.status, 502);
    assert.equal(body.status, "not_sent");
    assert.equal(body.error.code, "delivery_rejected");
  }
});

test("only the production origin receives CORS permission", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const request = requestFor(JSON.stringify(submissionFixture()), { origin: "https://evil.example" });
  const { response, body } = await responseJson(await handler.fetch(request, environment()));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(body.status, "not_sent");
  assert.equal(called, false);
});

test("custom-domain preflight passes while the retired GitHub origin and unsafe methods fail closed", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });

  const preflight = await handler.fetch(requestFor("", { method: "OPTIONS" }), environment());
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");

  const retiredOrigin = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture()), {
    origin: "https://adamhartley7.github.io",
  }), environment()));
  assert.equal(retiredOrigin.response.status, 403);
  assert.equal(retiredOrigin.response.headers.get("access-control-allow-origin"), null);
  assert.equal(retiredOrigin.body.error.code, "origin_not_allowed");

  const unsafeMethod = await responseJson(await handler.fetch(new Request("https://submit.tokenoptimisationprotocol.org/", {
    method: "PATCH",
    headers: { "Origin": ORIGIN, "Content-Type": "application/json" },
  }), environment()));
  assert.equal(unsafeMethod.response.status, 405);
  assert.equal(unsafeMethod.response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(unsafeMethod.body.error.code, "method_not_allowed");
  assert.equal(called, false);
});

test("non-JSON requests are rejected", async () => {
  const handler = createHandler({ fetchImpl: async () => { throw new Error("must not send"); } });
  const { response } = await responseJson(await handler.fetch(requestFor("plain text", { contentType: "text/plain" }), environment()));
  assert.equal(response.status, 415);
});

test("HTML escaping covers every active HTML metacharacter", () => {
  assert.equal(escapeHtml(`<script data-x="'&">`), "&lt;script data-x=&quot;&#39;&amp;&quot;&gt;");
});

test("worker source contains no report logging or persistence bindings", async () => {
  const source = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\s*\./);
  assert.doesNotMatch(source, /env\.(?:DB|D1|KV|R2)|\.put\s*\(/);
  assert.doesNotMatch(source, /SUBMISSION_TO\s*[:=]\s*["'][^"']+@/);
  assert.doesNotMatch(source, /SUBMISSION_CC\s*[:=]\s*["'][^"']+@/);
});

test("wrangler config pins the one production custom domain and disables alternate public URLs", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.name, "top-analyzer-delivery");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: "submit.tokenoptimisationprotocol.org", custom_domain: true }]);
  assert.equal(Object.hasOwn(config, "secrets"), false);
  assert.equal(Object.hasOwn(config, "vars"), false);
  assert.equal(Object.hasOwn(config, "send_email"), false);
  assert.doesNotMatch(JSON.stringify(config), /\bEMAIL\b|send_email/i);
  assert.deepEqual(config.ratelimits, [{
    name: "SUBMIT_RATE_LIMITER",
    namespace_id: "2171601",
    simple: { limit: 10, period: 60 },
  }]);
});
