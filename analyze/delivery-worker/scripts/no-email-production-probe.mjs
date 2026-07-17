import path from "node:path";
import { pathToFileURL } from "node:url";

export const PRODUCTION_ENDPOINT = "https://submit.tokenoptimisationprotocol.org/";
export const PRODUCTION_ORIGIN = "https://tokenoptimisationprotocol.org";
export const RETIRED_GITHUB_ORIGIN = "https://adamhartley7.github.io";
export const UNRELATED_ORIGIN = "https://unrelated.example";
export const LIVE_CONFIRMATION = "RUN-FOUR-NO-EMAIL-PRODUCTION-PROBES";

export const PROBES = Object.freeze([
  Object.freeze({
    id: "production_preflight",
    method: "OPTIONS",
    origin: PRODUCTION_ORIGIN,
    expectedStatus: 204,
    expectedAllowOrigin: PRODUCTION_ORIGIN,
  }),
  Object.freeze({
    id: "retired_github_preflight",
    method: "OPTIONS",
    origin: RETIRED_GITHUB_ORIGIN,
    expectedStatus: 403,
    expectedAllowOrigin: null,
  }),
  Object.freeze({
    id: "unrelated_origin_preflight",
    method: "OPTIONS",
    origin: UNRELATED_ORIGIN,
    expectedStatus: 403,
    expectedAllowOrigin: null,
  }),
  Object.freeze({
    id: "unsafe_patch",
    method: "PATCH",
    origin: PRODUCTION_ORIGIN,
    expectedStatus: 405,
    expectedAllowOrigin: PRODUCTION_ORIGIN,
  }),
]);

function usage() {
  return [
    "TOP no-email production probe",
    "",
    "Default, zero-network inspection:",
    "  node scripts/no-email-production-probe.mjs",
    "",
    "Live, four-call non-submitting probe:",
    `  node scripts/no-email-production-probe.mjs --live --confirm ${LIVE_CONFIRMATION}`,
    "",
    `Endpoint is pinned to ${PRODUCTION_ENDPOINT}`,
    "The live probe makes only three OPTIONS requests and one PATCH request.",
    "It never makes a POST request and never carries report data or a request body.",
  ].join("\n");
}

function parseArguments(argv) {
  if (!Array.isArray(argv)) throw new TypeError("Arguments must be an array.");
  if (argv.length === 0) return { live: false, confirmation: null, help: false };
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { live: false, confirmation: null, help: true };
  }
  if (argv.length !== 3 || argv[0] !== "--live" || argv[1] !== "--confirm") {
    throw new Error("Live mode requires exactly --live --confirm <value>.");
  }
  return { live: true, confirmation: argv[2], help: false };
}

function evidenceSummary({ result, networkCalls, checks, failedCheck = null, failureKind = null }) {
  return {
    schema_version: "top.no-email-production-probe.evidence.v1",
    result,
    endpoint: PRODUCTION_ENDPOINT,
    network_calls: networkCalls,
    maximum_network_calls: PROBES.length,
    request_methods: checks.map((check) => check.method),
    checks: checks.map((check) => ({
      id: check.id,
      method: check.method,
      expected_status: check.expectedStatus,
      status: check.status,
      status_check: check.statusCheck,
      access_control_allow_origin_expectation: check.allowOriginExpectation,
      access_control_allow_origin_check: check.allowOriginCheck,
    })),
    failed_check: failedCheck,
    failure_kind: failureKind,
    response_bodies_inspected: false,
    request_bodies_present: false,
    post_requests_made: false,
    report_data_present: false,
    email_submission_attempted: false,
  };
}

function writeSummary(summary, output) {
  output(JSON.stringify(summary, null, 2));
}

function requestOptions(probe) {
  const headers = { Origin: probe.origin };
  if (probe.method === "OPTIONS") headers["Access-Control-Request-Method"] = "POST";
  return {
    method: probe.method,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  };
}

