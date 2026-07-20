import { createHash, randomUUID as defaultRandomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateResearchSafeUsage } from "../src/index.mjs";

export const PRODUCTION_ENDPOINT = "https://submit.tokenoptimisationprotocol.org/";
export const PRODUCTION_ORIGIN = "https://tokenoptimisationprotocol.org";
export const CONFIRM_SYNTHETIC = "SYNTHETIC-REPORT-ONLY";
export const CONFIRM_SEND = "SEND-ONE-PRODUCTION-SMOKE";
export const RETENTION_LOG_SCHEMA = "top.synthetic-retention-log.v2";
export const ATTEMPT_GUARD_SCHEMA = "top.synthetic-attempt-guard.v1";
export const RECEIPT_ID_SEMANTICS = "client_submission_uuid_not_delivery_proof";

const RETENTION_DAYS = 30;
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const DEFAULT_OPERATOR_ACCOUNT_ATTEMPT_GUARD_PATH = path.join(os.homedir(), ".top-production-smoke-attempt.json");
const ACCEPTED_RESPONSE_KEYS = ["delivered", "message", "ok", "provider_message_id", "receipt_id", "report_sha256", "status"];

function dateOnly(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("A valid request date is required.");
  return date.toISOString().slice(0, 10);
}

function retentionDates(value) {
  const request = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(request.getTime())) throw new TypeError("A valid request date is required.");
  const deletion = new Date(Date.UTC(request.getUTCFullYear(), request.getUTCMonth(), request.getUTCDate() + RETENTION_DAYS));
  return { request_date: dateOnly(request), deletion_due_date: dateOnly(deletion) };
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validProviderMessageId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

function validUtcTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(new Date(value).getTime());
}

function validEvidenceReference(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
}

function parseArguments(argv) {
  const result = {
    help: false,
    live: false,
    confirmSynthetic: null,
    confirmSend: null,
    retentionLog: null,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      if (seen.has("help")) throw new Error("Duplicate --help flag.");
      seen.add("help");
      result.help = true;
      continue;
    }
    if (argument === "--live") {
      if (seen.has("live")) throw new Error("Duplicate --live flag.");
      seen.add("live");
      result.live = true;
      continue;
    }
    const valueFlags = new Map([
      ["--confirm-synthetic", "confirmSynthetic"],
      ["--confirm-send", "confirmSend"],
      ["--retention-log", "retentionLog"],
    ]);
    if (!valueFlags.has(argument)) throw new Error(`Unsupported argument: ${argument}`);
    const property = valueFlags.get(argument);
    if (seen.has(property)) throw new Error(`Duplicate ${argument} flag.`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    seen.add(property);
    result[property] = value;
    index += 1;
  }
  if (result.help && argv.length > 1) throw new Error("--help cannot be combined with other arguments.");
  return result;
}

function pathIsInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function resolvePrivateRetentionLogPath(rawPath, {
  repositoryRoot = REPOSITORY_ROOT,
  mustExist = false,
} = {}) {
  if (typeof rawPath !== "string" || !rawPath.trim()) throw new Error("An explicit retention-log path is required.");
  if (!path.isAbsolute(rawPath)) throw new Error("The retention-log path must be absolute.");
  if (path.extname(rawPath).toLowerCase() !== ".json") throw new Error("The retention-log path must end in .json.");
  const resolved = path.resolve(rawPath);
  const parent = await realpath(path.dirname(resolved));
  const repository = await realpath(repositoryRoot);
  let canonical = path.join(parent, path.basename(resolved));
  if (pathIsInside(canonical, repository)) throw new Error("The retention log must be stored outside the repository.");
  if (mustExist) {
    canonical = await realpath(canonical);
    if (pathIsInside(canonical, repository)) throw new Error("The retention log must be stored outside the repository.");
    await access(canonical, fsConstants.R_OK | fsConstants.W_OK);
  } else {
    try {
      await access(canonical, fsConstants.F_OK);
      throw new Error("The retention-log file already exists. Choose a new path so no prior record is overwritten.");
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
    }
    await access(parent, fsConstants.W_OK);
  }
  return canonical;
}

