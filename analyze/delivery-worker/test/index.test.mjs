import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  MAX_JSON_BYTES,
  createHandler,
  escapeHtml,
  validateResearchSafeUsage,
} from "../src/index.mjs";

const ORIGIN = "https://adamhartley7.github.io";
const SUBMISSION_ID = "018f62cc-d0cd-7bc0-bed9-1e0c86b41ef3";

function reportFixture() {
  return {
    schema_version: "top.research-safe-usage.v1",
    collector: {
      collector_version: "top.local-collector.2026-07-16.1",
      parser_version: "top.usage-parser.2026-07-16.2",
    },
    generated_date: "2026-07-16",
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
      files_discovered: 2,
      files_parsed: 2,
      files_with_usage: 1,
      files_skipped: 0,
      malformed_lines: 0,
      oversized_lines: 0,
      counter_resets: 0,
      duplicate_usage_records: 3,
      complete: true,
    },
    totals: {
      input_tokens: 10,
      output_tokens: 5,
      cache_write_tokens: 20,
      cache_read_tokens: 30,
      reasoning_tokens: null,
      total_tokens: 65,
    },
    activity: {
      ai_replies: 2,
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
      reference_checked_date: "2026-07-16",
      unit: "usd_per_million_tokens",
      applied_rates: [],
      unpriced_model_groups: 1,
    },
    permission_mode_counts: null,
    by_model: [{
      model: "deepseek-v4-pro",
      input_tokens: 10,
      output_tokens: 5,
      cache_write_tokens: 20,
      cache_read_tokens: 30,
      reasoning_tokens: null,
      total_tokens: 65,
      events_or_replies: 2,
      cost: { status: "unavailable", usd: null },
    }],
    questionnaire: null,
    value_model: {
      truth_status: "not_available",
      algorithm_version: "top.value-model.v0.1-illustrative",
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
}

function submissionFixture() {
  return {
    submission_schema_version: "top.explicit-submission.v1",
    submission_id: SUBMISSION_ID,
    consent: {
      notice_version: "top.research-consent.2026-07-16.1",
      accepted: true,
      purposes: ["analyzer_validation", "forecast_calibration"],
      retention_days: 30,
    },
    report: reportFixture(),
  };
}

function environment(rateSuccess = true) {
  return {
    RESEND_API_KEY: "synthetic-sending-only-key",
    RESEND_FROM: "TOP Analyzer <reports@example.com>",
    SUBMISSION_TO: "adam-review@example.com",
    SUBMISSION_CC: "sam-review@example.com",
    SUBMIT_RATE_LIMITER: { limit: async () => ({ success: rateSuccess }) },
  };
}

function requestFor(body, options = {}) {
  return new Request("https://submit.example.workers.dev/v1/reports", {
    method: options.method || "POST",
    headers: {
      "Origin": options.origin || ORIGIN,
      "Content-Type": options.contentType || "application/json",
      ...(options.headers || {}),
    },
    body: options.method === "OPTIONS" ? undefined : body,
  });
}

async function responseJson(response) {
  return { response, body: await response.json() };
}

test("strict v1 fixture validates and totals reconcile", () => {
  assert.equal(validateResearchSafeUsage(reportFixture()), true);
});

test("strict validator accepts current analyzer-generated Claude, Codex, chat and Console variants", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  const pricingStart = html.indexOf("var PRICING_CHECKED=");
  const pricingEnd = html.indexOf("var VM=", pricingStart);
  const researchStart = html.indexOf("var RESEARCH_SCHEMA_VERSION=");
  const researchEnd = html.indexOf('document.getElementById("downloadResearchJSON")', researchStart);
  assert.ok(pricingStart >= 0 && pricingEnd > pricingStart && researchStart >= 0 && researchEnd > researchStart);
  const context = { Date, JSON, Math, Number, Object, String, Array, RegExp, Map, Set };
  vm.createContext(context);
  vm.runInContext(html.slice(pricingStart, pricingEnd), context);
  vm.runInContext(html.slice(researchStart, researchEnd), context);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const reports = [
    context.buildResearchSafeObject({
      by: { "claude-opus-4-8": { inp: 100, out: 20, cw: 30, cr: 40, turns: 2 } },
      turns: 2, sessions: 1, days: 1, filesOpened: 4, estimate: true, valueModelEligible: true,
    }, null, null, 0.4, "2026-07-16"),
    context.buildResearchSafeObject({
      by: { "gpt-5.6-codex-mini": { inp: 80, out: 30, cw: 0, cr: 20, reasoning: 10, turns: 3 } },
      turns: 3, sessions: 2, days: 2, filesOpened: 3, estimate: true, valueModelEligible: true, codex: true,
      coverage: { files_selected: 3, files_parsed: 3, files_with_usage: 2, files_skipped: 0, malformed_lines: 1, oversized_lines: 0, counter_resets: 1, complete: false },
    }, null, null, 0.4, "2026-07-16"),
    context.buildResearchSafeObject({
      by: { "claude.ai (est.)": { inp: 100, out: 200, cw: 0, cr: 0, turns: 6 } },
      turns: 6, sessions: 2, days: 0, filesOpened: 1, chatExport: true, chatProvider: "Claude Chat", valueModelEligible: false,
      ignoredRecords: 3, ignoredMessages: 4, duplicateRecords: 1,
    }, null, null, 0.4, "2026-07-16"),
    context.buildResearchSafeObject({
      by: { "claude-opus-4-8": { inp: 10, out: 5, cw: 0, cr: 0, turns: 1, cost: 4.2, costRows: 1, missingCostRows: 0, missing: { inp: 0, out: 0, cw: 0, cr: 0 } } },
      turns: 1, sessions: 1, days: 0, filesOpened: 1, csv: true, costComplete: true, costRows: 1, missingCostRows: 0, valueModelEligible: true,
    }, null, null, 0.4, "2026-07-16"),
  ].map(plain);
  for (const report of reports) assert.equal(validateResearchSafeUsage(report), true);
});

