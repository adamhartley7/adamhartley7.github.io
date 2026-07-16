const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

assert.match(html, /id="pilotQuickReport" hidden/);
assert.match(html, /Your report is ready/);
assert.match(html, /Your prompts, replies, code and files stayed on this computer/);
assert.match(html, /Estimated API-equivalent cost/);
assert.match(html, /Work sessions found/);
assert.match(html, /Active days found/);
assert.match(html, /Where the priced estimate went/);
assert.match(html, /Your Value Model To Date/);
assert.match(html, /Value of completed work<\/span><strong>Not measured yet/);
assert.match(html, /Verified savings forecast<\/span><strong>Coming soon/);
assert.match(html, /TOP-2 and TOP-3 remain in research and development/);
assert.match(html, /See the full usage and pricing details/);
assert.match(html, /id="pilotContinueToShare"/);

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
