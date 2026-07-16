const PRODUCTION_ORIGIN = "https://adamhartley7.github.io";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export const MAX_JSON_BYTES = 256 * 1024;
export const SUBMISSION_SCHEMA_VERSION = "top.explicit-submission.v1";
export const REPORT_SCHEMA_VERSION = "top.research-safe-usage.v1";

const RETENTION_DAYS = 30;
const CONSENT_NOTICE_VERSION = "top.research-consent.2026-07-16.1";
const PURPOSES = new Set(["analyzer_validation", "forecast_calibration"]);
const COLLECTOR_VERSIONS = new Set([
  "top.local-analyzer.2026-07-16.1",
  "top.local-collector.2026-07-16.1",
]);
const PARSER_VERSIONS = new Set([
  "top.usage-parser.2026-07-16.1",
  "top.usage-parser.2026-07-16.2",
]);
const COST_STATUSES = new Set([
  "unavailable",
  "partial",
  "recorded",
  "estimated",
  "mixed",
  "mixed_recorded_and_estimated",
  "partial_recorded",
]);
const PRICING_STATUSES = new Set([
  "not_applied",
  "not_needed_recorded_cost",
  "not_applied_no_recognized_rate",
  "checked_reference_rates",
  "partially_applied_checked_rates",
  "mixed_checked_and_user_edited_rates",
  "partially_applied_mixed_rate_provenance",
  "user_edited_in_tab",
  "partially_applied_user_edited_rates",
]);
const RATE_PROVENANCE = new Set([
  "checked_reference_rate",
  "derived_from_checked_reference_input",
  "user_edited_in_tab",
  "derived_from_user_edited_input",
]);
const RATE_FAMILIES = new Set([
  "Claude Opus 4.5 to 4.8",
  "Claude Opus 3, 4, or 4.1",
  "Claude Sonnet 5 promo through 31 Aug 2026",
  "Claude Sonnet 3.5 to 4.6",
  "Claude Haiku 4.5",
  "Claude Haiku 3.5",
  "Claude Fable 5",
  "GPT-5.6 Sol",
  "GPT-5.6 Terra",
  "GPT-5.6 Luna",
]);
const RATE_SOURCE_URLS = new Set([
  "https://platform.claude.com/docs/en/about-claude/pricing",
  "https://openai.com/index/gpt-5-6/",
]);
const PRIVACY_EXCLUSIONS = [
  "prompts",
  "replies",
  "code",
  "tool_output",
  "paths",
  "filenames",
  "project_and_account_identifiers",
  "email_addresses",
  "exact_timestamps",
  "original_ids",
];
const VALUE_ASSUMPTIONS = [
  "frontier_spend_is_only_a_proxy_for_work_that_might_be_routable",
  "between_25_and_50_percent_of_frontier_spend_might_move",
  "the_lower_cost_ai_is_one_fifth_of_the_flagship_price",
  "work_quality_is_unchanged_after_routing",
  "saved_budget_may_be_reinvested_in_more_ai_work",
  "the_output_value_index_is_not_measured",
];

const QUESTIONNAIRE_ENUMS = {
  what_to_improve: new Set([
    "running_out_of_ai_usage", "cannot_predict_allowance", "unsure_which_ai_setup",
    "spending_too_much", "worried_about_runaway_tasks", "want_more_account_value",
    "want_obsidian_memory", "other_unspecified",
  ]),
  kinds_of_work: new Set([
    "quick_direction", "chat_question_answer", "long_chat", "code_question_answer",
    "repository_operations", "single_file_edit", "debugging", "research_review",
    "multi_file_change", "build_feature", "bounded_agent_loop", "overnight_automated_run",
  ]),
  frequency: new Set([
    "six_plus_hours_daily", "three_plus_hours_daily", "one_plus_hours_daily", "daily",
    "several_times_weekly",
  ]),
  main_uses: new Set([
    "coding", "business_decisions", "general_questions", "web_development", "other_unspecified",
  ]),
  effort_level: new Set(["ultracode", "max", "high", "medium", "low"]),
  goals: new Set([
    "predict_cost", "spend_less", "choose_model", "bound_automated_usage",
    "understand_team_usage", "protect_private_data",
  ]),
  account_category: new Set([
    "free_individual", "paid_individual", "team_or_business", "pay_as_you_go_developer",
  ]),
};

class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
  }
}

