import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LIVE_CONFIRMATION,
  PROBES,
  PRODUCTION_ENDPOINT,
  PRODUCTION_ORIGIN,
  RETIRED_GITHUB_ORIGIN,
  UNRELATED_ORIGIN,
  runNoEmailProductionProbe,
} from "../scripts/no-email-production-probe.mjs";

function capture() {
  const stdout = [];
  const stderr = [];
  return { stdout, stderr, out: (line) => stdout.push(String(line)), err: (line) => stderr.push(String(line)) };
}

function exactResponse(probe) {
  const headers = new Headers();
  if (probe.expectedAllowOrigin !== null) headers.set("Access-Control-Allow-Origin", probe.expectedAllowOrigin);
  return { status: probe.expectedStatus, headers };
}

function liveArguments(confirmation = LIVE_CONFIRMATION) {
  return ["--live", "--confirm", confirmation];
}

test("pinned endpoint, origins, order, methods, and expectations do not drift", () => {
  assert.equal(PRODUCTION_ENDPOINT, "https://submit.tokenoptimisationprotocol.org/");
  assert.equal(PRODUCTION_ORIGIN, "https://tokenoptimisationprotocol.org");
  assert.equal(RETIRED_GITHUB_ORIGIN, "https://adamhartley7.github.io");
  assert.equal(UNRELATED_ORIGIN, "https://unrelated.example");
  assert.deepEqual(PROBES.map(({ id, method, origin, expectedStatus, expectedAllowOrigin }) => ({
    id, method, origin, expectedStatus, expectedAllowOrigin,
  })), [
    { id: "production_preflight", method: "OPTIONS", origin: PRODUCTION_ORIGIN, expectedStatus: 204, expectedAllowOrigin: PRODUCTION_ORIGIN },
    { id: "retired_github_preflight", method: "OPTIONS", origin: RETIRED_GITHUB_ORIGIN, expectedStatus: 403, expectedAllowOrigin: null },
    { id: "unrelated_origin_preflight", method: "OPTIONS", origin: UNRELATED_ORIGIN, expectedStatus: 403, expectedAllowOrigin: null },
    { id: "unsafe_patch", method: "PATCH", origin: PRODUCTION_ORIGIN, expectedStatus: 405, expectedAllowOrigin: PRODUCTION_ORIGIN },
  ]);
  assert.ok(PROBES.every((probe) => probe.method !== "POST"));
});

