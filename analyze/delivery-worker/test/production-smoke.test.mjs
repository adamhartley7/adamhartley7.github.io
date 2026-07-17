import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateResearchSafeUsage } from "../src/index.mjs";
import {
  CONFIRM_SEND,
  CONFIRM_SYNTHETIC,
  PRODUCTION_ENDPOINT,
  PRODUCTION_ORIGIN,
  RECEIPT_ID_SEMANTICS,
  RETENTION_LOG_SCHEMA,
  createSyntheticReport,
  runSmoke,
  writeRetentionLog,
} from "../scripts/production-smoke.mjs";

const FIXED_UUID = "018f62cc-d0cd-7bc0-bed9-1e0c86b41ef3";
const FIXED_NOW = new Date("2026-07-17T08:00:00.000Z");
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

function capture() {
  const stdout = [];
  const stderr = [];
  return { stdout, stderr, out: (line) => stdout.push(String(line)), err: (line) => stderr.push(String(line)) };
}

function acceptedFetch(assertRequest) {
  return async (url, options) => {
    const submission = JSON.parse(options.body);
    const reportJson = JSON.stringify(submission.report, null, 2);
    const hash = createHash("sha256").update(reportJson).digest("hex");
    assertRequest(url, options, submission, hash);
    return new Response(JSON.stringify({
      ok: true,
      status: "accepted_for_delivery",
      delivered: false,
      receipt_id: submission.submission_id,
      report_sha256: hash,
      message: "TOP accepted the reviewed report for email delivery. This does not confirm mailbox delivery.",
    }), { status: 202, headers: { "Content-Type": "application/json" } });
  };
}

test("synthetic report is strict, content-free, and contains no recipient or personal data", () => {
  const report = createSyntheticReport("2026-07-17");
  assert.equal(validateResearchSafeUsage(report), true);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /@/);
  assert.doesNotMatch(serialized, /\b(?:Adam|Sam)\b/i);
  assert.equal(report.scope.original_source_content_included, false);
  assert.equal(report.privacy.network_delivery, "none");
  assert.deepEqual(report.totals, {
    input_tokens: 101,
    output_tokens: 202,
    cache_write_tokens: 303,
    cache_read_tokens: 404,
    reasoning_tokens: null,
    total_tokens: 1010,
  });
});