class PayloadTooLargeError extends Error {
  constructor() {
    super("The submitted report exceeds the 256 KiB limit.");
    this.name = "PayloadTooLargeError";
  }
}

function fail(code, message) {
  throw new ValidationError(code, message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactObject(value, keys, label) {
  if (!isObject(value)) fail("invalid_schema", `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid_schema", `${label} contains unsupported or missing fields.`);
  }
}

function exactOneOfShapes(value, shapes, label) {
  if (!isObject(value)) fail("invalid_schema", `${label} must be an object.`);
  const actual = Object.keys(value).sort().join("\u0000");
  const matches = shapes.some((keys) => [...keys].sort().join("\u0000") === actual);
  if (!matches) fail("invalid_schema", `${label} contains unsupported or missing fields.`);
}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid_count", `${label} must be a nonnegative integer.`);
  return value;
}

function nullableCount(value, label) {
  if (value === null) return null;
  return count(value, label);
}

function money(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail("invalid_money", `${label} must be a nonnegative number.`);
  return value;
}

function nullableMoney(value, label) {
  if (value === null) return null;
  return money(value, label);
}

function ratio(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail("invalid_ratio", `${label} must be between zero and one.`);
  return value;
}

function oneOf(value, allowed, label) {
  if (!allowed.has(value)) fail("invalid_enum", `${label} is not supported.`);
  return value;
}

function dateOnly(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("invalid_date", `${label} must be a date only.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail("invalid_date", `${label} is not a real date.`);
}

function exactArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((item, index) => item !== expected[index])) {
    fail("invalid_schema", `${label} does not match the approved list.`);
  }
}

function enumArray(value, allowed, label, maximum = 32) {
  if (!Array.isArray(value) || value.length > maximum) fail("invalid_schema", `${label} must be a bounded list.`);
  const seen = new Set();
  for (const item of value) {
    oneOf(item, allowed, label);
    if (seen.has(item)) fail("invalid_schema", `${label} must not contain duplicates.`);
    seen.add(item);
  }
}

function safeModelLabel(value) {
  if (typeof value !== "string" || !value || value.length > 160) return false;
  if (/^(?:claude\.ai \(est\.\)|ChatGPT export \(est\.\)|Unknown Codex model|Unrecognized AI version)$/i.test(value)) return true;
  if (/^claude-(?:(?:opus|sonnet|haiku|fable|mythos)-\d{1,2}(?:-\d{1,2}){0,2}|\d{1,2}(?:-\d{1,2}){0,2}-(?:opus|sonnet|haiku|fable|mythos))$/i.test(value)) return true;
  if (/^gpt-\d{1,2}(?:[.-]\d{1,2})*(?:-(?:sol|terra|luna|mini|nano|codex(?:-mini)?|chat|pro|turbo|preview))?$/i.test(value)) return true;
  if (/^o[1-9](?:-(?:mini|pro|preview|latest))?$/i.test(value)) return true;
  if (/^deepseek-v\d{1,2}(?:[.-]\d{1,2})*(?:-(?:pro|lite|chat|coder|reasoner))?$/i.test(value)) return true;
  return /^codex-(?:mini|large|latest)(?:-latest)?$/i.test(value);
}

function validateCollector(value) {
  exactObject(value, ["collector_version", "parser_version"], "collector");
  oneOf(value.collector_version, COLLECTOR_VERSIONS, "collector version");
  oneOf(value.parser_version, PARSER_VERSIONS, "parser version");
}

function validateSource(value) {
  exactObject(value, ["provider", "surface", "input_form"], "source");
  const valid = new Set([
    "anthropic|claude_code|locally_cleaned_usage_export",
    "anthropic|claude_code|validated_top_safe_usage_export",
    "anthropic|claude_code|local_session_usage_records",
    "openai|codex|validated_top_safe_usage_export",
    "openai|codex|local_session_usage_records",
    "openai|chatgpt|conversation_export",
    "anthropic|claude_chat|conversation_export",
    "anthropic|console|console_csv_export",
  ]);
  oneOf(`${value.provider}|${value.surface}|${value.input_form}`, valid, "source combination");
}

function validateMeasurement(value, source) {
  exactObject(value, ["token_basis", "cache_basis", "reasoning_basis", "cost_basis"], "measurement");
  const expected = {
    claude_code: ["recorded_usage_counters", "recorded_usage_counters", "not_separately_available", "checked_pay_as_you_go_rate_comparison"],
    codex: ["recorded_usage_counters", "recorded_usage_counters", "recorded_subset_of_output", "checked_pay_as_you_go_rate_comparison"],
    claude_chat: ["estimated_from_visible_message_text", "not_available", "not_available", "not_available"],
    chatgpt: ["estimated_from_visible_message_text", "not_available", "not_available", "not_available"],
  }[source.surface];
  const actual = [value.token_basis, value.cache_basis, value.reasoning_basis, value.cost_basis];
  if (source.surface === "console") {
    const validCost = new Set(["recorded_in_export", "recorded_where_present_then_checked_rates_for_recognized_missing_rows"]);
    if (actual[0] !== "exported_columns_where_present" || actual[1] !== "exported_columns_where_present" || actual[2] !== "not_available" || !validCost.has(actual[3])) {
      fail("invalid_schema", "measurement does not match the selected source.");
    }
  } else if (!expected || actual.some((item, index) => item !== expected[index])) {
    fail("invalid_schema", "measurement does not match the selected source.");
  }
}

function validateScope(value) {
  exactObject(value, ["selection", "full_account_or_subscription_claim", "original_source_content_included"], "scope");
  if (value.selection !== "supported_records_in_user_selected_local_data" || value.full_account_or_subscription_claim !== false || value.original_source_content_included !== false) {
    fail("invalid_schema", "scope contains an unsupported claim.");
  }
}

function validateCoverage(value) {
  const base = ["status", "files_opened"];
  const local = [...base, "files_discovered", "files_parsed", "files_with_usage", "files_skipped", "malformed_lines", "oversized_lines", "counter_resets", "duplicate_usage_records", "complete"];
  const codex = [...base, "files_selected", "files_parsed", "files_with_usage", "files_skipped", "malformed_lines", "oversized_lines", "counter_resets", "complete"];
  const chat = [...base, "records_ignored", "messages_ignored", "duplicate_records_skipped"];
  const csv = [...base, "rows_with_recorded_cost", "rows_without_recorded_cost"];
  const generic = [...base, "usage_records"];
  exactOneOfShapes(value, [local, codex, chat, csv, generic], "coverage");
  nullableCount(value.files_opened, "coverage.files_opened");
  const keys = Object.keys(value).filter((key) => !["status", "files_opened", "complete"].includes(key));
  for (const key of keys) count(value[key], `coverage.${key}`);
  if (Object.hasOwn(value, "complete") && typeof value.complete !== "boolean") fail("invalid_schema", "coverage.complete must be a boolean.");
  if (value.status === "available_from_local_collector") {
    if (Object.keys(value).length !== local.length) fail("invalid_schema", "coverage status and fields do not match.");
    if (value.files_parsed + value.files_skipped !== value.files_discovered || value.files_with_usage > value.files_parsed) fail("invalid_reconciliation", "coverage file counts do not reconcile.");
  } else if (value.status === "available") {
    if (Object.keys(value).length !== codex.length) fail("invalid_schema", "coverage status and fields do not match.");
    if (value.files_parsed + value.files_skipped !== value.files_selected || value.files_with_usage > value.files_parsed) fail("invalid_reconciliation", "coverage file counts do not reconcile.");
  } else if (value.status !== "limited_to_current_parser_checks") {
    fail("invalid_enum", "coverage status is not supported.");
  }
}

const TOTAL_KEYS = ["input_tokens", "output_tokens", "cache_write_tokens", "cache_read_tokens", "reasoning_tokens", "total_tokens"];

function validateTotals(value, label) {
  exactObject(value, TOTAL_KEYS, label);
  count(value.input_tokens, `${label}.input_tokens`);
  count(value.output_tokens, `${label}.output_tokens`);
  nullableCount(value.cache_write_tokens, `${label}.cache_write_tokens`);
  nullableCount(value.cache_read_tokens, `${label}.cache_read_tokens`);
  nullableCount(value.reasoning_tokens, `${label}.reasoning_tokens`);
  count(value.total_tokens, `${label}.total_tokens`);
  if (value.reasoning_tokens !== null && value.reasoning_tokens > value.output_tokens) fail("invalid_reconciliation", `${label} reasoning tokens exceed output tokens.`);
  const expected = value.input_tokens + value.output_tokens + (value.cache_write_tokens || 0) + (value.cache_read_tokens || 0);
  if (!Number.isSafeInteger(expected) || value.total_tokens !== expected) fail("invalid_reconciliation", `${label} token totals do not reconcile.`);
}

function validateActivity(value) {
  exactObject(value, ["ai_replies", "usage_events", "console_records", "text_messages", "sessions", "active_days"], "activity");
  for (const key of Object.keys(value)) nullableCount(value[key], `activity.${key}`);
}

function validateCost(value, label) {
  exactObject(value, ["status", "usd"], label);
  oneOf(value.status, COST_STATUSES, `${label}.status`);
  nullableMoney(value.usd, `${label}.usd`);
  if (value.status === "unavailable" && value.usd !== null) fail("invalid_schema", `${label} cannot price an unavailable row.`);
  if (value.status !== "unavailable" && value.usd === null) fail("invalid_schema", `${label} is missing its priced amount.`);
}

function validateRate(value, index) {
  const label = `pricing.applied_rates[${index}]`;
  exactObject(value, ["model", "rate_family", "input_usd_per_million", "cache_write_usd_per_million", "cache_read_usd_per_million", "output_usd_per_million", "field_provenance", "reference_source_url"], label);
  if (!safeModelLabel(value.model)) fail("unsafe_model_label", `${label}.model is not permitted.`);
  oneOf(value.rate_family, RATE_FAMILIES, `${label}.rate_family`);
  for (const key of ["input_usd_per_million", "cache_write_usd_per_million", "cache_read_usd_per_million", "output_usd_per_million"]) money(value[key], `${label}.${key}`);
  exactObject(value.field_provenance, ["input", "cache_write", "cache_read", "output"], `${label}.field_provenance`);
  for (const key of Object.keys(value.field_provenance)) oneOf(value.field_provenance[key], RATE_PROVENANCE, `${label}.field_provenance.${key}`);
  oneOf(value.reference_source_url, RATE_SOURCE_URLS, `${label}.reference_source_url`);
}

function validatePricing(value, modelCount) {
  exactObject(value, ["status", "reference_checked_date", "unit", "applied_rates", "unpriced_model_groups"], "pricing");
  oneOf(value.status, PRICING_STATUSES, "pricing.status");
  dateOnly(value.reference_checked_date, "pricing.reference_checked_date");
  if (value.unit !== "usd_per_million_tokens") fail("invalid_enum", "pricing unit is not supported.");
  if (!Array.isArray(value.applied_rates) || value.applied_rates.length > 64) fail("invalid_schema", "pricing.applied_rates must be a bounded list.");
  value.applied_rates.forEach(validateRate);
  count(value.unpriced_model_groups, "pricing.unpriced_model_groups");
  if (value.unpriced_model_groups > modelCount) fail("invalid_reconciliation", "unpriced model count exceeds model rows.");
}

function validatePermissionModes(value) {
  if (value === null) return;
  if (!isObject(value)) fail("invalid_schema", "permission_mode_counts must be null or an object.");
  const allowed = new Set(["default", "accept_edits", "bypass_permissions", "plan", "dont_ask", "unrecognized"]);
  if (Object.keys(value).length > allowed.size) fail("invalid_schema", "permission_mode_counts has too many fields.");
  for (const [key, raw] of Object.entries(value)) {
    oneOf(key, allowed, "permission mode");
    count(raw, `permission_mode_counts.${key}`);
  }
}

function validateQuestionnaire(value) {
  if (value === null) return;
  exactObject(value, ["what_to_improve", "source_selected", "route_selected", "kinds_of_work", "frequency", "main_uses", "effort_level", "goals", "account_category"], "questionnaire");
  for (const [key, allowed] of Object.entries(QUESTIONNAIRE_ENUMS)) enumArray(value[key], allowed, `questionnaire.${key}`);
  oneOf(value.source_selected, new Set(["claude_code", "codex", "claude_console", "claude_chat", "chatgpt", "unrecognized"]), "questionnaire.source_selected");
  oneOf(value.route_selected, new Set(["show_report_first", "make_shareable_summary", "not_selected"]), "questionnaire.route_selected");
}

function validateValueModel(value) {
  if (!isObject(value)) fail("invalid_schema", "value_model must be an object.");
  if (value.truth_status === "not_available") {
    exactObject(value, ["truth_status", "algorithm_version", "reason"], "value_model");
    if (value.algorithm_version !== "top.value-model.v0.1-illustrative") fail("invalid_enum", "value model version is not supported.");
    oneOf(value.reason, new Set(["current_report_not_eligible", "scenario_control_not_shown_for_this_route"]), "value_model.reason");
    return;
  }
  exactObject(value, ["truth_status", "algorithm_version", "inputs", "assumptions", "outputs"], "value_model");
  if (value.truth_status !== "illustrative_unvalidated" || value.algorithm_version !== "top.value-model.v0.1-illustrative") fail("invalid_enum", "value model status or version is not supported.");
  exactObject(value.inputs, ["baseline_cost_usd", "frontier_model_cost_usd", "frontier_model_cost_share", "scenario_slider", "work_moved_share_low", "work_moved_share_high", "work_moved_share_current", "flagship_to_lower_cost_ratio_low", "flagship_to_lower_cost_ratio_high", "flagship_to_lower_cost_ratio_current"], "value_model.inputs");
  money(value.inputs.baseline_cost_usd, "value_model.inputs.baseline_cost_usd");
  money(value.inputs.frontier_model_cost_usd, "value_model.inputs.frontier_model_cost_usd");
  for (const key of ["frontier_model_cost_share", "scenario_slider", "work_moved_share_low", "work_moved_share_high", "work_moved_share_current"]) ratio(value.inputs[key], `value_model.inputs.${key}`);
  for (const key of ["flagship_to_lower_cost_ratio_low", "flagship_to_lower_cost_ratio_high", "flagship_to_lower_cost_ratio_current"]) money(value.inputs[key], `value_model.inputs.${key}`);
  exactArray(value.assumptions, VALUE_ASSUMPTIONS, "value_model.assumptions");
  exactObject(value.outputs, ["illustrative_cost_after_routing_usd", "illustrative_saving_usd", "illustrative_saving_range_low_usd", "illustrative_saving_range_high_usd", "chart_cost_index_after_routing", "chart_output_value_index"], "value_model.outputs");
  for (const key of ["illustrative_cost_after_routing_usd", "illustrative_saving_usd", "illustrative_saving_range_low_usd", "illustrative_saving_range_high_usd"]) money(value.outputs[key], `value_model.outputs.${key}`);
  nullableMoney(value.outputs.chart_cost_index_after_routing, "value_model.outputs.chart_cost_index_after_routing");
  money(value.outputs.chart_output_value_index, "value_model.outputs.chart_output_value_index");
}

function validatePrivacy(value) {
  exactObject(value, ["network_delivery", "inspect_before_attaching", "excluded"], "privacy");
  if (value.network_delivery !== "none" || value.inspect_before_attaching !== true) fail("invalid_schema", "privacy describes an unsupported local preparation state.");
  exactArray(value.excluded, PRIVACY_EXCLUSIONS, "privacy.excluded");
}

function validateByModel(value, totals, cost) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) fail("invalid_schema", "by_model must contain between one and 64 rows.");
  const sums = Object.fromEntries(TOTAL_KEYS.map((key) => [key, 0]));
  let costSum = 0;
  let pricedRows = 0;
  const models = value.map((row) => isObject(row) ? row.model : null);
  if (models.some((model) => typeof model !== "string") || new Set(models).size !== models.length || models.some((model, index) => model !== [...models].sort()[index])) {
    fail("invalid_reconciliation", "model rows must be uniquely sorted.");
  }
  for (let index = 0; index < value.length; index++) {
    const row = value[index];
    const label = `by_model[${index}]`;
    exactObject(row, ["model", ...TOTAL_KEYS, "events_or_replies", "cost"], label);
    if (!safeModelLabel(row.model)) fail("unsafe_model_label", `${label}.model is not permitted.`);
    validateTotals(Object.fromEntries(TOTAL_KEYS.map((key) => [key, row[key]])), label);
    count(row.events_or_replies, `${label}.events_or_replies`);
    validateCost(row.cost, `${label}.cost`);
    for (const key of TOTAL_KEYS) {
      if (row[key] === null) {
        if (totals[key] !== null) fail("invalid_reconciliation", `${label}.${key} cannot be null when the total is present.`);
      } else {
        if (totals[key] === null) fail("invalid_reconciliation", `${label}.${key} must be null when the total is unavailable.`);
        sums[key] += row[key];
        if (!Number.isSafeInteger(sums[key])) fail("invalid_count", "model totals exceed the supported range.");
      }
    }
    if (row.cost.usd !== null) {
      pricedRows++;
      costSum += row.cost.usd;
    }
  }
  for (const key of TOTAL_KEYS) if (totals[key] !== null && sums[key] !== totals[key]) fail("invalid_reconciliation", `model rows do not reconcile with totals.${key}.`);
  if (cost.usd === null && pricedRows) fail("invalid_reconciliation", "priced model rows exist without a report cost.");
  if (cost.usd !== null && (!pricedRows || Math.abs(costSum - cost.usd) > 0.00001)) fail("invalid_reconciliation", "model costs do not reconcile with report cost.");
}

