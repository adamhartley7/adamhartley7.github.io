const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const start = html.indexOf('<div class="vm" id="vm">');
const end = html.indexOf('<div class="summbox" id="shareSummaryBox"', start);
assert.ok(start >= 0 && end > start, "value model markup not found");
const panel = html.slice(start, end);

assert.match(panel, /self-reported, not measured by TOP/);
assert.match(panel, /id="vmhours" type="number"/);
assert.match(panel, /id="vmrate" type="number"/);
assert.match(panel, /id="vmcurrency"/);
assert.match(panel, /TOP only multiplies the two numbers you provide/);
assert.match(panel, /TOP-2 is R&amp;D/);
assert.match(panel, /TOP-3 is R&amp;D/);
assert.match(panel, /There is no promised saving/);
assert.doesNotMatch(panel, /type="range"/);
assert.doesNotMatch(panel, /invented example/i);
assert.doesNotMatch(panel, /possible saving/i);

assert.match(html, /truth_status:"self_reported_unverified"/);
assert.match(html, /hours_saved_was_not_measured_or_verified_by_top/);
assert.match(html, /non_usd_value_is_not_compared_with_usd_ai_cost/);
assert.match(html, /value\.status!=="complete"/);

const logicStart = html.indexOf("function selfReportedValueInput");
const logicEnd = html.indexOf("function renderValueModel", logicStart);
assert.ok(logicStart >= 0 && logicEnd > logicStart, "self-reported input logic not found");
const fields = {
  vmhours: { value: "8.25" },
  vmrate: { value: "40" },
  vmcurrency: { value: "EUR" },
};
const context = { Number, document: { getElementById(id) { return fields[id] || null; } } };
vm.createContext(context);
vm.runInContext(html.slice(logicStart, logicEnd), context);
assert.deepEqual(JSON.parse(JSON.stringify(context.selfReportedValueInput())), {
  status: "complete", hours_saved: 8.25, value_per_hour: 40, currency: "EUR",
});
fields.vmhours.value = "";
assert.deepEqual(JSON.parse(JSON.stringify(context.selfReportedValueInput())), {
  status: "invalid", reason: "enter_both_or_clear_both", hours_saved: null, value_per_hour: null, currency: "EUR",
});
fields.vmrate.value = "";
assert.deepEqual(JSON.parse(JSON.stringify(context.selfReportedValueInput())), {
  status: "missing", hours_saved: null, value_per_hour: null, currency: "EUR",
});
fields.vmhours.value = "100001";
fields.vmrate.value = "40";
assert.equal(context.selfReportedValueInput().status, "invalid");
assert.equal(context.selfReportedValueInput().reason, "value_outside_supported_range");
fields.vmhours.value = "1";
fields.vmcurrency.value = "PRIVATE_CURRENCY";
assert.deepEqual(JSON.parse(JSON.stringify(context.selfReportedValueInput())), {
  status: "invalid", reason: "unsupported_currency", hours_saved: null, value_per_hour: null, currency: null,
});

assert.match(html, /error\.message!=="invalid_self_reported_value_inputs"/);
assert.match(html, /researchSafePackage=""/);
assert.match(html, /invalidPreview\.value=""/);
assert.match(html, /invalidConsent\.checked=false/);
assert.match(html, /No safe report was prepared/);
const finishSurveySource = html.slice(html.indexOf("function finishSurvey"), html.indexOf('document.getElementById("surveydone")'));
assert.ok(finishSurveySource.indexOf("prepareResearchSafePackage(true)") < finishSurveySource.indexOf("sharePackage=buildSafePackage()"),
  "invalid value inputs must stop before either share package is generated");
assert.doesNotMatch(html, /invalid_user_entered_value_inputs/);
assert.doesNotMatch(html, /self_reported_value_not_shown_for_this_route/);

console.log("TOP Analyzer self-reported value model tests passed");