test("default execution is a zero-network dry run", async () => {
  let calls = 0;
  const output = capture();
  const result = await runSmoke({
    argv: [],
    fetchImpl: async () => { calls += 1; throw new Error("must not run"); },
    now: () => FIXED_NOW,
    randomUUID: () => FIXED_UUID,
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.networkCalls, 0);
  assert.equal(calls, 0);
  assert.match(output.stdout.join("\n"), /DRY RUN ONLY/);
  assert.match(output.stdout.join("\n"), /Network calls: 0/);
  assert.equal(output.stderr.length, 0);
});

test("invalid synthetic UUID preparation fails before network", async () => {
  let calls = 0;
  const output = capture();
  const result = await runSmoke({
    argv: [
      "--live",
      "--confirm-synthetic", CONFIRM_SYNTHETIC,
      "--confirm-send", CONFIRM_SEND,
      "--retention-log", path.join(os.tmpdir(), "unused-top-smoke-log.json"),
    ],
    fetchImpl: async () => { calls += 1; throw new Error("must not run"); },
    now: () => FIXED_NOW,
    randomUUID: () => "not-a-uuid",
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.networkCalls, 0);
  assert.equal(calls, 0);
  assert.match(output.stderr.join("\n"), /UUID is invalid/);
});

test("invalid or incomplete live confirmations make zero network calls", async (t) => {
  const cases = [
    ["--live"],
    ["--live", "--confirm-synthetic", CONFIRM_SYNTHETIC],
    ["--live", "--confirm-synthetic", CONFIRM_SYNTHETIC, "--confirm-send", "wrong"],
    ["--confirm-synthetic", CONFIRM_SYNTHETIC, "--confirm-send", CONFIRM_SEND],
    ["--live", "--confirm-synthetic", CONFIRM_SYNTHETIC, "--confirm-send", CONFIRM_SEND],
    ["--live", "--endpoint", PRODUCTION_ENDPOINT],
  ];
  for (const argv of cases) {
    await t.test(argv.join(" "), async () => {
      let calls = 0;
      const output = capture();
      const result = await runSmoke({
        argv,
        fetchImpl: async () => { calls += 1; throw new Error("must not run"); },
        now: () => FIXED_NOW,
        randomUUID: () => FIXED_UUID,
        repositoryRoot: REPOSITORY_ROOT,
        stdout: output.out,
        stderr: output.err,
      });
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.networkCalls, 0);
      assert.equal(calls, 0);
      assert.match(output.stderr.join("\n"), /Network calls: 0/);
    });
  }
});

test("a retention path inside the repository fails before network", async () => {
  let calls = 0;
  const output = capture();
  const result = await runSmoke({
    argv: [
      "--live",
      "--confirm-synthetic", CONFIRM_SYNTHETIC,
      "--confirm-send", CONFIRM_SEND,
      "--retention-log", path.join(REPOSITORY_ROOT, "analyze", "delivery-worker", "must-not-exist.json"),
    ],
    fetchImpl: async () => { calls += 1; throw new Error("must not run"); },
    now: () => FIXED_NOW,
    randomUUID: () => FIXED_UUID,
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.networkCalls, 0);
  assert.equal(calls, 0);
  assert.match(output.stderr.join("\n"), /outside the repository/);
});

test("an existing external retention record is never overwritten and prevents network", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-smoke-existing-log-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const retentionPath = path.join(temporary, "existing.json");
  await writeFile(retentionPath, "keep this record", "utf8");
  let calls = 0;
  const output = capture();
  const result = await runSmoke({
    argv: [
      "--live",
      "--confirm-synthetic", CONFIRM_SYNTHETIC,
      "--confirm-send", CONFIRM_SEND,
      "--retention-log", retentionPath,
    ],
    fetchImpl: async () => { calls += 1; throw new Error("must not run"); },
    now: () => FIXED_NOW,
    randomUUID: () => FIXED_UUID,
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.networkCalls, 0);
  assert.equal(calls, 0);
  assert.equal(await readFile(retentionPath, "utf8"), "keep this record");
  assert.match(output.stderr.join("\n"), /already exists/);
});

test("valid live mode makes one pinned synthetic request and writes the private retention log", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-smoke-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const retentionPath = path.join(temporary, "retention.json");
  let calls = 0;
  const output = capture();
  const result = await runSmoke({
    argv: [
      "--live",
      "--confirm-synthetic", CONFIRM_SYNTHETIC,
      "--confirm-send", CONFIRM_SEND,
      "--retention-log", retentionPath,
    ],
    fetchImpl: acceptedFetch((url, options, submission, reportHash) => {
      calls += 1;
      assert.equal(url, PRODUCTION_ENDPOINT);
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Origin, PRODUCTION_ORIGIN);
      assert.equal(options.headers["Content-Type"], "application/json");
      assert.deepEqual(Object.keys(submission).sort(), ["consent", "report", "submission_id", "submission_schema_version"]);
      assert.equal(submission.submission_id, FIXED_UUID);
      assert.equal(validateResearchSafeUsage(submission.report), true);
      assert.doesNotMatch(options.body, /@/);
      assert.ok(/^[0-9a-f]{64}$/.test(reportHash));
    }),
    now: () => FIXED_NOW,
    randomUUID: () => FIXED_UUID,
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.networkCalls, 1);
  assert.equal(calls, 1);
  const log = JSON.parse(await readFile(retentionPath, "utf8"));
  assert.equal(log.schema_version, RETENTION_LOG_SCHEMA);
  assert.equal(log.synthetic_only, true);
  assert.equal(log.receipt_id, FIXED_UUID);
  assert.equal(log.receipt_id_semantics, RECEIPT_ID_SEMANTICS);
  assert.equal(log.report_sha256, result.reportSha256);
  assert.equal(log.request_date, "2026-07-17");
  assert.equal(log.deletion_due_date, "2026-08-16");
  assert.equal(log.endpoint, PRODUCTION_ENDPOINT);
  assert.equal(log.origin, PRODUCTION_ORIGIN);
  assert.equal(log.request_attempted, true);
  assert.equal(log.http_status, 202);
  assert.equal(log.accepted_status, "accepted_for_delivery");
  assert.equal(log.provider_delivery_confirmed, false);
  assert.equal(log.attachment_hash_verification_status, "pending");
  assert.equal(log.attachment_hashes.length, 2);
  assert.ok(log.attachment_hashes.every((entry) => entry.status === "pending" && entry.sha256 === null));
  assert.match(output.stdout.join("\n"), /client submission UUID, not delivery proof/);
  assert.match(output.stdout.join("\n"), /Provider delivery confirmed: false/);
  assert.equal(output.stderr.length, 0);
});

test("a malformed HTTP 202 response is not treated as accepted", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-smoke-bad-response-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const retentionPath = path.join(temporary, "retention.json");
  let calls = 0;
  const output = capture();
  const result = await runSmoke({
    argv: [
      "--live",
      "--confirm-synthetic", CONFIRM_SYNTHETIC,
      "--confirm-send", CONFIRM_SEND,
      "--retention-log", retentionPath,
    ],
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true, status: "accepted_for_delivery", delivered: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    },
    now: () => FIXED_NOW,
    randomUUID: () => FIXED_UUID,
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.networkCalls, 1);
  assert.equal(calls, 1);
  const log = JSON.parse(await readFile(retentionPath, "utf8"));
  assert.equal(log.http_status, 202);
  assert.equal(log.accepted_status, "invalid_accepted_response");
  assert.equal(log.provider_delivery_confirmed, false);
});

