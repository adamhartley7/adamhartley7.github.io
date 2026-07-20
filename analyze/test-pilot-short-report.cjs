const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

assert.match(html, /id="pilotQuickReport" hidden/);
assert.match(html, /Your report is ready/);
assert.match(html, /Your prompts, replies, code and files stayed on this computer/);
assert.match(html, /Actual cost in the selected files/);
assert.match(html, /Work sessions found/);
assert.match(html, /Deduplicated logical sessions/);
assert.match(html, /id="pilotCoverageNote" hidden/);
assert.match(html, /One"\:fmtN\(n\)\)\+" oversized history line/);
assert.match(html, /so totals may be slightly low/);
assert.match(html, /id="pilotFullCoverage"/);
assert.match(html, /Active days found/);
assert.match(html, /Which models drove your usage\?/);
assert.match(html, /What TOP Can Measure Today/);
assert.match(html, /Value of completed work<\/span><strong>Not measured yet/);
assert.match(html, /Validated customer cost outcome<\/span><strong>Coming soon/);
assert.match(html, /TOP-2 and TOP-3 remain in research and development/);
assert.match(html, /future opt-in can let you enter the value of completed work yourself/);
assert.match(html, /id="pilotPatternDetails" hidden/);
assert.match(html, /See monthly usage and session shapes/);
assert.match(html, /interaction counts only/);
assert.match(html, /do not reveal or guess what your prompts meant/);
assert.match(html, /elapsed spans do not equal active work time/);
assert.match(html, /deduplicates matching logical sessions across files/);
assert.match(html, /Month labels come from source date prefixes and are not timezone-normalized/);
assert.match(html, /renderPilotPatterns\(res\)/);
assert.match(html, /id="pilotTimelineWindowNote" hidden/);
assert.match(html, /datedPeriods\.slice\(-12\)/);
assert.match(html, /downloaded safe report keeps all/);
assert.match(html, /See the full usage and cost details/);
assert.match(html, /id="pilotContinueToShare"/);
assert.match(html, /Review Sharing Options/);
assert.match(html, /TOP read usage counters locally from the folder you chose/);
assert.match(html, /Partial: "\+costText\+" for models TOP could price/);
assert.match(html, /Ready: "\+costText\+" across all models/);
assert.match(html, /slice\(0,3\)/);
assert.match(html, /Share Your Safe Report/);
assert.match(html, /See the exact research-safe JSON that will be downloaded or submitted/);
assert.match(html, /id="pilotResearchPreview" readonly/);
assert.match(html, /Only the complete content-free aggregate report below can leave this page/);
assert.match(html, /usage totals, model labels, source and collector metadata, pricing references/);
assert.match(html, /privacy\.network_delivery: "none"/);
assert.match(html, /TOP had not transmitted the report when it was generated/);
assert.match(html, /Nothing has been sent/);
assert.match(html, /Download My Safe Report/);
assert.match(html, /Share My Safe Report/);
assert.match(html, /buildResearchSafeJSON\(LAST_RESULT,ROUTEB/);

assert.match(html, /if\(PILOT_MODE\)\{/);
assert.match(html, /document\.getElementById\("survey"\)\.hidden=true/);
assert.match(html, /document\.getElementById\("pilotQuickReport"\)\.hidden=false/);
assert.match(html, /pilotContinueToShare.*finishSurvey\(true\)/s);
assert.match(html, /TOP priced "\+fmtN\(pricedRows\.length\)\+" of "\+fmtN\(rows\.length\)/);
assert.match(html, /not your subscription bill/);

// Subscription-covered reports lead with tokens, never with a meaningless zero, and never guess the
// model behind Cursor's Auto mode.
assert.match(html, /What this would cost at API prices/);
assert.match(html, /Your Cursor subscription covered this usage, so nothing extra was charged/);
assert.match(html, /hypothetical API comparison, not your bill or a measured customer outcome/);
assert.match(html, /Cursor's Auto mode does not record which AI version ran/);
assert.match(html, /so TOP cannot show a model mix for this export/);
assert.match(html, /AI version not disclosed/);
assert.match(html, /No charge, plan covered/);
assert.match(html, /id="includedUsage" hidden/);
assert.match(html, /\.pilot-mode #out>#includedUsage/,
  "the covered-usage callout must be hidden in pilot mode, where the pilot report already carries it");
// Every API-equivalent amount must carry the bill and customer-outcome boundary in the same breath.
assert.ok((html.match(/hypothetical API comparison, not your bill or a measured customer outcome/g) || []).length >= 2,
  "both the on-screen callout and downloaded summary must carry the comparison boundary");
assert.doesNotMatch(html, /Verified savings|Possible saving|not a saving|possible saving/i,
  "public analyzer copy must avoid saving language, including negative disclaimers");

const sunRule = html.match(/\.journey-sun\{[^}]+\}/);
assert.ok(sunRule, "sun rule missing");
assert.match(sunRule[0], /radial-gradient/);
assert.doesNotMatch(sunRule[0], /nasa-sdo-sun/i);
assert.doesNotMatch(html, /Sun: <a href=/);

console.log("TOP Analyzer short pilot report tests passed");
