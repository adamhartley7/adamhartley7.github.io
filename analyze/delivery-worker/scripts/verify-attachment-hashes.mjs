import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  resolvePrivateRetentionLogPath,
  validateRetentionLog,
} from "./production-smoke.mjs";

function parseArguments(argv) {
  const result = { help: false, retentionLog: null, attachments: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      if (result.help) throw new Error("Duplicate --help flag.");
      result.help = true;
      continue;
    }
    if (argument !== "--retention-log" && argument !== "--attachment") throw new Error(`Unsupported argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    if (argument === "--retention-log") {
      if (result.retentionLog !== null) throw new Error("Duplicate --retention-log flag.");
      result.retentionLog = value;
    } else {
      result.attachments.push(value);
    }
    index += 1;
  }
  if (result.help && argv.length > 1) throw new Error("--help cannot be combined with other arguments.");
  return result;
}

function usage() {
  return [
    "TOP received-attachment hash verification",
    "",
    "This reads exactly two explicitly chosen local files. It does not access a mailbox or make a network request.",
    "",
    "  node scripts/verify-attachment-hashes.mjs --retention-log C:\\private\\top-smoke-retention.json --attachment C:\\Downloads\\received-copy-1.json --attachment C:\\Downloads\\received-copy-2.json",
  ].join("\n");
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function runAttachmentVerification({
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
  if (!options.retentionLog || options.attachments.length !== 2) {
    stderr("Refused: one retention log and exactly two attachment paths are required.");
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }

  try {
    const logPath = await resolvePrivateRetentionLogPath(options.retentionLog, { repositoryRoot, mustExist: true });
    const attachmentPaths = await Promise.all(options.attachments.map(async (value) => {
      if (!path.isAbsolute(value)) throw new Error("Every attachment path must be absolute.");
      return realpath(value);
    }));
    if (new Set(attachmentPaths.map((value) => process.platform === "win32" ? value.toLowerCase() : value)).size !== 2) {
      throw new Error("Choose two distinct received attachment files.");
    }

    const log = JSON.parse(await readFile(logPath, "utf8"));
    validateRetentionLog(log);
    if (log.http_status !== 202 || log.accepted_status !== "accepted_for_delivery" || log.request_attempted !== true) {
      throw new Error("The retention log does not record an accepted synthetic request.");
    }

    const hashes = await Promise.all(attachmentPaths.map(async (value) => hashBytes(await readFile(value))));
    const matches = hashes.map((value) => value === log.report_sha256);
    log.attachment_hashes = hashes.map((sha256, index) => ({
      slot: `received_copy_${index + 1}`,
      status: matches[index] ? "verified_match" : "mismatch",
      sha256,
      matches_report_sha256: matches[index],
    }));
    log.attachment_hash_verification_status = matches.every(Boolean) ? "verified_match" : "mismatch";
    validateRetentionLog(log);
    await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`, { encoding: "utf8", flag: "w", mode: 0o600 });

    stdout(`Expected report SHA-256: ${log.report_sha256}`);
    hashes.forEach((value, index) => stdout(`Received copy ${index + 1} SHA-256: ${value} (${matches[index] ? "match" : "MISMATCH"})`));
    stdout(`Private retention log updated: ${logPath}`);
    stdout("Mailbox access: none");
    stdout("Network calls: 0");
    if (!matches.every(Boolean)) {
      stderr("Verification failed: both received attachments must match report_sha256 before any real self-report.");
      return { exitCode: 1, networkCalls: 0, logPath, log, hashes, matches };
    }
    stdout("Verification passed: both received attachments match report_sha256.");
    return { exitCode: 0, networkCalls: 0, logPath, log, hashes, matches };
  } catch (error) {
    stderr(`Refused: ${error.message}`);
    stderr("Network calls: 0");
    return { exitCode: 2, networkCalls: 0 };
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await runAttachmentVerification({ argv: process.argv.slice(2) });
  process.exitCode = result.exitCode;
}