test("a transport failure records an unknown outcome and never claims non-acceptance", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-smoke-transport-unknown-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const retentionPath = path.join(temporary, "retention.json");
  let calls = 0;
  const output = capture();
  const result = await runSmoke({
    argv: [
      "--live",
      "--confirm-synthetic", CONFIRM_SYNTHETIC,
      "--confirm-send", CONFIRM_SEND,
      "--retention-log", retentionPath,
    ],
    fetchImpl: async () => {
      calls += 1;
      throw new Error("simulated timeout after request start");
    },
    now: () => FIXED_NOW,
    randomUUID: () => FIXED_UUID,
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.networkCalls, 1);
  assert.equal(result.deliveryOutcome, "unknown");
  assert.equal(result.retentionLogPersisted, true);
  assert.equal(calls, 1);
  const log = JSON.parse(await readFile(retentionPath, "utf8"));
  assert.equal(log.http_status, null);
  assert.equal(log.accepted_status, "delivery_outcome_unknown");
  assert.equal(log.provider_delivery_confirmed, false);
  assert.match(output.stderr.join("\n"), /Delivery outcome unknown/);
  assert.match(output.stderr.join("\n"), /Do not retry automatically/);
  assert.doesNotMatch(output.stderr.join("\n"), /Not accepted/);
});

test("a non-202 response is recorded as known non-acceptance", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-smoke-non-202-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const retentionPath = path.join(temporary, "retention.json");
  let calls = 0;
  const output = capture();
  const result = await runSmoke({
    argv: [
      "--live",
      "--confirm-synthetic", CONFIRM_SYNTHETIC,
      "--confirm-send", CONFIRM_SEND,
      "--retention-log", retentionPath,
    ],
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: false, status: "not_sent" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    },
    now: () => FIXED_NOW,
    randomUUID: () => FIXED_UUID,
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.networkCalls, 1);
  assert.equal(result.acceptedForDelivery, false);
  assert.equal(result.retentionLogPersisted, true);
  assert.equal(calls, 1);
  const log = JSON.parse(await readFile(retentionPath, "utf8"));
  assert.equal(log.http_status, 503);
  assert.equal(log.accepted_status, "not_accepted");
  assert.equal(log.provider_delivery_confirmed, false);
  assert.match(output.stderr.join("\n"), /Not accepted: HTTP 503/);
  assert.doesNotMatch(output.stderr.join("\n"), /outcome unknown/i);
});

test("an exact HTTP 202 with a failed final log write is not mislabeled as a transport failure", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "top-smoke-post-response-write-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const retentionPath = path.join(temporary, "retention.json");
  let calls = 0;
  let writes = 0;
  const output = capture();
  const result = await runSmoke({
    argv: [
      "--live",
      "--confirm-synthetic", CONFIRM_SYNTHETIC,
      "--confirm-send", CONFIRM_SEND,
      "--retention-log", retentionPath,
    ],
    fetchImpl: acceptedFetch(() => { calls += 1; }),
    writeRetentionLogImpl: async (...args) => {
      writes += 1;
      if (writes === 3) throw new Error("simulated final persistence failure");
      return writeRetentionLog(...args);
    },
    now: () => FIXED_NOW,
    randomUUID: () => FIXED_UUID,
    repositoryRoot: REPOSITORY_ROOT,
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.networkCalls, 1);
  assert.equal(result.acceptedForDelivery, true);
  assert.equal(result.retentionLogPersisted, false);
  assert.equal(calls, 1);
  assert.equal(writes, 3);
  const onDisk = JSON.parse(await readFile(retentionPath, "utf8"));
  assert.equal(onDisk.accepted_status, "request_pending_response");
  assert.equal(result.retentionLog.http_status, 202);
  assert.equal(result.retentionLog.accepted_status, "accepted_for_delivery");
  assert.match(output.stderr.join("\n"), /exact HTTP 202 acceptance response was received/);
  assert.match(output.stderr.join("\n"), /retention log update failed/);
  assert.doesNotMatch(output.stderr.join("\n"), /Delivery outcome unknown/);
  assert.doesNotMatch(output.stdout.join("\n"), /Synthetic request accepted for delivery/);
});

test("the committed retention template has no addresses and preserves pending semantics", async () => {
  const templatePath = fileURLToPath(new URL("../scripts/retention-log.template.json", import.meta.url));
  const text = await readFile(templatePath, "utf8");
  const template = JSON.parse(text);
  assert.doesNotMatch(text, /@/);
  assert.equal(template.receipt_id_semantics, RECEIPT_ID_SEMANTICS);
  assert.equal(template.provider_delivery_confirmed, false);
  assert.equal(template.attachment_hash_verification_status, "pending");
  assert.equal(template.attachment_hashes.length, 2);
  assert.ok(template.attachment_hashes.every((entry) => entry.status === "pending" && entry.sha256 === null));
});
