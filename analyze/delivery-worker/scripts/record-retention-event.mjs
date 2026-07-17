import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  resolvePrivateRetentionLogPath,
  validateRetentionLog,
} from "./production-smoke.mjs";

const EVENTS = new Set([
  "adam-mailbox-deleted",
  "sam-mailbox-deleted",
  "early-deletion-requested",
  "early-deletion-completed",
]);

function parseArguments(argv) {
  const result = { help: false, retentionLog: null, event: null, at: null, evidenceReference: null };
  const flags = new Map([
    ["--retention-log", "retentionLog"],
    ["--event", "event"],
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

function usage() {
  return [
    "TOP retention event recorder",
    "",
    "This updates one private retention log. It does not access a mailbox or make a network request.",
    "",
    "Events: adam-mailbox-deleted, sam-mailbox-deleted, early-deletion-requested, early-deletion-completed",
    "",
    "  node scripts/record-retention-event.mjs --retention-log C:\\private\\top-smoke-retention.json --event adam-mailbox-deleted --at 2026-08-16T09:00:00.000Z --evidence-reference adam-mailbox-delete-2026-08-16",
  ].join("\n");
}

export async function runRetentionEvent({
  argv = [],
  repositoryRoot,
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
  if (!options.retentionLog || !EVENTS.has(options.event) || !options.at || !options.evidenceReference) {
    stderr("Refused: a retention log, supported event, UTC timestamp, and safe evidence reference are required.");
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }

  try {
    const logPath = await resolvePrivateRetentionLogPath(options.retentionLog, { repositoryRoot, mustExist: true });
    const log = JSON.parse(await readFile(logPath, "utf8"));
    validateRetentionLog(log);
    if (log.http_status !== 202 || log.accepted_status !== "accepted_for_delivery" || !log.provider_message_id) {
      throw new Error("Retention events require an accepted synthetic request with a provider message ID.");
    }

    if (options.event === "adam-mailbox-deleted" || options.event === "sam-mailbox-deleted") {
      const person = options.event.startsWith("adam-") ? "adam" : "sam";
      if (log.mailbox_deletion[person].status !== "pending") throw new Error(`${person} mailbox deletion is already completed.`);
      log.mailbox_deletion[person] = {
        status: "completed",
        completed_at_utc: options.at,
        evidence_reference: options.evidenceReference,
      };
    } else if (options.event === "early-deletion-requested") {
      if (log.early_deletion.status !== "not_requested") throw new Error("An early-deletion request is already recorded.");
      log.early_deletion = {
        status: "requested",
        requested_at_utc: options.at,
        request_evidence_reference: options.evidenceReference,
        completed_at_utc: null,
        completion_evidence_reference: null,
      };
    } else {
      if (log.early_deletion.status !== "requested") throw new Error("Record an early-deletion request before its completion.");
      if (log.mailbox_deletion.adam.status !== "completed" || log.mailbox_deletion.sam.status !== "completed") {
        throw new Error("Record both recipient mailbox deletions before early-deletion completion.");
      }
      log.early_deletion.status = "completed";
      log.early_deletion.completed_at_utc = options.at;
      log.early_deletion.completion_evidence_reference = options.evidenceReference;
    }

    validateRetentionLog(log);
    await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`, { encoding: "utf8", flag: "w", mode: 0o600 });
    stdout(`Recorded retention event: ${options.event}`);
    stdout(`Private retention log updated: ${logPath}`);
    stdout("Mailbox access: none");
    stdout("Network calls: 0");
    return { exitCode: 0, networkCalls: 0, logPath, log };
  } catch (error) {
    stderr(`Refused: ${error.message}`);
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await runRetentionEvent({ argv: process.argv.slice(2) });
  process.exitCode = result.exitCode;
}
