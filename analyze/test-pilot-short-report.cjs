const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

assert.match(html, /id="pilotQuickReport" hidden/);
assert.match(html, /Your report is ready/);
assert.match(html, /Your prompts, replies, code and files stayed on this computer/);
assert.match(html, /What this usage would cost at API prices/);
assert.match(html, /Work sessions found/);
assert.match(html, /Active days found/);
assert.match(html, /Which models drove that estimate\?/);
assert.match(html, /What TOP Can Measure Today/);
assert.match(html, /Value of completed work<\/span><strong>Not measured yet/);
assert.match(html, /Verified savings forecast<\/span><strong>Coming soon/);
assert.match(html, /TOP-2 and TOP-3 remain in research and development/);
assert.match(html, /See the full usage and pricing details/);
assert.match(html, /id="pilotContinueToShare"/);
assert.match(html, /Review Sharing Options/);
assert.match(html, /TOP read usage counters locally from the folder you chose/);
assert.match(html, /Partial: "\+costText\+" for models TOP could price/);
assert.match(html, /Ready: "\+costText\+" across all models/);
assert.match(html, /slice\(0,3\)/);
assert.match(html, /Share Your Safe Report/);
assert.match(html, /See exactly what will be shared/);
assert.match(html, /id="pilotResearchPreview" readonly/);
assert.match(html, /Only the complete numbers-only report below can leave this page/);
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

const sunRule = html.match(/\.journey-sun\{[^}]+\}/);
assert.ok(sunRule, "sun rule missing");
assert.match(sunRule[0], /radial-gradient/);
assert.doesNotMatch(sunRule[0], /nasa-sdo-sun/i);
assert.doesNotMatch(html, /Sun: <a href=/);

console.log("TOP Analyzer short pilot report tests passed");