test("default execution is zero-network and content-free", async () => {
  let calls = 0;
  const output = capture();
  const result = await runNoEmailProductionProbe({
    argv: [],
    fetchImpl: async () => { calls += 1; throw new Error("must not run"); },
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result, "dry_run_only");
  assert.equal(result.network_calls, 0);
  assert.equal(calls, 0);
  assert.equal(result.report_data_present, false);
  assert.equal(result.email_submission_attempted, false);
  assert.equal(result.response_bodies_inspected, false);
  assert.equal(output.stderr.length, 0);
});

test("invalid live arguments and a non-exact confirmation make zero network calls", async (t) => {
  const cases = [
    ["--live"],
    ["--live", "--confirm"],
    ["--confirm", LIVE_CONFIRMATION],
    ["--live", "--confirm", "wrong"],
    ["--live", "--confirm", `${LIVE_CONFIRMATION} `],
    ["--live", "--confirm", LIVE_CONFIRMATION, "extra"],
  ];
  for (const argv of cases) {
    await t.test(argv.join(" "), async () => {
      let calls = 0;
      const output = capture();
      const result = await runNoEmailProductionProbe({
        argv,
        fetchImpl: async () => { calls += 1; throw new Error("must not run"); },
        stdout: output.out,
        stderr: output.err,
      });
      assert.equal(result.exitCode, 2);
      assert.equal(result.network_calls, 0);
      assert.equal(calls, 0);
      assert.equal(result.email_submission_attempted, false);
    });
  }
});

test("exact live confirmation makes exactly four pinned calls with no POST or body", async () => {
  const calls = [];
  const output = capture();
  const result = await runNoEmailProductionProbe({
    argv: liveArguments(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return exactResponse(PROBES[calls.length - 1]);
    },
    stdout: output.out,
    stderr: output.err,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result, "pass");
  assert.equal(result.network_calls, 4);
  assert.equal(calls.length, 4);
  calls.forEach(({ url, options }, index) => {
    const probe = PROBES[index];
    assert.equal(url, PRODUCTION_ENDPOINT);
    assert.equal(options.method, probe.method);
    assert.notEqual(options.method, "POST");
    assert.equal(Object.hasOwn(options, "body"), false);
    assert.equal(options.headers.Origin, probe.origin);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    if (probe.method === "OPTIONS") assert.equal(options.headers["Access-Control-Request-Method"], "POST");
    else assert.equal(Object.hasOwn(options.headers, "Access-Control-Request-Method"), false);
  });
  assert.deepEqual(result.request_methods, ["OPTIONS", "OPTIONS", "OPTIONS", "PATCH"]);
  assert.ok(result.checks.every((check) => check.status_check === "exact_match"));
  assert.ok(result.checks.every((check) => check.access_control_allow_origin_check === "exact_match"));
  assert.deepEqual(result.checks.map((check) => check.expected_status), [204, 403, 403, 405]);
  assert.deepEqual(result.checks.map((check) => check.access_control_allow_origin_expectation), [
    "exact_production_origin", "absent", "absent", "exact_production_origin",
  ]);
  assert.equal(result.request_bodies_present, false);
  assert.equal(result.post_requests_made, false);
  assert.equal(result.response_bodies_inspected, false);
  assert.equal(result.report_data_present, false);
  assert.equal(result.email_submission_attempted, false);
  assert.equal(output.stderr.length, 0);
});

for (const [probeIndex, probe] of PROBES.entries()) {
  test(`${probe.id} stops on an exact-status mismatch`, async () => {
    let calls = 0;
    const output = capture();
    const result = await runNoEmailProductionProbe({
      argv: liveArguments(),
      fetchImpl: async () => {
        const current = PROBES[calls];
        calls += 1;
        if (calls - 1 !== probeIndex) return exactResponse(current);
        return { status: current.expectedStatus === 599 ? 598 : current.expectedStatus + 1, headers: exactResponse(current).headers };
      },
      stdout: output.out,
      stderr: output.err,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.result, "fail_closed");
    assert.equal(result.failure_kind, "status_mismatch");
    assert.equal(result.failed_check, probe.id);
    assert.equal(result.network_calls, probeIndex + 1);
    assert.equal(calls, probeIndex + 1);
    assert.ok(calls <= 4);
    assert.equal(result.checks.at(-1).expected_status, probe.expectedStatus);
  });

  test(`${probe.id} stops on an exact Access-Control-Allow-Origin mismatch`, async () => {
    let calls = 0;
    const output = capture();
    const result = await runNoEmailProductionProbe({
      argv: liveArguments(),
      fetchImpl: async () => {
        const current = PROBES[calls];
        calls += 1;
        if (calls - 1 !== probeIndex) return exactResponse(current);
        const response = exactResponse(current);
        if (current.expectedAllowOrigin === null) response.headers.set("Access-Control-Allow-Origin", "https://unexpected.example");
        else response.headers.delete("Access-Control-Allow-Origin");
        return response;
      },
      stdout: output.out,
      stderr: output.err,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.result, "fail_closed");
    assert.equal(result.failure_kind, "access_control_allow_origin_mismatch");
    assert.equal(result.failed_check, probe.id);
    assert.equal(result.network_calls, probeIndex + 1);
    assert.equal(calls, probeIndex + 1);
    assert.ok(calls <= 4);
    assert.equal(
      result.checks.at(-1).access_control_allow_origin_expectation,
      probe.expectedAllowOrigin === null ? "absent" : "exact_production_origin",
    );
  });
}

test("transport failure stops immediately and does not inspect a response body", async () => {
  let calls = 0;
  const output = capture();
  const result = await runNoEmailProductionProbe({
    argv: liveArguments(),
    fetchImpl: async () => { calls += 1; throw new TypeError("simulated network failure"); },
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.result, "fail_closed");
  assert.equal(result.failure_kind, "transport_failure");
  assert.equal(result.network_calls, 1);
  assert.equal(calls, 1);
  assert.equal(result.response_bodies_inspected, false);
  assert.equal(result.email_submission_attempted, false);
});

test("response body access is never required", async () => {
  let calls = 0;
  const output = capture();
  const result = await runNoEmailProductionProbe({
    argv: liveArguments(),
    fetchImpl: async () => {
      const probe = PROBES[calls];
      calls += 1;
      const response = exactResponse(probe);
      Object.defineProperty(response, "body", { get() { throw new Error("body must not be read"); } });
      Object.defineProperty(response, "text", { get() { throw new Error("text must not be read"); } });
      Object.defineProperty(response, "json", { get() { throw new Error("json must not be read"); } });
      return response;
    },
    stdout: output.out,
    stderr: output.err,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.network_calls, 4);
  assert.equal(calls, 4);
  assert.equal(result.response_bodies_inspected, false);
});

test("the operator record pins the Resend-only dashboard evidence without addresses", async () => {
  const text = await readFile(new URL("../ops/no-email-production-probe.md", import.meta.url), "utf8");
  assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/);
  for (const name of ["RESEND_API_KEY", "RESEND_FROM", "SUBMISSION_TO", "SUBMISSION_CC", "SUBMIT_RATE_LIMITER"]) {
    assert.match(text, new RegExp(name));
  }
  assert.match(text, /Cloudflare Worker plus Resend only/);
  assert.match(text, /No Cloudflare Email Service or `EMAIL` binding/);
  assert.match(text, /Sending access/);
  assert.match(text, /send\.tokenoptimisationprotocol\.org/);
  assert.match(text, /deployment ID/i);
  assert.match(text, /source commit/i);
  assert.match(text, /Approved Windows operator account from `whoami`/);
  assert.match(text, /Current `whoami` exactly matches/);
  assert.match(text, /never uses `POST`/);
});
