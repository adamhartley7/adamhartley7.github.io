import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REAL_RETENTION_REGISTER_SCHEMA = "top.real-submission-retention-register.v1";

const RETENTION_DAYS = 30;
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const EVENTS = new Set([
  "accepted",
  "verify-entry",
  "adam-mailbox-deleted",
  "sam-mailbox-deleted",
  "early-deletion-requested",
  "early-deletion-completed",
]);

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function pathIsInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function validReceiptId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validProviderMessageId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

function validSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validUtcTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(new Date(value).getTime());
}

function validEvidenceReference(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
}

function dateOnly(value) {
  if (!validUtcTimestamp(value)) throw new Error("A real-submission request needs an exact UTC timestamp.");
  return value.slice(0, 10);
}

function deletionDueDate(requestDate) {
  const request = new Date(`${requestDate}T00:00:00.000Z`);
  if (!Number.isFinite(request.getTime()) || request.toISOString().slice(0, 10) !== requestDate) throw new Error("The request date is invalid.");
  request.setUTCDate(request.getUTCDate() + RETENTION_DAYS);
  return request.toISOString().slice(0, 10);
}

function pendingMailboxDeletion() {
  return { status: "pending", completed_at_utc: null, evidence_reference: null };
}

function pendingEarlyDeletion() {
  return {
    status: "not_requested",
    requested_at_utc: null,
    request_evidence_reference: null,
    completed_at_utc: null,
    completion_evidence_reference: null,
  };
}

function validateMailboxRecord(record, requestStart) {
  if (!exactKeys(record, ["status", "completed_at_utc", "evidence_reference"])
    || !["pending", "completed"].includes(record.status)) throw new Error("A real-submission mailbox deletion record is invalid.");
  if (record.status === "pending" && (record.completed_at_utc !== null || record.evidence_reference !== null)) throw new Error("A pending mailbox deletion cannot have completion evidence.");
  if (record.status === "completed") {
    if (!validUtcTimestamp(record.completed_at_utc) || !validEvidenceReference(record.evidence_reference)) throw new Error("A completed mailbox deletion needs a safe timestamp and evidence reference.");
    if (new Date(record.completed_at_utc) < requestStart) throw new Error("A mailbox deletion timestamp cannot precede the original request date.");
  }
}

function validateEarlyDeletion(record, requestStart, mailboxDeletion) {
  if (!exactKeys(record, ["status", "requested_at_utc", "request_evidence_reference", "completed_at_utc", "completion_evidence_reference"])
    || !["not_requested", "requested", "completed"].includes(record.status)) throw new Error("A real-submission early-deletion record is invalid.");
  if (record.status === "not_requested") {
    if ([record.requested_at_utc, record.request_evidence_reference, record.completed_at_utc, record.completion_evidence_reference].some((value) => value !== null)) {
      throw new Error("An unrequested early deletion cannot have evidence.");
    }
    return;
  }
  if (!validUtcTimestamp(record.requested_at_utc) || !validEvidenceReference(record.request_evidence_reference)) throw new Error("An early-deletion request needs a safe timestamp and evidence reference.");
  if (new Date(record.requested_at_utc) < requestStart) throw new Error("An early-deletion request timestamp cannot precede the original request date.");
  if (record.status === "requested") {
    if (record.completed_at_utc !== null || record.completion_evidence_reference !== null) throw new Error("A pending early deletion cannot have completion evidence.");
    return;
  }
  if (!validUtcTimestamp(record.completed_at_utc) || !validEvidenceReference(record.completion_evidence_reference)) throw new Error("A completed early deletion needs a safe timestamp and evidence reference.");
  if (new Date(record.completed_at_utc) < new Date(record.requested_at_utc)) throw new Error("Early-deletion completion cannot precede its request.");
  if (mailboxDeletion.adam.status !== "completed" || mailboxDeletion.sam.status !== "completed") throw new Error("Completed early deletion requires both mailbox deletions.");
  const latestRequired = Math.max(
    new Date(record.requested_at_utc).getTime(),
    new Date(mailboxDeletion.adam.completed_at_utc).getTime(),
    new Date(mailboxDeletion.sam.completed_at_utc).getTime(),
  );
  if (new Date(record.completed_at_utc).getTime() < latestRequired) throw new Error("Early-deletion completion cannot precede either mailbox deletion.");
}