export function validateResearchSafeUsage(report) {
  exactObject(report, ["schema_version", "collector", "generated_date", "source", "measurement", "scope", "coverage", "totals", "activity", "cost", "pricing", "permission_mode_counts", "by_model", "questionnaire", "value_model", "privacy"], "report");
  if (report.schema_version !== REPORT_SCHEMA_VERSION) fail("unsupported_report_version", "The research-safe report version is not supported.");
  validateCollector(report.collector);
  dateOnly(report.generated_date, "generated_date");
  validateSource(report.source);
  validateMeasurement(report.measurement, report.source);
  validateScope(report.scope);
  validateCoverage(report.coverage);
  validateTotals(report.totals, "totals");
  validateActivity(report.activity);
  exactObject(report.cost, ["status", "usd", "basis", "currency", "subscription_bill"], "cost");
  oneOf(report.cost.status, COST_STATUSES, "cost.status");
  nullableMoney(report.cost.usd, "cost.usd");
  if (report.cost.currency !== "USD" || report.cost.subscription_bill !== false) fail("invalid_schema", "cost contains an unsupported currency or subscription claim.");
  oneOf(report.cost.basis, new Set(["not_available", "recorded_in_export", "recorded_and_or_estimated_where_possible", "estimated_pay_as_you_go_comparison"]), "cost.basis");
  if (report.cost.status === "unavailable" && report.cost.usd !== null) fail("invalid_schema", "unavailable report cost must be null.");
  if (report.cost.status !== "unavailable" && report.cost.usd === null) fail("invalid_schema", "priced report cost is missing its amount.");
  validatePricing(report.pricing, report.by_model.length);
  validatePermissionModes(report.permission_mode_counts);
  validateByModel(report.by_model, report.totals, report.cost);
  const unpriced = report.by_model.filter((row) => row.cost.status === "unavailable").length;
  if (unpriced !== report.pricing.unpriced_model_groups) fail("invalid_reconciliation", "unpriced model count does not reconcile.");
  validateQuestionnaire(report.questionnaire);
  validateValueModel(report.value_model);
  validatePrivacy(report.privacy);
  return true;
}

