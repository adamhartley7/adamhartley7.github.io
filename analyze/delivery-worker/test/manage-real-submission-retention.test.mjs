import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  REAL_RETENTION_REGISTER_SCHEMA,
  runRealRetention,
  validateRealRetentionRegister,
} from "../scripts/manage-real-submission-retention.mjs";

const RECEIPT_ONE = "018f62cc-d0cd-7bc0-bed9-1e0c86b41ef3";
const RECEIPT_TWO = "118f62cc-d0cd-7bc0-bed9-1e0c86b41ef3";
const HASH_ONE = "a".repeat(64);
const HASH_TWO = "b".repeat(64);
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

function invoke(argv) {
  return runRealRetention({
    argv,
    repositoryRoot: REPOSITORY_ROOT,
    stdout: () => {},
    stderr: () => {},
  });
}

function acceptedArgs(registerPath, receiptId = RECEIPT_ONE, providerMessageId = "resend-real-message-1", reportSha256 = HASH_ONE, requestAt = "2026-07-17T09:00:00.000Z") {
  return [
    "--register", registerPath,
    "--event", "accepted",
    "--receipt-id", receiptId,
    "--provider-message-id", providerMessageId,
    "--report-sha256", reportSha256,
    "--request-at", requestAt,
  ];
}

function eventArgs(registerPath, event, receiptId, at, evidenceReference) {
  return [
    "--register", registerPath,
    "--event", event,
    "--receipt-id", receiptId,
    "--at", at,
    "--evidence-reference", evidenceReference,
  ];
}

test("each accepted real submission gets a privacy-safe retention entry and can be verified", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-real-retention-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const registerPath = path.join(temporary, "register.json");
  assert.equal((await invoke(acceptedArgs(registerPath))).exitCode, 0);
  assert.equal((await invoke(acceptedArgs(registerPath, RECEIPT_TWO, "resend-real-message-2", HASH_TWO, "2026-07-18T10:00:00.000Z"))).exitCode, 0);
  const verification = await invoke(["--register", registerPath, "--event", "verify-entry", "--receipt-id", RECEIPT_ONE]);
  assert.equal(verification.exitCode, 0);
  assert.equal(verification.networkCalls, 0);
  const text = await readFile(registerPath, "utf8");
  assert.doesNotMatch(text, /@|prompt|reply|code|report_content|recipient/i);
  const register = JSON.parse(text);
  assert.equal(validateRealRetentionRegister(register), register);
  assert.equal(register.schema_version, REAL_RETENTION_REGISTER_SCHEMA);
  assert.equal(register.entries.length, 2);
  assert.deepEqual(Object.keys(register.entries[0]).sort(), [
    "deletion_due_date", "early_deletion", "mailbox_deletion", "provider_message_id",
    "receipt_id", "report_sha256", "request_date",
  ]);
  assert.equal(register.entries[0].deletion_due_date, "2026-08-16");
  assert.equal(register.entries[0].mailbox_deletion.adam.status, "pending");
  assert.equal(register.entries[0].mailbox_deletion.sam.status, "pending");
});

test("duplicate receipt and provider IDs fail without changing the register", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-real-duplicate-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const registerPath = path.join(temporary, "register.json");
  assert.equal((await invoke(acceptedArgs(registerPath))).exitCode, 0);
  const before = await readFile(registerPath, "utf8");
  assert.equal((await invoke(acceptedArgs(registerPath))).exitCode, 2);
  assert.equal((await invoke(acceptedArgs(registerPath, RECEIPT_TWO, "resend-real-message-1", HASH_TWO))).exitCode, 2);
  assert.equal(await readFile(registerPath, "utf8"), before);
});

test("real-submission deletion evidence cannot precede the request or early request", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-real-time-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const registerPath = path.join(temporary, "register.json");
  assert.equal((await invoke(acceptedArgs(registerPath))).exitCode, 0);
  assert.equal((await invoke(eventArgs(registerPath, "adam-mailbox-deleted", RECEIPT_ONE, "2026-07-16T23:59:59.000Z", "adam-before-request"))).exitCode, 2);
  assert.equal((await invoke(eventArgs(registerPath, "early-deletion-requested", RECEIPT_ONE, "2026-07-16T23:59:59.000Z", "early-before-request"))).exitCode, 2);
  assert.equal((await invoke(eventArgs(registerPath, "early-deletion-requested", RECEIPT_ONE, "2026-07-18T12:00:00.000Z", "early-request-18"))).exitCode, 0);
  assert.equal((await invoke(eventArgs(registerPath, "adam-mailbox-deleted", RECEIPT_ONE, "2026-07-18T12:01:00.000Z", "adam-delete-18"))).exitCode, 0);
  assert.equal((await invoke(eventArgs(registerPath, "sam-mailbox-deleted", RECEIPT_ONE, "2026-07-18T12:02:00.000Z", "sam-delete-18"))).exitCode, 0);
  assert.equal((await invoke(eventArgs(registerPath, "early-deletion-completed", RECEIPT_ONE, "2026-07-18T11:59:59.000Z", "completion-before-request"))).exitCode, 2);
  assert.equal((await invoke(eventArgs(registerPath, "early-deletion-completed", RECEIPT_ONE, "2026-07-18T12:01:30.000Z", "completion-before-sam-delete"))).exitCode, 2);
  const register = JSON.parse(await readFile(registerPath, "utf8"));
  assert.equal(register.entries[0].early_deletion.status, "requested");
  assert.equal(register.entries[0].early_deletion.completed_at_utc, null);
  assert.equal((await invoke(eventArgs(registerPath, "early-deletion-completed", RECEIPT_ONE, "2026-07-18T12:03:00.000Z", "completion-after-both-deletes"))).exitCode, 0);
  const completed = JSON.parse(await readFile(registerPath, "utf8"));
  assert.equal(completed.entries[0].early_deletion.status, "completed");
  assert.equal(completed.entries[0].early_deletion.completed_at_utc, "2026-07-18T12:03:00.000Z");
});

test("the committed empty register template is safe and valid", async () => {
  const text = await readFile(new URL("../scripts/real-submission-retention-register.template.json", import.meta.url), "utf8");
  assert.doesNotMatch(text, /@/);
  const register = JSON.parse(text);
  assert.equal(validateRealRetentionRegister(register), register);
  assert.deepEqual(register, { schema_version: REAL_RETENTION_REGISTER_SCHEMA, entries: [] });
});

test("the release runbook blocks real and pilot progress without retention entries", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /Immediately after each real submission receives exact HTTP `202` and a nonempty `provider_message_id`, create one entry/);
  assert.match(readme, /An accepted real report is not operationally complete until its entry exists/);
  assert.match(readme, /four-person pilot cannot start if Adam's entry is absent or invalid/);
  assert.match(readme, /Create one separate register entry immediately after each accepted pilot submission/);
});
