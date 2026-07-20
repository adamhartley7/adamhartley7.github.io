// Human-readable share preview.
// The point of this suite: the preview must be DERIVED FROM the payload, and it must show
// every field the payload contains. A field the user cannot see is a field they cannot
// consent to. It also pins that this change stayed presentation-only: nothing about what
// is sent, or whether sending is possible, may move.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const file = path.join(__dirname, "index.html");
const html = fs.readFileSync(file, "utf8");

// ---------- extract the real code, no reimplementation ----------
const helperStart = html.indexOf("function fmt$(");
const helperEnd = html.indexOf("function safePublicModelLabel(");
assert.ok(helperStart > 0 && helperEnd > helperStart, "formatting helper slice not found");

const previewStart = html.indexOf("function parseResearchSafePackage(");
const previewEnd = html.indexOf("function pilotShareScenario(");
assert.ok(previewStart > 0 && previewEnd > previewStart, "share preview slice not found");

// ---------- minimal DOM stub ----------
function makeElement(id) {
  return {
    id,
    hidden: false,
    innerHTML: "",
    _attrs: {},
    setAttribute(name, value) { this._attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; },
    querySelectorAll() { return []; }
  };
}
const host = makeElement("pilotResearchHuman");
const context = {
  document: { getElementById: (id) => (id === "pilotResearchHuman" ? host : null) },
  Array,
  Number,
  Object,
  String,
  JSON,
  Math
};
vm.createContext(context);
vm.runInContext(html.slice(helperStart, helperEnd), context);
vm.runInContext(html.slice(previewStart, previewEnd), context);

// ---------- a payload shaped like the real research-safe object ----------
function samplePayload() {
  return {
    schema_version: "top.research-safe.v2",
    collector: { collector_version: "top.local-collector.2026-07-16.2", parser_version: "top.parser.2" },
    generated_date: "2026-07-19",
    source: { tool: "claude_code", route: "local_folder" },
    measurement: { basis: "recorded_token_counters" },
    scope: {
      selection: "supported_records_in_user_selected_local_data",
      full_account_or_subscription_claim: false,
      original_source_content_included: false
    },
    coverage: { files_read: 12, records_used: 340 },
    totals: {
      input_tokens: 120000,
      output_tokens: 45000,
      cache_write_tokens: null,
      cache_read_tokens: 900,
      reasoning_tokens: null,
      total_tokens: 165900
    },
    activity: {
      ai_replies: 210,
      usage_events: null,
      console_records: null,
      text_messages: null,
      sessions: 9,
      active_days: 4
    },
    cost: { status: "estimated", usd: 18.4231, basis: "estimated_pay_as_you_go_comparison", currency: "USD", subscription_bill: false },
    pricing: {
      status: "checked_reference_rates",
      reference_checked_date: "2026-07-15",
      unit: "usd_per_million_tokens",
      applied_rates: [
        {
          model: "claude-sonnet-4-5",
          rate_family: "Sonnet 4.5",
          input_usd_per_million: 3,
          cache_write_usd_per_million: 3.75,
          cache_read_usd_per_million: 0.3,
          output_usd_per_million: 15,
          field_provenance: { input: "reference_rate_card" },
          reference_source_url: "https://example.invalid/pricing"
        }
      ],
      unpriced_model_groups: 1
    },
    permission_mode_counts: null,
    by_model: [
      {
        model: "claude-sonnet-4-5",
        input_tokens: 120000,
        output_tokens: 45000,
        cache_write_tokens: null,
        cache_read_tokens: 900,
        reasoning_tokens: null,
        total_tokens: 165900,
        events_or_replies: 210,
        cost: { status: "estimated", usd: 18.4231 }
      },
      {
        model: "Unrecognized AI version",
        input_tokens: 5000,
        output_tokens: 1000,
        cache_write_tokens: null,
        cache_read_tokens: null,
        reasoning_tokens: null,
        total_tokens: 6000,
        events_or_replies: 12,
        cost: { status: "unavailable", usd: null }
      }
    ],
    questionnaire: { role: "engineer", tools: [] },
    value_model: { truth_status: "not_available", reason: "scenario_control_not_shown_for_this_route" },
    privacy: {
      network_delivery: "none",
      inspect_before_attaching: true,
      excluded: ["prompts", "replies", "code"]
    },
    timeline: { periods: [{ month: "2026-06", total_tokens: 165900, sessions: 9, active_days: 4 }] },
    session_distributions: { tokens_per_session: { p50: 8000 } },
    workflow_shape: { tool_calls_per_reply: { p50: 2 } }
  };
}