function validateConsent(value) {
  exactObject(value, ["notice_version", "accepted", "purposes", "retention_days"], "consent");
  if (value.notice_version !== CONSENT_NOTICE_VERSION || value.accepted !== true || value.retention_days !== RETENTION_DAYS) fail("invalid_consent", "The approved consent notice was not accepted.");
  enumArray(value.purposes, PURPOSES, "consent.purposes", PURPOSES.size);
  if (!value.purposes.length) fail("invalid_consent", "At least one research purpose must be accepted.");
}

function validateSubmission(value) {
  exactObject(value, ["submission_schema_version", "submission_id", "consent", "report"], "submission");
  if (value.submission_schema_version !== SUBMISSION_SCHEMA_VERSION) fail("unsupported_submission_version", "The submission version is not supported.");
  if (typeof value.submission_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.submission_id)) fail("invalid_submission_id", "The submission identifier is invalid.");
  validateConsent(value.consent);
  validateResearchSafeUsage(value.report);
  return true;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function parseFixedRecipients(raw, required) {
  const values = String(raw || "").split(",").map((item) => item.trim()).filter(Boolean);
  if ((!values.length && required) || values.length > 3) throw new Error("Delivery recipient configuration is invalid.");
  const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
  if (!values.every((item) => emailPattern.test(item))) throw new Error("Delivery recipient configuration is invalid.");
  return values;
}