export async function resolveOperatorAccountAttemptGuardPath(rawPath = DEFAULT_OPERATOR_ACCOUNT_ATTEMPT_GUARD_PATH, {
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  if (typeof rawPath !== "string" || !path.isAbsolute(rawPath) || path.extname(rawPath).toLowerCase() !== ".json") {
    throw new Error("The operator-account attempt-guard path must be an absolute .json path.");
  }
  const resolved = path.resolve(rawPath);
  const parent = await realpath(path.dirname(resolved));
  const repository = await realpath(repositoryRoot);
  const canonical = path.join(parent, path.basename(resolved));
  if (pathIsInside(canonical, repository)) throw new Error("The operator-account attempt guard must be stored outside the repository.");
  await access(parent, fsConstants.W_OK);
  return canonical;
}

export function createAttemptGuard({ submissionId, reportSha256, requestedAt }) {
  return {
    schema_version: ATTEMPT_GUARD_SCHEMA,
    purpose: "one_production_synthetic_attempt_for_approved_operator_account",
    consumed: true,
    outcome: "reserved_before_request",
    receipt_id: submissionId,
    report_sha256: reportSha256,
    request_date: dateOnly(requestedAt),
    provider_message_id: null,
  };
}

export function validateAttemptGuard(guard) {
  const keys = [
    "schema_version", "purpose", "consumed", "outcome", "receipt_id", "report_sha256",
    "request_date", "provider_message_id",
  ];
  if (!exactKeys(guard, keys)) throw new Error("The operator-account attempt guard has unsupported or missing fields.");
  if (guard.schema_version !== ATTEMPT_GUARD_SCHEMA
    || guard.purpose !== "one_production_synthetic_attempt_for_approved_operator_account"
    || guard.consumed !== true) throw new Error("The operator-account attempt guard contract is invalid.");
  if (![
    "reserved_before_request", "accepted_for_delivery", "not_accepted",
    "invalid_accepted_response", "delivery_outcome_unknown", "local_record_update_failed",
  ].includes(guard.outcome)) throw new Error("The operator-account attempt outcome is invalid.");
  if (typeof guard.receipt_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(guard.receipt_id)) {
    throw new Error("The operator-account attempt receipt ID is invalid.");
  }
  if (typeof guard.report_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(guard.report_sha256)) throw new Error("The operator-account attempt report hash is invalid.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(guard.request_date)) throw new Error("The operator-account attempt request date is invalid.");
  if (guard.provider_message_id !== null && !validProviderMessageId(guard.provider_message_id)) throw new Error("The operator-account attempt provider message ID is invalid.");
  if (guard.outcome === "accepted_for_delivery" && !validProviderMessageId(guard.provider_message_id)) throw new Error("An accepted operator-account attempt needs a provider message ID.");
  if (guard.outcome !== "accepted_for_delivery" && guard.provider_message_id !== null) throw new Error("Only an accepted operator-account attempt may record a provider message ID.");
  return guard;
}

export async function writeAttemptGuard(guardPath, guard, { exclusive = false } = {}) {
  validateAttemptGuard(guard);
  await writeFile(guardPath, `${JSON.stringify(guard, null, 2)}\n`, {
    encoding: "utf8",
    flag: exclusive ? "wx" : "w",
    mode: 0o600,
  });
}

export function createSyntheticReport(generatedDate) {
  const report = {
    schema_version: "top.research-safe-usage.v1",
    collector: {
      collector_version: "top.local-collector.2026-07-20.1",
      parser_version: "top.usage-parser.2026-07-20.1",
    },
    generated_date: generatedDate,
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
      files_discovered: 1,
      files_parsed: 1,
      files_with_usage: 1,
      files_skipped: 0,
      malformed_lines: 0,
      oversized_lines: 0,
      counter_resets: 0,
      duplicate_usage_records: 0,
      complete: true,
    },
    totals: {
      input_tokens: 101,
      output_tokens: 202,
      cache_write_tokens: 303,
      cache_read_tokens: 404,
      reasoning_tokens: null,
      total_tokens: 1010,
    },
    activity: {
      ai_replies: 5,
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
      reference_checked_date: generatedDate,
      unit: "usd_per_million_tokens",
      applied_rates: [],
      unpriced_model_groups: 1,
    },
    permission_mode_counts: null,
    by_model: [{
      model: "Unrecognized AI version",
      input_tokens: 101,
      output_tokens: 202,
      cache_write_tokens: 303,
      cache_read_tokens: 404,
      reasoning_tokens: null,
      total_tokens: 1010,
      events_or_replies: 5,
      cost: { status: "unavailable", usd: null },
    }],
    questionnaire: null,
    value_model: {
      truth_status: "not_provided",
      algorithm_version: "top.value-model.v0.2-self-reported",
      reason: "user_did_not_enter_both_value_inputs",
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
  validateResearchSafeUsage(report);
  return report;
}

export function serializeReport(report) {
  validateResearchSafeUsage(report);
  return JSON.stringify(report, null, 2);
}

export function createSyntheticSubmission({ generatedDate, submissionId }) {
  if (typeof submissionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) {
    throw new Error("The synthetic client submission UUID is invalid.");
  }
  return {
    submission_schema_version: "top.explicit-submission.v1",
    submission_id: submissionId,
    consent: {
      notice_version: "top.research-consent.2026-07-17.1",
      accepted: true,
      purposes: ["analyzer_validation", "forecast_calibration"],
      retention_days: RETENTION_DAYS,
    },
    report: createSyntheticReport(generatedDate),
  };
}

export function createRetentionLog({ submissionId, reportSha256, requestedAt }) {
  const dates = retentionDates(requestedAt);
  return {
    schema_version: RETENTION_LOG_SCHEMA,
    synthetic_only: true,
    receipt_id: submissionId,
    receipt_id_semantics: RECEIPT_ID_SEMANTICS,
    provider_message_id: null,
    report_sha256: reportSha256,
    request_date: dates.request_date,
    deletion_due_date: dates.deletion_due_date,
    endpoint: PRODUCTION_ENDPOINT,
    origin: PRODUCTION_ORIGIN,
    attempt_consumed: false,
    request_attempted: false,
    http_status: null,
    accepted_status: "prepared_not_sent",
    provider_delivery_confirmed: false,
    attachment_hash_verification_status: "pending",
    attachment_hashes: [
      { slot: "adam_received_attachment", status: "pending", sha256: null, matches_report_sha256: null },
      { slot: "sam_received_attachment", status: "pending", sha256: null, matches_report_sha256: null },
    ],
    report_email_retention: {
      days: RETENTION_DAYS,
      scope: "recipient_mailbox_report_email_and_attachment_only",
      provider_metadata_account_logs: "not_covered_by_this_30_day_mailbox_procedure",
    },
    mailbox_deletion: {
      adam: { status: "pending", completed_at_utc: null, evidence_reference: null },
      sam: { status: "pending", completed_at_utc: null, evidence_reference: null },
    },
    early_deletion: {
      status: "not_requested",
      requested_at_utc: null,
      request_evidence_reference: null,
      completed_at_utc: null,
      completion_evidence_reference: null,
    },
  };
}

export function validateRetentionLog(log) {
  const keys = [
    "schema_version", "synthetic_only", "receipt_id", "receipt_id_semantics", "provider_message_id",
    "report_sha256", "request_date", "deletion_due_date", "endpoint", "origin", "attempt_consumed",
    "request_attempted", "http_status", "accepted_status", "provider_delivery_confirmed",
    "attachment_hash_verification_status", "attachment_hashes", "report_email_retention",
    "mailbox_deletion", "early_deletion",
  ];
  if (!exactKeys(log, keys)) throw new Error("The retention log has unsupported or missing fields.");
  if (log.schema_version !== RETENTION_LOG_SCHEMA || log.synthetic_only !== true || log.receipt_id_semantics !== RECEIPT_ID_SEMANTICS) throw new Error("The retention log contract is invalid.");
  if (typeof log.receipt_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(log.receipt_id)) throw new Error("The retention log receipt ID is not a client submission UUID.");
  if (typeof log.report_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(log.report_sha256)) throw new Error("The retention log report hash is invalid.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(log.request_date) || !/^\d{4}-\d{2}-\d{2}$/.test(log.deletion_due_date)) throw new Error("The retention dates are invalid.");
  if (retentionDates(`${log.request_date}T00:00:00.000Z`).deletion_due_date !== log.deletion_due_date) throw new Error("The deletion due date must be exactly 30 calendar days after the request date.");
  if (log.endpoint !== PRODUCTION_ENDPOINT || log.origin !== PRODUCTION_ORIGIN) throw new Error("The retention log does not use the pinned production route.");
  if (typeof log.attempt_consumed !== "boolean") throw new Error("The attempt-consumed status is invalid.");
  if (typeof log.request_attempted !== "boolean") throw new Error("The request-attempted status is invalid.");
  if (log.http_status !== null && (!Number.isInteger(log.http_status) || log.http_status < 100 || log.http_status > 599)) throw new Error("The HTTP status is invalid.");
  if (!["prepared_not_sent", "request_pending_response", "accepted_for_delivery", "not_accepted", "delivery_outcome_unknown", "invalid_accepted_response"].includes(log.accepted_status)) throw new Error("The accepted status is invalid.");
  if (log.provider_delivery_confirmed !== false) throw new Error("Provider delivery must remain unconfirmed.");
  if (log.provider_message_id !== null && !validProviderMessageId(log.provider_message_id)) throw new Error("The provider message ID is invalid.");
  if (log.accepted_status === "accepted_for_delivery" && !validProviderMessageId(log.provider_message_id)) throw new Error("An accepted retention log needs a provider message ID.");
  if (log.accepted_status !== "accepted_for_delivery" && log.provider_message_id !== null) throw new Error("Only an accepted retention log may record a provider message ID.");
  if (log.request_attempted && !log.attempt_consumed) throw new Error("A request attempt must consume the operator-account attempt.");
  if (log.accepted_status === "prepared_not_sent" && (log.attempt_consumed || log.request_attempted || log.http_status !== null)) throw new Error("A prepared retention log cannot record an attempt or response.");
  if (log.accepted_status === "request_pending_response" && (!log.attempt_consumed || !log.request_attempted || log.http_status !== null)) throw new Error("A pending response needs one consumed request and no HTTP status yet.");
  if (log.accepted_status === "delivery_outcome_unknown" && (!log.attempt_consumed || !log.request_attempted || log.http_status !== null)) throw new Error("An unknown outcome needs one consumed request and no known HTTP status.");
  if (["accepted_for_delivery", "invalid_accepted_response", "not_accepted"].includes(log.accepted_status)
    && (!log.attempt_consumed || !log.request_attempted || log.http_status === null)) throw new Error("A known response needs one consumed request and an HTTP status.");
  if (log.accepted_status === "accepted_for_delivery" && log.http_status !== 202) throw new Error("Provider acceptance requires HTTP 202.");
  if (log.accepted_status === "invalid_accepted_response" && log.http_status !== 202) throw new Error("An invalid accepted response requires HTTP 202.");
  if (log.accepted_status === "not_accepted" && log.http_status === 202) throw new Error("HTTP 202 must be evaluated as accepted or invalid accepted response.");
  if (!["pending", "verified_match", "mismatch"].includes(log.attachment_hash_verification_status)) throw new Error("The attachment verification status is invalid.");
  if (!Array.isArray(log.attachment_hashes) || log.attachment_hashes.length !== 2) throw new Error("Exactly two attachment hash slots are required.");
  const slots = ["adam_received_attachment", "sam_received_attachment"];
  log.attachment_hashes.forEach((entry, index) => {
    if (!exactKeys(entry, ["slot", "status", "sha256", "matches_report_sha256"])) throw new Error("An attachment hash entry is invalid.");
    if (entry.slot !== slots[index] || !["pending", "verified_match", "mismatch"].includes(entry.status)) throw new Error("An attachment hash slot is invalid.");
    if (entry.sha256 !== null && (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256))) throw new Error("An attachment hash is invalid.");
    if (entry.matches_report_sha256 !== null && typeof entry.matches_report_sha256 !== "boolean") throw new Error("An attachment hash comparison is invalid.");
  });
  if (log.attachment_hash_verification_status === "pending"
    && !log.attachment_hashes.every((entry) => entry.status === "pending" && entry.sha256 === null && entry.matches_report_sha256 === null)) {
    throw new Error("Pending attachment verification cannot contain observed hashes.");
  }
  if (log.attachment_hash_verification_status === "verified_match"
    && !log.attachment_hashes.every((entry) => entry.status === "verified_match" && entry.matches_report_sha256 === true && entry.sha256 === log.report_sha256)) {
    throw new Error("Verified attachment hashes must both match the report hash.");
  }
  if (log.attachment_hash_verification_status === "mismatch"
    && (!log.attachment_hashes.some((entry) => entry.status === "mismatch" && entry.matches_report_sha256 === false)
      || log.attachment_hashes.some((entry) => entry.status === "pending"))) {
    throw new Error("A mismatched attachment result must contain two observed hashes and at least one mismatch.");
  }
  if (!exactKeys(log.report_email_retention, ["days", "scope", "provider_metadata_account_logs"])
    || log.report_email_retention.days !== RETENTION_DAYS
    || log.report_email_retention.scope !== "recipient_mailbox_report_email_and_attachment_only"
    || log.report_email_retention.provider_metadata_account_logs !== "not_covered_by_this_30_day_mailbox_procedure") {
    throw new Error("The report-email retention scope is invalid.");
  }
  if (!exactKeys(log.mailbox_deletion, ["adam", "sam"])) throw new Error("The mailbox deletion record is invalid.");
  const requestStart = new Date(`${log.request_date}T00:00:00.000Z`);
  for (const person of ["adam", "sam"]) {
    const record = log.mailbox_deletion[person];
    if (!exactKeys(record, ["status", "completed_at_utc", "evidence_reference"]) || !["pending", "completed"].includes(record.status)) {
      throw new Error("A mailbox deletion record is invalid.");
    }
    if (record.status === "pending" && (record.completed_at_utc !== null || record.evidence_reference !== null)) throw new Error("A pending mailbox deletion cannot have completion evidence.");
    if (record.status === "completed" && (!validUtcTimestamp(record.completed_at_utc) || !validEvidenceReference(record.evidence_reference))) {
      throw new Error("A completed mailbox deletion needs a timestamp and safe evidence reference.");
    }
    if (record.status === "completed" && new Date(record.completed_at_utc) < requestStart) {
      throw new Error("A mailbox deletion timestamp cannot precede the original request date.");
    }
  }
  const early = log.early_deletion;
  if (!exactKeys(early, ["status", "requested_at_utc", "request_evidence_reference", "completed_at_utc", "completion_evidence_reference"])
    || !["not_requested", "requested", "completed"].includes(early.status)) throw new Error("The early-deletion record is invalid.");
  if (early.status === "not_requested" && [early.requested_at_utc, early.request_evidence_reference, early.completed_at_utc, early.completion_evidence_reference].some((value) => value !== null)) {
    throw new Error("An unrequested early deletion cannot have evidence.");
  }
  if (["requested", "completed"].includes(early.status)
    && (!validUtcTimestamp(early.requested_at_utc) || !validEvidenceReference(early.request_evidence_reference))) {
    throw new Error("An early-deletion request needs a timestamp and safe evidence reference.");
  }
  if (["requested", "completed"].includes(early.status) && new Date(early.requested_at_utc) < requestStart) {
    throw new Error("An early-deletion request timestamp cannot precede the original request date.");
  }
  if (early.status === "requested" && (early.completed_at_utc !== null || early.completion_evidence_reference !== null)) throw new Error("A pending early deletion cannot have completion evidence.");
  if (early.status === "completed"
    && (!validUtcTimestamp(early.completed_at_utc) || !validEvidenceReference(early.completion_evidence_reference))) {
    throw new Error("A completed early deletion needs a timestamp and safe evidence reference.");
  }
  if (early.status === "completed" && new Date(early.completed_at_utc) < new Date(early.requested_at_utc)) {
    throw new Error("Early-deletion completion cannot precede its request.");
  }
  if (early.status === "completed"
    && (log.mailbox_deletion.adam.status !== "completed" || log.mailbox_deletion.sam.status !== "completed")) {
    throw new Error("A completed early deletion requires both mailbox deletions to be completed.");
  }
  if (early.status === "completed") {
    const latestRequired = Math.max(
      new Date(early.requested_at_utc).getTime(),
      new Date(log.mailbox_deletion.adam.completed_at_utc).getTime(),
      new Date(log.mailbox_deletion.sam.completed_at_utc).getTime(),
    );
    if (new Date(early.completed_at_utc).getTime() < latestRequired) {
      throw new Error("Early-deletion completion cannot precede either mailbox deletion.");
    }
  }
  return log;
}

export async function writeRetentionLog(logPath, log, { exclusive = false } = {}) {
  validateRetentionLog(log);
  await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`, {
    encoding: "utf8",
    flag: exclusive ? "wx" : "w",
    mode: 0o600,
  });
}

function acceptedResponseIsExact(body, submissionId, reportSha256) {
  if (!exactKeys(body, ACCEPTED_RESPONSE_KEYS)) return false;
  return body.ok === true
    && body.status === "accepted_for_delivery"
    && body.delivered === false
    && body.receipt_id === submissionId
    && body.report_sha256 === reportSha256
    && validProviderMessageId(body.provider_message_id)
    && typeof body.message === "string"
    && /does not confirm mailbox delivery/i.test(body.message);
}

function usage() {
  return [
    "TOP synthetic production smoke",
    "",
    "Default, zero-network dry run:",
    "  node scripts/production-smoke.mjs",
    "",
    "Live mode requires all four gates:",
    "  node scripts/production-smoke.mjs --live --confirm-synthetic SYNTHETIC-REPORT-ONLY --confirm-send SEND-ONE-PRODUCTION-SMOKE --retention-log C:\\private\\top-smoke-retention.json",
    "",
    `Endpoint is pinned to ${PRODUCTION_ENDPOINT}`,
    `Origin is pinned to ${PRODUCTION_ORIGIN}`,
    "The retention-log path must be absolute, new, writable, and outside this repository.",
    `The single-attempt guard is fixed for this operator account outside the repository at ${DEFAULT_OPERATOR_ACCOUNT_ATTEMPT_GUARD_PATH}.`,
    "Once that guard exists, no later invocation may POST, including after an unknown outcome.",
  ].join("\n");
}

export async function runSmoke({
  argv = [],
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  randomUUID = defaultRandomUUID,
  repositoryRoot = REPOSITORY_ROOT,
  writeRetentionLogImpl = writeRetentionLog,
  operatorAccountAttemptGuardPath = DEFAULT_OPERATOR_ACCOUNT_ATTEMPT_GUARD_PATH,
  writeAttemptGuardImpl = writeAttemptGuard,
  stdout = (line) => console.log(line),
  stderr = (line) => console.error(line),
} = {}) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    stderr(`Refused: ${error.message}`);
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }
  if (options.help) {
    stdout(usage());
    stdout("Network calls: 0");
    return { exitCode: 0, networkCalls: 0 };
  }

  let requestedAt;
  let submissionId;
  let submission;
  let reportJson;
  let reportSha256;
  try {
    requestedAt = now();
    const generatedDate = dateOnly(requestedAt);
    submissionId = randomUUID();
    submission = createSyntheticSubmission({ generatedDate, submissionId });
    reportJson = serializeReport(submission.report);
    reportSha256 = sha256Hex(reportJson);
  } catch (error) {
    stderr(`Refused during synthetic preparation: ${error.message}`);
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }

  if (!options.live) {
    if (options.confirmSynthetic !== null || options.confirmSend !== null) {
      stderr("Refused: live confirmations are accepted only with --live.");
      stderr("Network calls: 0");
      return { exitCode: 2, networkCalls: 0 };
    }
    if (options.retentionLog !== null) {
      try {
        await resolvePrivateRetentionLogPath(options.retentionLog, { repositoryRoot });
      } catch (error) {
        stderr(`Refused: ${error.message}`);
        stderr("Network calls: 0");
        return { exitCode: 2, networkCalls: 0 };
      }
    }
    stdout("DRY RUN ONLY. No request was made.");
    stdout(`Pinned endpoint: ${PRODUCTION_ENDPOINT}`);
    stdout(`Pinned Origin: ${PRODUCTION_ORIGIN}`);
    stdout(`Synthetic report SHA-256: ${reportSha256}`);
    stdout(`Client submission UUID preview: ${submissionId}`);
    stdout("The UUID is not delivery proof.");
    stdout("Network calls: 0");
    return { exitCode: 0, networkCalls: 0, submission, reportJson, reportSha256 };
  }

  if (options.confirmSynthetic !== CONFIRM_SYNTHETIC || options.confirmSend !== CONFIRM_SEND) {
    stderr("Refused: both independent live confirmations must match exactly.");
    stderr(`Required --confirm-synthetic value: ${CONFIRM_SYNTHETIC}`);
    stderr(`Required --confirm-send value: ${CONFIRM_SEND}`);
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }
  if (!options.retentionLog) {
    stderr("Refused: --retention-log is required for live mode.");
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }
  if (typeof fetchImpl !== "function") {
    stderr("Refused: no network implementation is available.");
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }

  let logPath;
  let guardPath;
  try {
    logPath = await resolvePrivateRetentionLogPath(options.retentionLog, { repositoryRoot });
    guardPath = await resolveOperatorAccountAttemptGuardPath(operatorAccountAttemptGuardPath, { repositoryRoot });
  } catch (error) {
    stderr(`Refused: ${error.message}`);
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }
  const retentionLog = createRetentionLog({ submissionId, reportSha256, requestedAt });
  const attemptGuard = createAttemptGuard({ submissionId, reportSha256, requestedAt });
  let guardReserved = false;
  try {
    await writeRetentionLogImpl(logPath, retentionLog, { exclusive: true });
    await writeAttemptGuardImpl(guardPath, attemptGuard, { exclusive: true });
    guardReserved = true;
    retentionLog.attempt_consumed = true;
    retentionLog.request_attempted = true;
    retentionLog.accepted_status = "request_pending_response";
    await writeRetentionLogImpl(logPath, retentionLog);
  } catch (error) {
    if (guardReserved) {
      attemptGuard.outcome = "local_record_update_failed";
      try { await writeAttemptGuardImpl(guardPath, attemptGuard); } catch {}
    }
    stderr(`Refused before network: the private records could not be reserved (${error.message}).`);
    stderr("If the operator-account attempt guard already exists, the one production synthetic attempt is consumed and must not be retried.");
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0, logPath, guardPath };
  }

  let response;
  let body = null;
  let networkCalls = 0;
  try {
    networkCalls += 1;
    response = await fetchImpl(PRODUCTION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": PRODUCTION_ORIGIN },
      body: JSON.stringify(submission),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    retentionLog.accepted_status = "delivery_outcome_unknown";
    attemptGuard.outcome = "delivery_outcome_unknown";
    let retentionLogPersisted = true;
    let attemptGuardPersisted = true;
    try { await writeRetentionLogImpl(logPath, retentionLog); } catch { retentionLogPersisted = false; }
    try { await writeAttemptGuardImpl(guardPath, attemptGuard); } catch { attemptGuardPersisted = false; }
    stderr(`Delivery outcome unknown: ${error.message}. The server may have processed the request.`);
    stderr(`Private retention log: ${logPath}`);
    if (!retentionLogPersisted) stderr("The retention log could not be updated after the transport failure.");
    if (!attemptGuardPersisted) stderr("The operator-account attempt guard could not be updated, but its reserved file still blocks another attempt.");
    stderr("Do not retry automatically. Reconcile this request before another live smoke.");
    stderr(`Network calls: ${networkCalls}`);
    return {
      exitCode: 1, networkCalls, submission, reportJson, reportSha256, retentionLog, logPath,
      guardPath, retentionLogPersisted, attemptGuardPersisted, deliveryOutcome: "unknown",
    };
  }

  retentionLog.http_status = response.status;
  try { body = await response.json(); } catch { body = null; }
  const acceptedForDelivery = response.status === 202 && acceptedResponseIsExact(body, submissionId, reportSha256);
  retentionLog.accepted_status = acceptedForDelivery
    ? "accepted_for_delivery"
    : response.status === 202 ? "invalid_accepted_response" : "not_accepted";
  retentionLog.provider_message_id = acceptedForDelivery ? body.provider_message_id : null;
  attemptGuard.outcome = retentionLog.accepted_status;
  attemptGuard.provider_message_id = retentionLog.provider_message_id;

  let retentionLogPersisted = true;
  let attemptGuardPersisted = true;
  let retentionLogError = null;
  let attemptGuardError = null;
  try {
    await writeRetentionLogImpl(logPath, retentionLog);
  } catch (error) {
    retentionLogPersisted = false;
    retentionLogError = error;
  }
  try {
    await writeAttemptGuardImpl(guardPath, attemptGuard);
  } catch (error) {
    attemptGuardPersisted = false;
    attemptGuardError = error;
  }
  if (!retentionLogPersisted || !attemptGuardPersisted) {
    const responseDescription = acceptedForDelivery
      ? "An exact HTTP 202 acceptance response was received"
      : `HTTP ${response.status} was received`;
    if (retentionLogError) stderr(`${responseDescription}, but the retention log update failed: ${retentionLogError.message}`);
    if (attemptGuardError) stderr(`${responseDescription}, but the operator-account attempt guard update failed: ${attemptGuardError.message}`);
    stderr(`Private retention log may still show request_pending_response: ${logPath}`);
    stderr(`Operator-account attempt guard remains consumed: ${guardPath}`);
    stderr("Provider mailbox delivery remains unconfirmed. Stop and reconcile the local records. Never retry this synthetic attempt.");
    stderr(`Network calls: ${networkCalls}`);
    return {
      exitCode: 1,
      networkCalls,
      response,
      responseBody: body,
      submission,
      reportJson,
      reportSha256,
      retentionLog,
      logPath,
      guardPath,
      retentionLogPersisted,
      attemptGuardPersisted,
      acceptedForDelivery,
    };
  }

  if (acceptedForDelivery) {
    stdout("Synthetic request accepted for delivery.");
    stdout(`HTTP status: ${response.status}`);
    stdout(`Receipt ID: ${submissionId} (client submission UUID, not delivery proof)`);
    stdout(`Resend provider message ID: ${body.provider_message_id} (provider acceptance, not mailbox delivery)`);
    stdout(`Report SHA-256: ${reportSha256}`);
    stdout(`Private retention log: ${logPath}`);
    stdout(`Operator-account attempt guard: ${guardPath}`);
    stdout("Provider delivery confirmed: false");
    stdout(`Network calls: ${networkCalls}`);
    return {
      exitCode: 0, networkCalls, response, responseBody: body, submission, reportJson, reportSha256,
      retentionLog, logPath, guardPath, retentionLogPersisted: true, attemptGuardPersisted: true,
      acceptedForDelivery: true,
    };
  }

  stderr(`Not accepted: HTTP ${response.status}. Provider delivery remains unconfirmed.`);
  stderr(`Private retention log: ${logPath}`);
  stderr(`Operator-account attempt guard remains consumed: ${guardPath}`);
  stderr("Do not retry this synthetic attempt.");
  stderr(`Network calls: ${networkCalls}`);
  return {
    exitCode: 1, networkCalls, response, responseBody: body, submission, reportJson, reportSha256,
    retentionLog, logPath, guardPath, retentionLogPersisted: true, attemptGuardPersisted: true,
    acceptedForDelivery: false,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await runSmoke({ argv: process.argv.slice(2) });
  process.exitCode = result.exitCode;
}