// Independent walker. Mirrors JSON structure, NOT the page's implementation, so agreement
// between the two is evidence rather than tautology.
function leafPaths(value, prefix, out) {
  if (Array.isArray(value)) {
    if (!value.length) { out.push(prefix); return out; }
    value.forEach((item, i) => leafPaths(item, prefix + "[" + i + "]", out));
    return out;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (!keys.length) { out.push(prefix); return out; }
    keys.forEach((k) => leafPaths(value[k], prefix + "." + k, out));
    return out;
  }
  out.push(prefix);
  return out;
}
function allPayloadPaths(payload) {
  const out = [];
  Object.keys(payload).forEach((k) => leafPaths(payload[k], k, out));
  return out.sort();
}
// The extracted code runs in a vm realm, so its arrays have that realm's Array prototype.
// Copy into a host array before comparing, otherwise deepStrictEqual rejects on prototype
// identity rather than on content.
function hostSorted(values) {
  return Array.from(values).map(String).sort();
}

// ---------- 1. the preview is derived from the payload, field for field ----------
{
  const payload = samplePayload();
  const model = context.buildSharePreviewModel(payload);
  assert.ok(model, "a payload must produce a preview model");
  assert.deepEqual(
    hostSorted(model.paths),
    allPayloadPaths(payload),
    "every leaf in the research-safe payload must appear in the preview, and the preview must invent none"
  );
}

// ---------- 2. a field added to the payload appears without touching the preview code ----------
{
  const payload = samplePayload();
  payload.future_section_nobody_mapped = { some_new_field: 7 };
  const model = context.buildSharePreviewModel(payload);
  assert.deepEqual(
    hostSorted(model.paths),
    allPayloadPaths(payload),
    "an unmapped new payload field must still be shown, not silently dropped"
  );
  const other = model.tabs.find((tab) => tab.id === "other");
  assert.ok(other, "unmapped top-level keys must land in a visible catch-all tab");
  assert.ok(other.rows.some((row) => row.path === "future_section_nobody_mapped.some_new_field"));
}

// ---------- 3. the preview derives from the JSON string, so it cannot drift ----------
{
  const payload = samplePayload();
  const json = JSON.stringify(payload, null, 2);
  const reparsed = context.parseResearchSafePackage(json);
  assert.deepEqual(reparsed, payload, "the preview source must be the parsed package itself");
  assert.equal(context.parseResearchSafePackage(""), null);
  assert.equal(context.parseResearchSafePackage("{not json"), null);
  // The page must build both readable views from the package string, not from a second
  // build of the safe object. Two builds could disagree; one cannot.
  assert.match(html, /var packaged=[^;]*parseResearchSafePackage\(researchSafePackage\)/);
  // Tightened when upstream's covered-usage work merged in: the plain list is still built from the
  // parsed package rather than a second build of the safe object, and it must now also carry the
  // covered summary, or a subscription-covered export loses its API-equivalent range on the rail.
  assert.match(html, /describeResearchSafePlain\(packaged,LAST_RESULT&&LAST_RESULT\.coveredShareNote\)/);
  assert.match(html, /renderSharePreview\(packaged\)/);
  assert.doesNotMatch(
    html,
    /describeResearchSafePlain\(pilotSafeObjectFor\(LAST_RESULT\)\)/,
    "the share box must not rebuild the safe object separately from the file it describes"
  );
}

// ---------- 4. rendering shows the values, and escapes them ----------
{
  const payload = samplePayload();
  payload.by_model[1].model = '<img src=x onerror="alert(1)">';
  const model = context.renderSharePreview(payload);
  assert.ok(model, "renderSharePreview must return the model it rendered");
  assert.equal(host.hidden, false);
  assert.ok(host.innerHTML.indexOf("<img src=x") === -1, "a file-derived model name must never reach innerHTML unescaped");
  assert.ok(host.innerHTML.indexOf("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;") >= 0, "the escaped model name must still be visible to the user");
  assert.ok(host.innerHTML.indexOf("data-share-tab=") >= 0, "the preview must offer the report's tabbed breakdown");
  assert.ok(host.innerHTML.indexOf("pilot-value-row") >= 0, "the preview must reuse the report's own row styling");
  // Empty preview state
  assert.equal(context.renderSharePreview(null), null);
  assert.equal(host.hidden, true);
  assert.equal(host.innerHTML, "");
}