export function validateRealRetentionRegister(register) {
  if (!exactKeys(register, ["schema_version", "entries"]) || register.schema_version !== REAL_RETENTION_REGISTER_SCHEMA) throw new Error("The real-submission retention register contract is invalid.");
  if (!Array.isArray(register.entries) || register.entries.length > 10000) throw new Error("The real-submission retention register entries are invalid.");
  const receiptIds = new Set();
  const providerIds = new Set();
  for (const entry of register.entries) {
    if (!exactKeys(entry, [
      "receipt_id", "provider_message_id", "report_sha256", "request_date", "deletion_due_date",
      "mailbox_deletion", "early_deletion",
    ])) throw new Error("A real-submission retention entry contains unsupported or missing fields.");
    if (!validReceiptId(entry.receipt_id) || receiptIds.has(entry.receipt_id)) throw new Error("A real-submission receipt ID is invalid or duplicated.");
    if (!validProviderMessageId(entry.provider_message_id) || providerIds.has(entry.provider_message_id)) throw new Error("A real-submission provider message ID is invalid or duplicated.");
    if (!validSha256(entry.report_sha256)) throw new Error("A real-submission report hash is invalid.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.request_date) || deletionDueDate(entry.request_date) !== entry.deletion_due_date) throw new Error("A real-submission retention date is invalid.");
    if (!exactKeys(entry.mailbox_deletion, ["adam", "sam"])) throw new Error("A real-submission mailbox deletion record is invalid.");
    const requestStart = new Date(`${entry.request_date}T00:00:00.000Z`);
    validateMailboxRecord(entry.mailbox_deletion.adam, requestStart);
    validateMailboxRecord(entry.mailbox_deletion.sam, requestStart);
    validateEarlyDeletion(entry.early_deletion, requestStart, entry.mailbox_deletion);
    receiptIds.add(entry.receipt_id);
    providerIds.add(entry.provider_message_id);
  }
  return register;
}

async function resolveRegisterPath(rawPath, { repositoryRoot = REPOSITORY_ROOT } = {}) {
  if (typeof rawPath !== "string" || !path.isAbsolute(rawPath) || path.extname(rawPath).toLowerCase() !== ".json") throw new Error("The register path must be an absolute .json path.");
  const parent = await realpath(path.dirname(path.resolve(rawPath)));
  const repository = await realpath(repositoryRoot);
  const canonical = path.join(parent, path.basename(rawPath));
  if (pathIsInside(canonical, repository)) throw new Error("The real-submission retention register must be outside the repository.");
  await access(parent, fsConstants.W_OK);
  return canonical;
}

async function registerExists(registerPath) {
  try {
    await access(registerPath, fsConstants.F_OK);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function readRegister(registerPath) {
  const register = JSON.parse(await readFile(registerPath, "utf8"));
  return validateRealRetentionRegister(register);
}

async function writeRegister(registerPath, register, { exclusive = false } = {}) {
  validateRealRetentionRegister(register);
  const serialized = `${JSON.stringify(register, null, 2)}\n`;
  if (/@/.test(serialized)) throw new Error("The real-submission retention register cannot contain an address.");
  await writeFile(registerPath, serialized, { encoding: "utf8", flag: exclusive ? "wx" : "w", mode: 0o600 });
}

function parseArguments(argv) {
  const result = {
    help: false,
    register: null,
    event: null,
    receiptId: null,
    providerMessageId: null,
    reportSha256: null,
    requestAt: null,
    at: null,
    evidenceReference: null,
  };
  const flags = new Map([
    ["--register", "register"],
    ["--event", "event"],
    ["--receipt-id", "receiptId"],
    ["--provider-message-id", "providerMessageId"],
    ["--report-sha256", "reportSha256"],
    ["--request-at", "requestAt"],
    ["--at", "at"],
    ["--evidence-reference", "evidenceReference"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      if (result.help) throw new Error("Duplicate --help flag.");
      result.help = true;
      continue;
    }
    if (!flags.has(argument)) throw new Error(`Unsupported argument: ${argument}`);
    const property = flags.get(argument);
    if (result[property] !== null) throw new Error(`Duplicate ${argument} flag.`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    result[property] = value;
    index += 1;
  }
  if (result.help && argv.length > 1) throw new Error("--help cannot be combined with other arguments.");
  return result;
}

function validateOperation(options) {
  if (!options.register || !EVENTS.has(options.event) || !validReceiptId(options.receiptId)) throw new Error("A register, supported event and client receipt UUID are required.");
  if (options.event === "accepted") {
    if (!validProviderMessageId(options.providerMessageId) || !validSha256(options.reportSha256) || !validUtcTimestamp(options.requestAt)
      || options.at !== null || options.evidenceReference !== null) throw new Error("An accepted entry needs only a provider message ID, report hash and exact request timestamp.");
    return;
  }
  if (options.event === "verify-entry") {
    if ([options.providerMessageId, options.reportSha256, options.requestAt, options.at, options.evidenceReference].some((value) => value !== null)) throw new Error("Entry verification accepts only the register and receipt ID.");
    return;
  }
  if (!validUtcTimestamp(options.at) || !validEvidenceReference(options.evidenceReference)
    || [options.providerMessageId, options.reportSha256, options.requestAt].some((value) => value !== null)) throw new Error("A deletion event needs only an exact timestamp and safe evidence reference.");
}

function usage() {
  return [
    "TOP real-submission retention register",
    "",
    "This stores safe receipt, provider, hash and deletion evidence only. It never stores a report or address and makes no network request.",
    "",
    "After one accepted real submission:",
    "  node scripts/manage-real-submission-retention.mjs --register C:\\private\\top-real-retention.json --event accepted --receipt-id <uuid> --provider-message-id <resend-id> --report-sha256 <sha256> --request-at 2026-07-17T09:00:00.000Z",
    "",
    "Before a pilot, verify its entry:",
    "  node scripts/manage-real-submission-retention.mjs --register C:\\private\\top-real-retention.json --event verify-entry --receipt-id <uuid>",
  ].join("\n");
}

export async function runRealRetention({
  argv = [],
  repositoryRoot = REPOSITORY_ROOT,
  stdout = (line) => console.log(line),
  stderr = (line) => console.error(line),
} = {}) {
  let options;
  try {
    options = parseArguments(argv);
    if (options.help) {
      stdout(usage());
      stdout("Mailbox access: none");
      stdout("Network calls: 0");
      return { exitCode: 0, networkCalls: 0 };
    }
    validateOperation(options);
    const registerPath = await resolveRegisterPath(options.register, { repositoryRoot });
    const exists = await registerExists(registerPath);
    if (!exists && options.event !== "accepted") throw new Error("Create the first accepted entry before recording or verifying retention events.");
    const register = exists
      ? await readRegister(registerPath)
      : { schema_version: REAL_RETENTION_REGISTER_SCHEMA, entries: [] };
    const existing = register.entries.find((entry) => entry.receipt_id === options.receiptId);

    if (options.event === "accepted") {
      if (existing) throw new Error("This real-submission receipt already has a retention entry.");
      if (register.entries.some((entry) => entry.provider_message_id === options.providerMessageId)) throw new Error("This provider message ID already has a retention entry.");
      const requestDate = dateOnly(options.requestAt);
      register.entries.push({
        receipt_id: options.receiptId,
        provider_message_id: options.providerMessageId,
        report_sha256: options.reportSha256,
        request_date: requestDate,
        deletion_due_date: deletionDueDate(requestDate),
        mailbox_deletion: { adam: pendingMailboxDeletion(), sam: pendingMailboxDeletion() },
        early_deletion: pendingEarlyDeletion(),
      });
      register.entries.sort((left, right) => left.request_date.localeCompare(right.request_date) || left.receipt_id.localeCompare(right.receipt_id));
      await writeRegister(registerPath, register, { exclusive: !exists });
    } else {
      if (!existing) throw new Error("No retention entry matches this real-submission receipt.");
      if (options.event === "verify-entry") {
        validateRealRetentionRegister(register);
        stdout(`Verified real-submission retention entry: ${options.receiptId}`);
        stdout(`Deletion due date: ${existing.deletion_due_date}`);
        stdout("Report content stored: no");
        stdout("Addresses stored: no");
        stdout("Mailbox access: none");
        stdout("Network calls: 0");
        return { exitCode: 0, networkCalls: 0, registerPath, register, entry: existing };
      }
      if (options.event === "adam-mailbox-deleted" || options.event === "sam-mailbox-deleted") {
        const person = options.event.startsWith("adam-") ? "adam" : "sam";
        if (existing.mailbox_deletion[person].status !== "pending") throw new Error(`${person} mailbox deletion is already completed.`);
        existing.mailbox_deletion[person] = { status: "completed", completed_at_utc: options.at, evidence_reference: options.evidenceReference };
      } else if (options.event === "early-deletion-requested") {
        if (existing.early_deletion.status !== "not_requested") throw new Error("An early-deletion request is already recorded.");
        existing.early_deletion = {
          status: "requested",
          requested_at_utc: options.at,
          request_evidence_reference: options.evidenceReference,
          completed_at_utc: null,
          completion_evidence_reference: null,
        };
      } else {
        if (existing.early_deletion.status !== "requested") throw new Error("Record an early-deletion request before its completion.");
        if (existing.mailbox_deletion.adam.status !== "completed" || existing.mailbox_deletion.sam.status !== "completed") throw new Error("Record both recipient mailbox deletions before early-deletion completion.");
        existing.early_deletion.status = "completed";
        existing.early_deletion.completed_at_utc = options.at;
        existing.early_deletion.completion_evidence_reference = options.evidenceReference;
      }
      await writeRegister(registerPath, register);
    }

    stdout(`Recorded real-submission retention event: ${options.event}`);
    stdout(`Private retention register updated: ${registerPath}`);
    stdout("Report content stored: no");
    stdout("Addresses stored: no");
    stdout("Mailbox access: none");
    stdout("Network calls: 0");
    return { exitCode: 0, networkCalls: 0, registerPath, register };
  } catch (error) {
    stderr(`Refused: ${error.message}`);
    stderr("Mailbox access: none");
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await runRealRetention({ argv: process.argv.slice(2) });
  process.exitCode = result.exitCode;
}
