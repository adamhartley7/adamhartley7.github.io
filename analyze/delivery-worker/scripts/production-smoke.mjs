import { createHash, randomUUID as defaultRandomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateResearchSafeUsage } from "../src/index.mjs";

export const PRODUCTION_ENDPOINT = "https://submit.tokenoptimisationprotocol.org/";
export const PRODUCTION_ORIGIN = "https://tokenoptimisationprotocol.org";
export const CONFIRM_SYNTHETIC = "SYNTHETIC-REPORT-ONLY";
export const CONFIRM_SEND = "SEND-ONE-PRODUCTION-SMOKE";
export const RETENTION_LOG_SCHEMA = "top.synthetic-retention-log.v1";
export const RECEIPT_ID_SEMANTICS = "client_submission_uuid_not_delivery_proof";

const RETENTION_DAYS = 30;
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const ACCEPTED_RESPONSE_KEYS = ["delivered", "message", "ok", "receipt_id", "report_sha256", "status"];

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

export function createSyntheticReport(generatedDate) {
  const report = {
    schema_version: "top.research-safe-usage.v1",
    collector: {
      collector_version: "top.local-collector.2026-07-16.1",
      parser_version: "top.usage-parser.2026-07-16.2",
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
      truth_status: "not_available",
      algorithm_version: "top.value-model.v0.2-self-reported",
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
    report_sha256: reportSha256,
    request_date: dates.request_date,
    deletion_due_date: dates.deletion_due_date,
    endpoint: PRODUCTION_ENDPOINT,
    origin: PRODUCTION_ORIGIN,
    request_attempted: false,
    http_status: null,
    accepted_status: "prepared_not_sent",
    provider_delivery_confirmed: false,
    attachment_hash_verification_status: "pending",
    attachment_hashes: [
      { slot: "received_copy_1", status: "pending", sha256: null, matches_report_sha256: null },
      { slot: "received_copy_2", status: "pending", sha256: null, matches_report_sha256: null },
    ],
  };
}

export function validateRetentionLog(log) {
  const keys = [
    "schema_version", "synthetic_only", "receipt_id", "receipt_id_semantics", "report_sha256",
    "request_date", "deletion_due_date", "endpoint", "origin", "request_attempted", "http_status",
    "accepted_status", "provider_delivery_confirmed", "attachment_hash_verification_status", "attachment_hashes",
  ];
  if (!exactKeys(log, keys)) throw new Error("The retention log has unsupported or missing fields.");
  if (log.schema_version !== RETENTION_LOG_SCHEMA || log.synthetic_only !== true || log.receipt_id_semantics !== RECEIPT_ID_SEMANTICS) throw new Error("The retention log contract is invalid.");
  if (typeof log.receipt_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(log.receipt_id)) throw new Error("The retention log receipt ID is not a client submission UUID.");
  if (typeof log.report_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(log.report_sha256)) throw new Error("The retention log report hash is invalid.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(log.request_date) || !/^\d{4}-\d{2}-\d{2}$/.test(log.deletion_due_date)) throw new Error("The retention dates are invalid.");
  if (log.endpoint !== PRODUCTION_ENDPOINT || log.origin !== PRODUCTION_ORIGIN) throw new Error("The retention log does not use the pinned production route.");
  if (typeof log.request_attempted !== "boolean") throw new Error("The request-attempted status is invalid.");
  if (log.http_status !== null && (!Number.isInteger(log.http_status) || log.http_status < 100 || log.http_status > 599)) throw new Error("The HTTP status is invalid.");
  if (!["prepared_not_sent", "request_pending_response", "accepted_for_delivery", "not_accepted", "delivery_outcome_unknown", "invalid_accepted_response"].includes(log.accepted_status)) throw new Error("The accepted status is invalid.");
  if (log.provider_delivery_confirmed !== false) throw new Error("Provider delivery must remain unconfirmed.");
  if (!["pending", "verified_match", "mismatch"].includes(log.attachment_hash_verification_status)) throw new Error("The attachment verification status is invalid.");
  if (!Array.isArray(log.attachment_hashes) || log.attachment_hashes.length !== 2) throw new Error("Exactly two attachment hash slots are required.");
  log.attachment_hashes.forEach((entry, index) => {
    if (!exactKeys(entry, ["slot", "status", "sha256", "matches_report_sha256"])) throw new Error("An attachment hash entry is invalid.");
    if (entry.slot !== `received_copy_${index + 1}` || !["pending", "verified_match", "mismatch"].includes(entry.status)) throw new Error("An attachment hash slot is invalid.");
    if (entry.sha256 !== null && (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256))) throw new Error("An attachment hash is invalid.");
    if (entry.matches_report_sha256 !== null && typeof entry.matches_report_sha256 !== "boolean") throw new Error("An attachment hash comparison is invalid.");
  });
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
  ].join("\n");
}