// ---------- 5. the preview never invents money, and never prints a bare $0.00 for unknown ----------
{
  assert.equal(context.shareValueText("usd", null), "Unpriced");
  // Resolved in favour of main: a recorded zero is words, never the string $0.00, so that it can
  // never be confused with a price TOP could not work out.
  assert.equal(context.shareValueText("usd", 0), "No charge recorded");
  assert.doesNotMatch(context.shareValueText("usd", 0), /\$/,
    "a recorded zero must carry no dollar figure at all");
  assert.equal(context.shareValueText("usd", 18.4231), "$18.42");
  assert.equal(context.shareValueText("input_usd_per_million", null), "Unpriced");
  // A recorded zero and an unpriceable value must not read the same.
  assert.notEqual(context.shareValueText("usd", 0), context.shareValueText("usd", null));
  const payload = samplePayload();
  payload.cost.usd = null;
  const model = context.buildSharePreviewModel(payload);
  const rows = [];
  model.tabs.forEach((tab) => tab.rows.forEach((row) => rows.push(row)));
  const costRow = rows.find((row) => row.path === "cost.usd");
  assert.ok(costRow, "the cost figure must be shown");
  assert.doesNotMatch(String(costRow.value), /\$0\.00$/, "an unpriceable cost must never render as a bare zero");
}

// ---------- 6. non-money values read as plain language, names stay verbatim ----------
{
  assert.equal(context.shareValueText("status", "checked_reference_rates"), "checked reference rates");
  assert.equal(context.shareValueText("model", "claude-sonnet-4-5"), "claude-sonnet-4-5");
  assert.equal(context.shareValueText("subscription_bill", false), "No");
  assert.equal(context.shareValueText("network_delivery", "none"), "none");
  assert.equal(context.shareValueText("total_tokens", 165900), "165,900");
  assert.equal(context.shareValueText("reasoning_tokens", null), "Not included");
  assert.equal(context.shareFieldLabel("cache_read_tokens"), "Reused from the saved copy");
  assert.equal(context.shareFieldLabel("some_unmapped_key"), "Some unmapped key");
}

// ---------- 7. the preview reads the payload and does not alter it ----------
{
  const payload = samplePayload();
  const before = JSON.stringify(payload);
  context.buildSharePreviewModel(payload);
  context.renderSharePreview(payload);
  assert.equal(JSON.stringify(payload), before, "building the preview must not mutate the payload it describes");
}

// ---------- 8. presentation only: nothing about sending may have moved ----------
{
  assert.match(html, /var TOP_DELIVERY_ENDPOINT="";/, "the delivery endpoint must stay empty");
  assert.match(html, /id="submitResearchReport" disabled/, "the submit control must stay disabled");
  assert.match(html, /id="deliveryReadiness">Direct submission is not configured yet\. Download remains available\./);
  assert.match(html, /connect-src 'none'/, "the CSP must still forbid outbound connections");
  assert.equal((html.match(/\bfetch\s*\(/g) || []).length, 1, "no new network call may be introduced");
  for (const banned of [/XMLHttpRequest/, /sendBeacon/, /\bWebSocket\s*\(/, /EventSource/, /localStorage/, /indexedDB/]) {
    assert.doesNotMatch(html, banned, "share preview must not add a transport or storage surface");
  }
  // Consent, retention and data-processing wording is blocked on a legal decision.
  assert.match(html, /I reviewed the exact research-safe JSON and consent to Adam and Sam receiving it for <code>analyzer_validation<\/code> and <code>forecast_calibration<\/code>/);
  assert.match(html, /may be retained for up to 30 days, including in Resend systems in the United States/);
  assert.match(html, /Cloudflare processes the submission request and Resend processes the email delivery\./);
  // The raw JSON stays available behind the toggle, unchanged.
  assert.match(html, /id="pilotResearchPreview" readonly/);
  assert.match(html, /Show me the actual data\. For the technical: See the exact research-safe JSON that will be downloaded or submitted/);
  assert.match(html, /if\(preview\)preview\.value=researchSafePackage;/, "the raw preview must still show the exact package bytes");
}

console.log("share preview: OK");
