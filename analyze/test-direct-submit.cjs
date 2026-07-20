const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const REPORT = { schema_version: "top.research-safe-usage.v1", totals: { total_tokens: 42 } };

assert.match(html, /connect-src 'none'/,
  "CSP must stay closed while the Worker endpoint is not live");
assert.match(html, /var TOP_DELIVERY_ENDPOINT="";/);
assert.equal((html.match(/\bfetch\s*\(/g) || []).length, 1,
  "only the deliberate direct-submit handler may use fetch");
assert.match(html, /id="submitResearchReport" disabled/);
assert.match(html, /id="researchConsent"/);
assert.match(html, /analyzer_validation/);
assert.match(html, /forecast_calibration/);
assert.match(html, /<div class="share-form" hidden aria-hidden="true">[\s\S]*?<h3>Remote Transfer Unavailable<\/h3>/,
  "the dormant delivery controls must not be exposed in the local-only terminal");
assert.match(html, /id="researchConsent" disabled/,
  "the dormant consent control must be non-interactive");
assert.match(html, /id="submitResearchReport" disabled>Unavailable<\/button>/,
  "the dormant submission control must be non-interactive and must not promise delivery");
assert.match(html, /var TOP_DELIVERY_ENDPOINT="";/,
  "the repository must keep the sole user-initiated fetch unconfigured");
assert.doesNotMatch(html, /id="shareRecipients"|mailto:|oconns89@|adam2hartley@/i);
assert.match(html, /prepareResearchSafePackage\(true\)/,
  "the exact research-safe package must be frozen before review");
assert.match(html, /var json=researchSafePackage\|\|prepareResearchSafePackage\(false\)/,
  "download and device sharing must use the same reviewed package");

const start = html.indexOf('var TOP_DELIVERY_ENDPOINT="";');
const end = html.indexOf("// ---------- Route B:", start);
assert.ok(start >= 0 && end > start, "could not locate the bounded direct-submit implementation");
const source = html.slice(start, end);
for (const forbidden of [/XMLHttpRequest/, /sendBeacon/, /WebSocket/, /localStorage/, /indexedDB/, /sessionStorage/, /setTimeout/, /setInterval/]) {
  assert.doesNotMatch(source, forbidden, `direct submission must not use ${forbidden}`);
}

function createContext(fetchImpl) {
  const handlers = {};
  const nodes = {
    researchConsent: { checked: false, addEventListener(type, handler) { handlers.consent = { type, handler }; } },
    submitResearchReport: { disabled: true, addEventListener(type, handler) { handlers.submit = { type, handler }; } },
    deliveryReadiness: { textContent: "" },
    shareStatus: { textContent: "" },
  };
  const calls = [];
  const context = {
    URL,
    JSON,
    String,
    Array,
    Error,
    Promise,
    RESEARCH_SCHEMA_VERSION: "top.research-safe-usage.v1",
    RESEARCH_SCHEMA_VERSION_V2: "top.research-safe-usage.v2",
    researchSafePackage: "",
    setJourney() {},
    window: { crypto: { randomUUID: () => UUID } },
    document: { getElementById(id) { return nodes[id] || null; } },
    fetch: async (...args) => { calls.push(args); return fetchImpl(...args); },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, nodes, handlers, calls };
}

(async () => {
  const success = createContext(async () => ({
    status: 202,
    json: async () => ({ ok: true, status: "accepted_for_delivery", delivered: false, receipt_id: UUID }),
  }));
  const { context, nodes, handlers, calls } = success;
  assert.equal(handlers.consent.type, "change");
  assert.equal(handlers.submit.type, "click");
  assert.equal(nodes.submitResearchReport.disabled, true, "blank endpoint must keep the dormant control disabled");
  assert.equal(calls.length, 0, "loading and report preparation must never submit");

  context.TOP_DELIVERY_ENDPOINT = "http://worker.example.test/submit";
  assert.equal(context.configuredDeliveryEndpoint(), "", "HTTP endpoints must fail closed");
  context.TOP_DELIVERY_ENDPOINT = "https://user:pass@worker.example.test/submit";
  assert.equal(context.configuredDeliveryEndpoint(), "", "credential-bearing endpoints must fail closed");
  context.TOP_DELIVERY_ENDPOINT = "https://worker.example.test/submit?redirect=elsewhere";
  assert.equal(context.configuredDeliveryEndpoint(), "", "query-bearing endpoints must fail closed");

  context.TOP_DELIVERY_ENDPOINT = "https://worker.example.test/submit";
  context.researchSafePackage = JSON.stringify(REPORT);
  context.updateDirectSubmitState(false);
  assert.equal(nodes.submitResearchReport.disabled, true, "reviewed consent is still required");
  nodes.researchConsent.checked = true;
  context.updateDirectSubmitState(false);
  assert.equal(nodes.submitResearchReport.disabled, false);
  assert.equal(calls.length, 0, "checking consent must not submit");

  const envelope = JSON.parse(JSON.stringify(context.buildExplicitSubmissionEnvelope(REPORT)));
  assert.deepEqual(Object.keys(envelope), ["submission_schema_version", "submission_id", "consent", "report"]);
  assert.equal(envelope.submission_schema_version, "top.explicit-submission.v1");
  assert.equal(envelope.submission_id, UUID);
  assert.deepEqual(envelope.consent, {
    notice_version: "top.research-consent.2026-07-17.1",
    accepted: true,
    purposes: ["analyzer_validation", "forecast_calibration"],
    retention_days: 30,
  });
  assert.deepEqual(envelope.report, REPORT);

  assert.equal(await context.submitResearchSafeReport(), true);
  assert.equal(calls.length, 1, "one click must make exactly one request");
  const [endpoint, options] = calls[0];
  assert.equal(endpoint, "https://worker.example.test/submit");
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  assert.equal(options.redirect, "error");
  const sent = JSON.parse(options.body);
  assert.equal(sent.submission_id, UUID);
  assert.deepEqual(sent.report, REPORT);
  assert.match(nodes.shareStatus.textContent, /Accepted for delivery to Adam and Sam/);
  assert.match(nodes.shareStatus.textContent, /not mailbox delivery/);
  assert.equal(nodes.submitResearchReport.disabled, true, "an accepted report cannot be sent twice");
  assert.equal(await context.submitResearchSafeReport(), false);
  assert.equal(calls.length, 1, "there must be no automatic or post-success retry");

  const failure = createContext(async () => { throw new Error("offline"); });
  failure.context.TOP_DELIVERY_ENDPOINT = "https://worker.example.test/submit";
  failure.context.researchSafePackage = JSON.stringify(REPORT);
  failure.nodes.researchConsent.checked = true;
  failure.context.updateDirectSubmitState(false);
  assert.equal(await failure.context.submitResearchSafeReport(), false);
  assert.equal(failure.calls.length, 1);
  assert.match(failure.nodes.shareStatus.textContent, /could not confirm whether/);
  assert.match(failure.nodes.shareStatus.textContent, /did not retry automatically/);

  // Regression: A is in flight, the user resets and prepares B, then A resolves.
  // A must not mark B accepted, disable B as accepted, or overwrite B's status.
  let resolveA;
  const stale = createContext(() => new Promise((resolve) => { resolveA = resolve; }));
  stale.context.TOP_DELIVERY_ENDPOINT = "https://worker.example.test/submit";
  stale.context.researchSafePackage = JSON.stringify(REPORT);
  stale.nodes.researchConsent.checked = true;
  stale.context.updateDirectSubmitState(false);
  const pendingA = stale.context.submitResearchSafeReport();
  assert.equal(stale.calls.length, 1);
  assert.equal(stale.nodes.submitResearchReport.disabled, true, "A is pending");

  stale.context.researchSafePackage = "";
  stale.context.resetDirectSubmissionForReport();
  stale.context.updateDirectSubmitState(false);
  assert.equal(stale.nodes.submitResearchReport.disabled, true, "reset has no report");

  const reportB = { schema_version: "top.research-safe-usage.v1", totals: { total_tokens: 99 } };
  stale.context.researchSafePackage = JSON.stringify(reportB);
  stale.context.resetDirectSubmissionForReport();
  stale.nodes.researchConsent.checked = true;
  stale.context.updateDirectSubmitState(false);
  assert.equal(stale.nodes.submitResearchReport.disabled, false, "B is ready despite stale A");
  stale.nodes.shareStatus.textContent = "B remains current";
  const bReadiness = stale.nodes.deliveryReadiness.textContent;

  resolveA({
    status: 202,
    json: async () => ({ ok: true, status: "accepted_for_delivery", delivered: false, receipt_id: UUID }),
  });
  assert.equal(await pendingA, false, "stale A success is ignored for current UI state");
  assert.equal(stale.context.currentDirectSubmissionAccepted(), false, "B is not labelled accepted by A");
  assert.equal(stale.nodes.submitResearchReport.disabled, false, "B is not disabled as accepted by A");
  assert.equal(stale.nodes.shareStatus.textContent, "B remains current", "A cannot overwrite B's status");
  assert.equal(stale.nodes.deliveryReadiness.textContent, bReadiness, "A cannot overwrite B's readiness");

  console.log("TOP Analyzer explicit direct-submit tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
