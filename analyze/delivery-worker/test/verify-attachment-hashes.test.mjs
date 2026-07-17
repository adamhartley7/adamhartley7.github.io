import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createRetentionLog,
  createSyntheticSubmission,
  serializeReport,
} from "../scripts/production-smoke.mjs";
import { runAttachmentVerification } from "../scripts/verify-attachment-hashes.mjs";

const FIXED_UUID = "018f62cc-d0cd-7bc0-bed9-1e0c86b41ef3";
const FIXED_NOW = new Date("2026-07-17T08:00:00.000Z");
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

function capture() {
  const stdout = [];
  const stderr = [];
  return { stdout, stderr, out: (line) => stdout.push(String(line)), err: (line) => stderr.push(String(line)) };
}

async function fixture(directory) {
  const submission = createSyntheticSubmission({ generatedDate: "2026-07-17", submissionId: FIXED_UUID });
  const reportJson = serializeReport(submission.report);
  const reportSha256 = createHash("sha256").update(reportJson).digest("hex");
  const log = createRetentionLog({ submissionId: FIXED_UUID, reportSha256, requestedAt: FIXED_NOW });
  log.attempt_consumed = true;
  log.request_attempted = true;
  log.http_status = 202;
  log.accepted_status = "accepted_for_delivery";
  log.provider_message_id = "synthetic-resend-message-id";
  const logPath = path.join(directory, "retention.json");
  const first = path.join(directory, "received-1.json");
  const second = path.join(directory, "received-2.json");
  await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`, "utf8");
  await writeFile(first, reportJson, "utf8");
  await writeFile(second, reportJson, "utf8");
  return { logPath, first, second, reportSha256 };
}

test("two explicitly selected received attachments update the private log only when both hashes match", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-hash-check-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const files = await fixture(temporary);
  const output = capture();
  const result = await runAttachmentVerification({
    argv: ["--retention-log", files.logPath, "--attachment", files.first, "--attachment", files.second],
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.networkCalls, 0);
  assert.deepEqual(result.hashes, [files.reportSha256, files.reportSha256]);
  const updated = JSON.parse(await readFile(files.logPath, "utf8"));
  assert.equal(updated.attachment_hash_verification_status, "verified_match");
  assert.deepEqual(updated.attachment_hashes.map((entry) => entry.slot), ["adam_received_attachment", "sam_received_attachment"]);
  assert.ok(updated.attachment_hashes.every((entry) => entry.status === "verified_match" && entry.matches_report_sha256 === true));
  assert.match(output.stdout.join("\n"), /Mailbox access: none/);
  assert.match(output.stdout.join("\n"), /Network calls: 0/);
  assert.equal(output.stderr.length, 0);

  const beforeRetry = await readFile(files.logPath, "utf8");
  const retry = await runAttachmentVerification({
    argv: ["--retention-log", files.logPath, "--attachment", files.first, "--attachment", files.second],
    repositoryRoot: REPOSITORY_ROOT,
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(retry.exitCode, 2);
  assert.equal(retry.networkCalls, 0);
  assert.equal(await readFile(files.logPath, "utf8"), beforeRetry);
});

test("one mismatched attachment fails visibly and is retained in the private log", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-hash-mismatch-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const files = await fixture(temporary);
  await writeFile(files.second, "not the report", "utf8");
  const output = capture();
  const result = await runAttachmentVerification({
    argv: ["--retention-log", files.logPath, "--attachment", files.first, "--attachment", files.second],
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.networkCalls, 0);
  const updated = JSON.parse(await readFile(files.logPath, "utf8"));
  assert.equal(updated.attachment_hash_verification_status, "mismatch");
  assert.equal(updated.attachment_hashes[0].matches_report_sha256, true);
  assert.equal(updated.attachment_hashes[1].matches_report_sha256, false);
  assert.match(output.stderr.join("\n"), /before any real self-report/);

  await writeFile(files.second, await readFile(files.first), "utf8");
  const beforeRetry = await readFile(files.logPath, "utf8");
  const retry = await runAttachmentVerification({
    argv: ["--retention-log", files.logPath, "--attachment", files.first, "--attachment", files.second],
    repositoryRoot: REPOSITORY_ROOT,
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(retry.exitCode, 2);
  assert.equal(retry.networkCalls, 0);
  assert.equal(await readFile(files.logPath, "utf8"), beforeRetry);
});

test("the same local file cannot stand in for two received copies", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-hash-duplicate-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const files = await fixture(temporary);
  const output = capture();
  const result = await runAttachmentVerification({
    argv: ["--retention-log", files.logPath, "--attachment", files.first, "--attachment", files.first],
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.networkCalls, 0);
  assert.match(output.stderr.join("\n"), /two distinct/);
});
