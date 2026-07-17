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
import { runRetentionEvent } from "../scripts/record-retention-event.mjs";

const FIXED_UUID = "018f62cc-d0cd-7bc0-bed9-1e0c86b41ef3";
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

async function acceptedLog(directory) {
  const submission = createSyntheticSubmission({ generatedDate: "2026-07-17", submissionId: FIXED_UUID });
  const reportSha256 = createHash("sha256").update(serializeReport(submission.report)).digest("hex");
  const log = createRetentionLog({ submissionId: FIXED_UUID, reportSha256, requestedAt: new Date("2026-07-17T08:00:00.000Z") });
  log.attempt_consumed = true;
  log.request_attempted = true;
  log.http_status = 202;
  log.accepted_status = "accepted_for_delivery";
  log.provider_message_id = "synthetic-resend-message-id";
  const logPath = path.join(directory, "retention.json");
  await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`, "utf8");
  return logPath;
}

async function record(logPath, event, at, evidenceReference) {
  return runRetentionEvent({
    argv: [
      "--retention-log", logPath,
      "--event", event,
      "--at", at,
      "--evidence-reference", evidenceReference,
    ],
    repositoryRoot: REPOSITORY_ROOT,
    stdout: () => {},
    stderr: () => {},
  });
}

test("mailbox deletion status and completion evidence are recorded without network access", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-retention-event-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const logPath = await acceptedLog(temporary);
  const result = await record(logPath, "adam-mailbox-deleted", "2026-08-16T09:00:00.000Z", "adam-mailbox-delete-2026-08-16");
  assert.equal(result.exitCode, 0);
  assert.equal(result.networkCalls, 0);
  const log = JSON.parse(await readFile(logPath, "utf8"));
  assert.deepEqual(log.mailbox_deletion.adam, {
    status: "completed",
    completed_at_utc: "2026-08-16T09:00:00.000Z",
    evidence_reference: "adam-mailbox-delete-2026-08-16",
  });
  assert.equal(log.mailbox_deletion.sam.status, "pending");
});

test("early-deletion request and completion retain separate evidence references", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-early-delete-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const logPath = await acceptedLog(temporary);
  const requested = await record(logPath, "early-deletion-requested", "2026-07-18T09:00:00.000Z", "request-ticket-17");
  assert.equal(requested.exitCode, 0);
  assert.equal((await record(logPath, "adam-mailbox-deleted", "2026-07-18T09:30:00.000Z", "adam-delete-ticket-17")).exitCode, 0);
  assert.equal((await record(logPath, "sam-mailbox-deleted", "2026-07-18T09:45:00.000Z", "sam-delete-ticket-17")).exitCode, 0);
  const completed = await record(logPath, "early-deletion-completed", "2026-07-18T10:00:00.000Z", "completion-ticket-17");
  assert.equal(completed.exitCode, 0);
  const log = JSON.parse(await readFile(logPath, "utf8"));
  assert.deepEqual(log.early_deletion, {
    status: "completed",
    requested_at_utc: "2026-07-18T09:00:00.000Z",
    request_evidence_reference: "request-ticket-17",
    completed_at_utc: "2026-07-18T10:00:00.000Z",
    completion_evidence_reference: "completion-ticket-17",
  });
});

test("unsafe evidence references and completion without a request fail closed", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-retention-refuse-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const logPath = await acceptedLog(temporary);
  const completion = await record(logPath, "early-deletion-completed", "2026-07-18T10:00:00.000Z", "completion-ticket-17");
  assert.equal(completion.exitCode, 2);
  const unsafe = await record(logPath, "sam-mailbox-deleted", "2026-08-16T09:00:00.000Z", "sam@example.com");
  assert.equal(unsafe.exitCode, 2);
  const log = JSON.parse(await readFile(logPath, "utf8"));
  assert.equal(log.mailbox_deletion.sam.status, "pending");
  assert.equal(log.early_deletion.status, "not_requested");
});

test("deletion timestamps cannot precede the original request or early-deletion request", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-retention-time-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const logPath = await acceptedLog(temporary);
  assert.equal((await record(logPath, "adam-mailbox-deleted", "2026-07-16T23:59:59.000Z", "adam-before-request")).exitCode, 2);
  assert.equal((await record(logPath, "early-deletion-requested", "2026-07-16T23:59:59.000Z", "early-before-request")).exitCode, 2);
  assert.equal((await record(logPath, "early-deletion-requested", "2026-07-18T12:00:00.000Z", "early-request-18")).exitCode, 0);
  assert.equal((await record(logPath, "adam-mailbox-deleted", "2026-07-18T12:01:00.000Z", "adam-delete-18")).exitCode, 0);
  assert.equal((await record(logPath, "sam-mailbox-deleted", "2026-07-18T12:02:00.000Z", "sam-delete-18")).exitCode, 0);
  assert.equal((await record(logPath, "early-deletion-completed", "2026-07-18T11:59:59.000Z", "completion-before-request")).exitCode, 2);
  assert.equal((await record(logPath, "early-deletion-completed", "2026-07-18T12:01:30.000Z", "completion-before-sam-delete")).exitCode, 2);
  const log = JSON.parse(await readFile(logPath, "utf8"));
  assert.equal(log.early_deletion.status, "requested");
  assert.equal(log.early_deletion.completed_at_utc, null);
});