function checkResponse(probe, response) {
  if (!response || typeof response.status !== "number" || !response.headers || typeof response.headers.get !== "function") {
    return {
      passed: false,
      status: null,
      statusCheck: "mismatch",
      allowOriginCheck: "not_checked",
      failureKind: "invalid_response_shape",
    };
  }
  const statusCheck = response.status === probe.expectedStatus ? "exact_match" : "mismatch";
  const observedAllowOrigin = response.headers.get("access-control-allow-origin");
  const allowOriginCheck = observedAllowOrigin === probe.expectedAllowOrigin ? "exact_match" : "mismatch";
  const failureKind = statusCheck === "mismatch"
    ? "status_mismatch"
    : allowOriginCheck === "mismatch" ? "access_control_allow_origin_mismatch" : null;
  return {
    passed: failureKind === null,
    status: response.status,
    statusCheck,
    allowOriginCheck,
    failureKind,
  };
}

export async function runNoEmailProductionProbe({
  argv = [],
  fetchImpl = globalThis.fetch,
  stdout = (line) => console.log(line),
  stderr = (line) => console.error(line),
} = {}) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    stderr(`Refused: ${error.message}`);
    const summary = evidenceSummary({ result: "refused", networkCalls: 0, checks: [], failureKind: "invalid_arguments" });
    writeSummary(summary, stderr);
    return { exitCode: 2, ...summary };
  }

  if (options.help) {
    stdout(usage());
    const summary = evidenceSummary({ result: "help_only", networkCalls: 0, checks: [] });
    writeSummary(summary, stdout);
    return { exitCode: 0, ...summary };
  }

  if (!options.live) {
    stdout(usage());
    const summary = evidenceSummary({ result: "dry_run_only", networkCalls: 0, checks: [] });
    writeSummary(summary, stdout);
    return { exitCode: 0, ...summary };
  }

  if (options.confirmation !== LIVE_CONFIRMATION) {
    stderr("Refused: the live confirmation did not match exactly.");
    const summary = evidenceSummary({ result: "refused", networkCalls: 0, checks: [], failureKind: "confirmation_mismatch" });
    writeSummary(summary, stderr);
    return { exitCode: 2, ...summary };
  }
  if (typeof fetchImpl !== "function") {
    stderr("Refused: no network implementation is available.");
    const summary = evidenceSummary({ result: "refused", networkCalls: 0, checks: [], failureKind: "network_unavailable" });
    writeSummary(summary, stderr);
    return { exitCode: 2, ...summary };
  }

  const checks = [];
  let networkCalls = 0;
  for (const probe of PROBES) {
    let response;
    try {
      networkCalls += 1;
      response = await fetchImpl(PRODUCTION_ENDPOINT, requestOptions(probe));
    } catch (error) {
      checks.push({
        id: probe.id,
        method: probe.method,
        expectedStatus: probe.expectedStatus,
        status: null,
        statusCheck: "not_checked",
        allowOriginExpectation: probe.expectedAllowOrigin === null ? "absent" : "exact_production_origin",
        allowOriginCheck: "not_checked",
      });
      const summary = evidenceSummary({
        result: "fail_closed",
        networkCalls,
        checks,
        failedCheck: probe.id,
        failureKind: "transport_failure",
      });
      stderr(`Probe stopped at ${probe.id}: transport failure (${error instanceof Error ? error.name : "unknown"}).`);
      writeSummary(summary, stderr);
      return { exitCode: 1, ...summary };
    }

    const checked = checkResponse(probe, response);
    checks.push({
      id: probe.id,
      method: probe.method,
      expectedStatus: probe.expectedStatus,
      allowOriginExpectation: probe.expectedAllowOrigin === null ? "absent" : "exact_production_origin",
      ...checked,
    });
    if (!checked.passed) {
      const summary = evidenceSummary({
        result: "fail_closed",
        networkCalls,
        checks,
        failedCheck: probe.id,
        failureKind: checked.failureKind,
      });
      stderr(`Probe stopped at ${probe.id}: ${checked.failureKind}.`);
      writeSummary(summary, stderr);
      return { exitCode: 1, ...summary };
    }
  }

  const summary = evidenceSummary({ result: "pass", networkCalls, checks });
  writeSummary(summary, stdout);
  return { exitCode: 0, ...summary };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await runNoEmailProductionProbe({ argv: process.argv.slice(2) });
  process.exitCode = result.exitCode;
}