function configuredDelivery(env) {
  if (!env || typeof env.RESEND_API_KEY !== "string" || !env.RESEND_API_KEY || typeof env.RESEND_FROM !== "string" || !env.RESEND_FROM) {
    throw new Error("Delivery service is not configured.");
  }
  if (!/^[^\r\n<>]+ <[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+>$/i.test(env.RESEND_FROM)) {
    throw new Error("Delivery sender configuration is invalid.");
  }
  const to = parseFixedRecipients(env.SUBMISSION_TO, true);
  const cc = parseFixedRecipients(env.SUBMISSION_CC, false);
  return { to, cc };
}

function corsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin === PRODUCTION_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = PRODUCTION_ORIGIN;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

function jsonResponse(status, body, origin) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

async function readBodyLimited(request) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) fail("invalid_content_length", "The request length is invalid.");
    if (length > MAX_JSON_BYTES) throw new PayloadTooLargeError();
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("invalid_encoding", "The request body must be valid UTF-8 JSON.");
  }
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  return btoa(binary);
}

function buildEmailText(submission, reportHash) {
  const report = submission.report;
  const purposes = submission.consent.purposes.join(", ");
  return [
    "TOP research-safe usage submission",
    `Receipt: ${submission.submission_id}`,
    `Report SHA-256: ${reportHash}`,
    `Source: ${report.source.provider} ${report.source.surface}`,
    `Generated date: ${report.generated_date}`,
    `Total tokens: ${report.totals.total_tokens}`,
    `Input tokens: ${report.totals.input_tokens}`,
    `Output tokens: ${report.totals.output_tokens}`,
    `Cache write tokens: ${report.totals.cache_write_tokens === null ? "not available" : report.totals.cache_write_tokens}`,
    `Cache read tokens: ${report.totals.cache_read_tokens === null ? "not available" : report.totals.cache_read_tokens}`,
    `Cost status: ${report.cost.status}`,
    `Cost USD: ${report.cost.usd === null ? "not available" : report.cost.usd}`,
    `Consent purposes: ${purposes}`,
    `Consent notice: ${submission.consent.notice_version}`,
    `Retention acknowledged: ${submission.consent.retention_days} days`,
    "",
    "The attached JSON is the exact validated research-safe report. It excludes prompts, replies, code, tool output, paths, filenames, project and account identifiers, email addresses, exact timestamps and original IDs.",
  ].join("\n");
}