test("successful email body contains aggregates but not private source fields", async () => {
  let captured;
  const handler = createHandler({
    fetchImpl: async (url, init) => {
      captured = { url, init, email: JSON.parse(init.body) };
      return new Response(JSON.stringify({ id: "synthetic-email-id" }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), environment()));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(body.status, "accepted_for_delivery");
  assert.equal(body.delivered, false);
  assert.equal(body.receipt_id, SUBMISSION_ID);
  assert.match(body.report_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(captured.email.to, ["adam-review@example.com"]);
  assert.deepEqual(captured.email.cc, ["sam-review@example.com"]);
  assert.equal(captured.init.headers["Idempotency-Key"], `top-usage/${SUBMISSION_ID}`);
  assert.match(captured.email.text, /Total tokens: 65/);
  assert.match(captured.email.html, /deepseek-v4-pro/);
  assert.equal(/prompt text|reply text|source path|project identifier/i.test(captured.email.text), false);
  const attachment = JSON.parse(Buffer.from(captured.email.attachments[0].content, "base64").toString("utf8"));
  assert.deepEqual(attachment, reportFixture());
});

test("400 rejects unknown and forbidden report fields before delivery", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const submission = submissionFixture();
  submission.report.prompt = "private";
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submission)), environment()));
  assert.equal(response.status, 400);
  assert.equal(body.status, "not_sent");
  assert.equal(called, false);
});

test("400 rejects recipient injection in the client envelope", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const submission = submissionFixture();
  submission.to = "attacker@example.com";
  const { response } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submission)), environment()));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("400 rejects unreconciled token totals", async () => {
  const handler = createHandler({ fetchImpl: async () => { throw new Error("must not send"); } });
  const submission = submissionFixture();
  submission.report.totals.total_tokens = 66;
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submission)), environment()));
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "invalid_reconciliation");
});

test("409 provider idempotency conflict is not reported as delivered", async () => {
  const handler = createHandler({ fetchImpl: async () => new Response(JSON.stringify({ message: "conflict" }), { status: 409, headers: { "Content-Type": "application/json" } }) });
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), environment()));
  assert.equal(response.status, 409);
  assert.equal(body.status, "not_sent_by_this_request");
  assert.equal(body.receipt_id, SUBMISSION_ID);
});

test("413 rejects a body over 256 KiB before provider delivery", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const oversized = JSON.stringify({ padding: "x".repeat(MAX_JSON_BYTES) });
  const { response, body } = await responseJson(await handler.fetch(requestFor(oversized), environment()));
  assert.equal(response.status, 413);
  assert.equal(body.error.code, "payload_too_large");
  assert.equal(called, false);
});

test("429 rate limit prevents provider delivery", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), environment(false)));
  assert.equal(response.status, 429);
  assert.equal(body.status, "not_sent");
  assert.equal(called, false);
});

test("rate-limit service failure is a truthful not-sent response", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const env = environment();
  env.SUBMIT_RATE_LIMITER.limit = async () => { throw new Error("synthetic limit failure"); };
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), env));
  assert.equal(response.status, 503);
  assert.equal(body.status, "not_sent");
  assert.equal(body.error.code, "rate_limit_unavailable");
  assert.equal(called, false);
});

test("upstream 500 is converted to a truthful not-sent 502", async () => {
  const handler = createHandler({ fetchImpl: async () => new Response(JSON.stringify({ message: "provider failed" }), { status: 500, headers: { "Content-Type": "application/json" } }) });
  const { response, body } = await responseJson(await handler.fetch(requestFor(JSON.stringify(submissionFixture())), environment()));
  assert.equal(response.status, 502);
  assert.equal(body.status, "not_sent");
  assert.equal(body.error.code, "delivery_rejected");
});

test("only the production origin receives CORS permission", async () => {
  let called = false;
  const handler = createHandler({ fetchImpl: async () => { called = true; throw new Error("must not send"); } });
  const request = requestFor(JSON.stringify(submissionFixture()), { origin: "https://evil.example" });
  const { response, body } = await responseJson(await handler.fetch(request, environment()));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(body.status, "not_sent");
  assert.equal(called, false);
});

test("non-JSON requests are rejected", async () => {
  const handler = createHandler({ fetchImpl: async () => { throw new Error("must not send"); } });
  const { response } = await responseJson(await handler.fetch(requestFor("plain text", { contentType: "text/plain" }), environment()));
  assert.equal(response.status, 415);
});

test("HTML escaping covers every active HTML metacharacter", () => {
  assert.equal(escapeHtml(`<script data-x="'&">`), "&lt;script data-x=&quot;&#39;&amp;&quot;&gt;");
});

test("worker source contains no report logging or persistence bindings", async () => {
  const source = await readFile(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\s*\./);
  assert.doesNotMatch(source, /env\.(?:DB|D1|KV|R2)|\.put\s*\(/);
  assert.doesNotMatch(source, /SUBMISSION_TO\s*[:=]\s*["'][^"']+@/);
  assert.doesNotMatch(source, /SUBMISSION_CC\s*[:=]\s*["'][^"']+@/);
});