export async function runSmoke({
  argv = [],
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  randomUUID = defaultRandomUUID,
  repositoryRoot = REPOSITORY_ROOT,
  writeRetentionLogImpl = writeRetentionLog,
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
  try {
    logPath = await resolvePrivateRetentionLogPath(options.retentionLog, { repositoryRoot });
  } catch (error) {
    stderr(`Refused: ${error.message}`);
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }
  const retentionLog = createRetentionLog({ submissionId, reportSha256, requestedAt });
  try {
    await writeRetentionLogImpl(logPath, retentionLog, { exclusive: true });
    retentionLog.request_attempted = true;
    retentionLog.accepted_status = "request_pending_response";
    await writeRetentionLogImpl(logPath, retentionLog);
  } catch (error) {
    stderr(`Refused before network: the retention log could not be reserved (${error.message}).`);
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
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
    let retentionLogPersisted = true;
    try { await writeRetentionLogImpl(logPath, retentionLog); } catch { retentionLogPersisted = false; }
    stderr(`Delivery outcome unknown: ${error.message}. The server may have processed the request.`);
    stderr(`Private retention log: ${logPath}`);
    if (!retentionLogPersisted) stderr("The retention log could not be updated after the transport failure.");
    stderr("Do not retry automatically. Reconcile this request before another live smoke.");
    stderr(`Network calls: ${networkCalls}`);
    return { exitCode: 1, networkCalls, submission, reportJson, reportSha256, retentionLog, logPath, retentionLogPersisted, deliveryOutcome: "unknown" };
  }

  retentionLog.http_status = response.status;
  try { body = await response.json(); } catch { body = null; }
  const acceptedForDelivery = response.status === 202 && acceptedResponseIsExact(body, submissionId, reportSha256);
  retentionLog.accepted_status = acceptedForDelivery
    ? "accepted_for_delivery"
    : response.status === 202 ? "invalid_accepted_response" : "not_accepted";

  try {
    await writeRetentionLogImpl(logPath, retentionLog);
  } catch (error) {
    const responseDescription = acceptedForDelivery
      ? "An exact HTTP 202 acceptance response was received"
      : `HTTP ${response.status} was received`;
    stderr(`${responseDescription}, but the retention log update failed: ${error.message}`);
    stderr(`Private retention log may still show request_pending_response: ${logPath}`);
    stderr("Provider delivery remains unconfirmed. Stop and reconcile the local record.");
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
      retentionLogPersisted: false,
      acceptedForDelivery,
    };
  }

  if (acceptedForDelivery) {
    stdout("Synthetic request accepted for delivery.");
    stdout(`HTTP status: ${response.status}`);
    stdout(`Receipt ID: ${submissionId} (client submission UUID, not delivery proof)`);
    stdout(`Report SHA-256: ${reportSha256}`);
    stdout(`Private retention log: ${logPath}`);
    stdout("Provider delivery confirmed: false");
    stdout(`Network calls: ${networkCalls}`);
    return { exitCode: 0, networkCalls, response, responseBody: body, submission, reportJson, reportSha256, retentionLog, logPath, retentionLogPersisted: true, acceptedForDelivery: true };
  }

  stderr(`Not accepted: HTTP ${response.status}. Provider delivery remains unconfirmed.`);
  stderr(`Private retention log: ${logPath}`);
  stderr(`Network calls: ${networkCalls}`);
  return { exitCode: 1, networkCalls, response, responseBody: body, submission, reportJson, reportSha256, retentionLog, logPath, retentionLogPersisted: true, acceptedForDelivery: false };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await runSmoke({ argv: process.argv.slice(2) });
  process.exitCode = result.exitCode;
}