function buildEmailHtml(submission, reportHash) {
  const report = submission.report;
  const modelRows = report.by_model.map((row) => `<tr><td>${escapeHtml(row.model)}</td><td>${row.total_tokens}</td><td>${escapeHtml(row.cost.status)}</td><td>${row.cost.usd === null ? "Not available" : row.cost.usd}</td></tr>`).join("");
  return `<!doctype html><html><body><h1>TOP research-safe usage submission</h1><p><strong>Receipt:</strong> ${escapeHtml(submission.submission_id)}</p><p><strong>Report SHA-256:</strong> ${escapeHtml(reportHash)}</p><p><strong>Source:</strong> ${escapeHtml(report.source.provider)} ${escapeHtml(report.source.surface)}</p><p><strong>Generated date:</strong> ${escapeHtml(report.generated_date)}</p><h2>Usage totals</h2><ul><li>Total tokens: ${report.totals.total_tokens}</li><li>Input tokens: ${report.totals.input_tokens}</li><li>Output tokens: ${report.totals.output_tokens}</li><li>Cache write tokens: ${report.totals.cache_write_tokens === null ? "Not available" : report.totals.cache_write_tokens}</li><li>Cache read tokens: ${report.totals.cache_read_tokens === null ? "Not available" : report.totals.cache_read_tokens}</li></ul><h2>By model</h2><table><thead><tr><th>Model</th><th>Total tokens</th><th>Cost status</th><th>Cost USD</th></tr></thead><tbody>${modelRows}</tbody></table><p>The attached JSON is the exact validated research-safe report. It contains no original history file.</p></body></html>`;
}

async function sendWithResend(fetchImpl, env, submission) {
  const { to, cc } = configuredDelivery(env);
  const reportJson = JSON.stringify(submission.report, null, 2);
  const reportHash = await sha256Hex(reportJson);
  const filename = `top-research-safe-usage-${submission.report.generated_date}-${submission.submission_id.slice(0, 8)}.json`;
  const email = {
    from: env.RESEND_FROM,
    to,
    subject: `TOP research-safe usage submission ${submission.submission_id.slice(0, 8)}`,
    text: buildEmailText(submission, reportHash),
    html: buildEmailHtml(submission, reportHash),
    attachments: [{ filename, content: base64Utf8(reportJson) }],
  };
  if (cc.length) email.cc = cc;
  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `top-usage/${submission.submission_id}`,
    },
    body: JSON.stringify(email),
  });
  let result = null;
  try { result = await response.json(); } catch { result = null; }
  return { response, result, reportHash };
}

export function createHandler({ fetchImpl = fetch } = {}) {
  return {
    async fetch(request, env) {
      const origin = request.headers.get("origin") || "";
      if (origin !== PRODUCTION_ORIGIN) {
        return jsonResponse(403, { ok: false, status: "not_sent", error: { code: "origin_not_allowed", message: "This endpoint accepts submissions only from the production TOP analyzer." } }, origin);
      }
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
      if (request.method !== "POST") return jsonResponse(405, { ok: false, status: "not_sent", error: { code: "method_not_allowed", message: "Use POST to submit a reviewed report." } }, origin);
      const contentType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "application/json") return jsonResponse(415, { ok: false, status: "not_sent", error: { code: "json_required", message: "The submission must be JSON." } }, origin);
      if (!env || !env.SUBMIT_RATE_LIMITER || typeof env.SUBMIT_RATE_LIMITER.limit !== "function") {
        return jsonResponse(503, { ok: false, status: "not_sent", error: { code: "delivery_not_configured", message: "TOP direct delivery is not configured." } }, origin);
      }
      let rate;
      try {
        rate = await env.SUBMIT_RATE_LIMITER.limit({ key: "top-analyzer-explicit-submit" });
      } catch {
        return jsonResponse(503, { ok: false, status: "not_sent", error: { code: "rate_limit_unavailable", message: "Direct delivery is unavailable. Keep your downloaded copy and try again later." } }, origin);
      }
      if (!rate || rate.success !== true) return jsonResponse(429, { ok: false, status: "not_sent", error: { code: "rate_limited", message: "Too many reports are being submitted. Keep your downloaded copy and try again later." } }, origin);
      let submission;
      try {
        const raw = await readBodyLimited(request);
        if (!raw) fail("empty_body", "The submission body is empty.");
        try { submission = JSON.parse(raw); } catch { fail("invalid_json", "The submission is not valid JSON."); }
        validateSubmission(submission);
      } catch (error) {
        if (error instanceof PayloadTooLargeError) return jsonResponse(413, { ok: false, status: "not_sent", error: { code: "payload_too_large", message: error.message } }, origin);
        if (error instanceof ValidationError) return jsonResponse(400, { ok: false, status: "not_sent", error: { code: error.code, message: error.message } }, origin);
        return jsonResponse(500, { ok: false, status: "not_sent", error: { code: "validation_failed", message: "TOP could not validate this report. Nothing was sent." } }, origin);
      }
      try {
        const { response, result, reportHash } = await sendWithResend(fetchImpl, env, submission);
        if (response.ok && result && typeof result.id === "string" && result.id) {
          return jsonResponse(202, { ok: true, status: "accepted_for_delivery", delivered: false, receipt_id: submission.submission_id, report_sha256: reportHash, message: "TOP accepted the reviewed report for email delivery. This does not confirm mailbox delivery." }, origin);
        }
        if (response.status === 409) return jsonResponse(409, { ok: false, status: "not_sent_by_this_request", receipt_id: submission.submission_id, error: { code: "idempotency_conflict", message: "This submission identifier is already in use. Delivery was not confirmed by this request." } }, origin);
        if (response.status === 429) return jsonResponse(429, { ok: false, status: "not_sent", receipt_id: submission.submission_id, error: { code: "delivery_rate_limited", message: "The email service is temporarily rate limited. Keep your downloaded copy and try again later." } }, origin);
        return jsonResponse(502, { ok: false, status: "not_sent", receipt_id: submission.submission_id, error: { code: "delivery_rejected", message: "The email service did not accept this report. Keep your downloaded copy and try again later." } }, origin);
      } catch {
        return jsonResponse(503, { ok: false, status: "not_sent", receipt_id: submission.submission_id, error: { code: "delivery_unavailable", message: "Direct delivery is unavailable. Keep your downloaded copy and try again later." } }, origin);
      }
    },
  };
}

export default createHandler();
