const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

// ---------- the share panel is pinned at the top of the report, not buried under it ----------
const reportStart = html.indexOf('id="pilotQuickReport"');
const reportEnd = html.indexOf('<p class="scope-callout" id="reportScope">', reportStart);
assert.ok(reportStart >= 0 && reportEnd > reportStart, "could not locate the pilot report section");
const report = html.slice(reportStart, reportEnd);

const railPosition = report.indexOf('id="pilotShareRail"');
const deckPosition = report.indexOf('id="pilotStepDeck"');
const navPosition = report.indexOf('class="pilot-stepnav"');
assert.ok(railPosition >= 0, "the pinned share rail must exist inside the report");
assert.ok(deckPosition > railPosition,
  "the share rail must come before the step deck so it is visible on every step");
assert.ok(navPosition > deckPosition, "step navigation must follow the step deck");
assert.match(html, /\.pilot-share-rail\{position:sticky;top:0/,
  "the share rail must stay pinned while the report is read");

// The rail is pinned, so it must stay compact. A tall rail would push the report off screen.
assert.match(html, /\.pilot-share-details\{max-height:40vh;overflow-y:auto\}/,
  "the rail's expanded detail must be capped and scroll internally");

// ---------- sharing must never gate the report ----------
assert.match(html, /Sharing skipped\. Nothing was sent, and your full report is still here\./);
assert.match(html, /id="pilotShareRailSkip">Not now, just show my report/);
const skipHandler = html.slice(html.indexOf('document.getElementById("pilotShareRailSkip")'));
const skipBody = skipHandler.slice(0, skipHandler.indexOf("});"));
assert.doesNotMatch(skipBody, /pilotQuickReport|pilotStepDeck|pilotStepper/,
  "skipping sharing must not touch any part of the report");
assert.match(skipBody, /pilotShareRailOpen"\)\.hidden=true/);
assert.match(skipBody, /pilotShareRailSlim"\)\.hidden=false/);

// ---------- no raw JSON is shown by default ----------
const previewTag = html.slice(html.indexOf('<details class="research-share-preview"'));
const previewOpenTag = previewTag.slice(0, previewTag.indexOf(">") + 1);
assert.doesNotMatch(previewOpenTag, /\sopen[\s>]/,
  "raw JSON must stay collapsed: it reads as hacker output, not as a report");
assert.match(html, /For the technical: See the exact research-safe JSON that will be downloaded or submitted/,
  "the raw JSON must remain reachable behind a quiet, clearly-labelled disclosure");
assert.match(html, /id="pilotResearchPlain"/, "a plain-English summary must replace the raw JSON");
assert.match(html, /In plain English, here is everything in that file/);
assert.match(html, /id="pilotShareRailOneLine"/, "the pinned rail must carry a one-line plain-English summary");

// ---------- calm motion, and reduced motion is respected ----------
assert.match(html, /@keyframes pilotStepIn\{from\{opacity:0;transform:translateY\(9px\)\}to\{opacity:1;transform:none\}\}/);
assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{\.pilot-step\.on\{animation:none\}/,
  "step transitions must be disabled when the reader asks for reduced motion");

// ---------- the plain-English description is read back out of the exact shared object ----------
const excludeStart = html.indexOf("var RESEARCH_EXCLUSION_WORDS=");
const excludeEnd = html.indexOf("function pilotShareScenario()", excludeStart);
assert.ok(excludeStart >= 0 && excludeEnd > excludeStart, "could not locate the plain-English describer");

const fmtStart = html.indexOf("function fmt$(x)");
const fmtEnd = html.indexOf("function fmtQty(x)", fmtStart);
assert.ok(fmtStart >= 0 && fmtEnd > fmtStart, "could not locate number formatters");

const context = { Math, Number, String, Array, Object, JSON, isNaN };
vm.createContext(context);
vm.runInContext(html.slice(fmtStart, fmtEnd), context);
vm.runInContext(html.slice(excludeStart, excludeEnd), context);

assert.equal(context.describeResearchSafePlain(null), null,
  "with no shareable object there is nothing to describe");

const described = context.describeResearchSafePlain({
  totals: { input_tokens: 610000, output_tokens: 155000, cache_write_tokens: 455000, cache_read_tokens: 3360000, reasoning_tokens: null, total_tokens: 4580000 },
  activity: { ai_replies: 2520, usage_events: null, console_records: null, text_messages: null, sessions: 890, active_days: 34 },
  cost: { status: "complete", usd: 8.38 },
  pricing: { applied_rates: [{}, {}, {}] },
  by_model: [{}, {}, {}],
  questionnaire: null,
  value_model: { truth_status: "not_available" },
  privacy: { excluded: ["prompts", "replies", "code", "original_ids"] },
});

assert.match(described.oneLine, /4,580,000 tokens across 3 AI versions/);
assert.match(described.oneLine, /\$8\.38 API-price comparison/);
assert.match(described.oneLine, /No prompts, replies, code or file contents\./);
assert.ok(described.contains.some((line) => /610,000 sent to the AI/.test(line)));
assert.ok(described.contains.some((line) => /3,360,000 reused from the saved copy/.test(line)));
assert.ok(described.contains.some((line) => /2,520 AI replies, 890 work sessions and 34 active days/.test(line)));
assert.ok(described.contains.some((line) => /not your subscription bill/.test(line)));
assert.ok(described.contains.some((line) => /Optional answers: none included\./.test(line)));
assert.equal(described.never, "Never included: your prompts, the AI's replies, your code and original id numbers.");
// A reasoning-token total of null must not be described as a zero.
assert.ok(!described.contains.some((line) => /reasoning/.test(line)),
  "absent token classes must be omitted, never reported as zero");
// truth_status "not_available" means no scenario is in the file, so none may be described.
assert.ok(!described.contains.some((line) => /Illustration/.test(line)));

// Fail-closed: an unpriced report must not gain an invented dollar figure.
const unpriced = context.describeResearchSafePlain({
  totals: { total_tokens: 62000, input_tokens: 50000, output_tokens: 12000, cache_write_tokens: null, cache_read_tokens: null, reasoning_tokens: null },
  activity: { text_messages: 120, sessions: 9, active_days: null },
  cost: { status: "unavailable", usd: null },
  pricing: { applied_rates: [] },
  by_model: [{}],
  questionnaire: null,
  value_model: { truth_status: "not_available" },
  privacy: { excluded: ["prompts"] },
});
assert.match(unpriced.oneLine, /^Counts and totals only: 62,000 tokens across 1 AI version\. No prompts/,
  "an unpriced report must not claim a dollar comparison");
assert.ok(unpriced.contains.some((line) => /Cost: no dollar figure, because TOP could not price this file\./.test(line)));

// An eligible scenario must be described, and named as unvalidated rather than a forecast.
const illustrated = context.describeResearchSafePlain({
  totals: { total_tokens: 100, input_tokens: 100, output_tokens: 0, cache_write_tokens: null, cache_read_tokens: null, reasoning_tokens: null },
  activity: {},
  cost: { usd: 1 },
  pricing: { applied_rates: [{}] },
  by_model: [{}],
  questionnaire: { what_to_improve: ["cost"], source_selected: "claude_code", route_selected: "not_selected" },
  value_model: { truth_status: "illustrative_unvalidated" },
  privacy: { excluded: ["prompts"] },
  timeline: { periods: [{}, {}] },
});
assert.ok(illustrated.contains.some((line) => /unvalidated and not a forecast result/.test(line)));
assert.ok(illustrated.contains.some((line) => /Monthly shape: 2 month rows/.test(line)));
assert.ok(illustrated.contains.some((line) => /Optional answers: 2 category labels you picked yourself\. No free text is included\./.test(line)),
  "chosen category labels must be counted, and free text must stay excluded");

// ---------- every described string reaches the DOM through an escaping sink ----------
const renderStart = html.indexOf("function pilotRenderSharePlain(");
const renderBody = html.slice(renderStart, html.indexOf("function pilotUpdateShareRail(", renderStart));
assert.match(renderBody, /"<li>"\+esc\(line\)\+"<\/li>"/,
  "plain-English lines must be escaped before any innerHTML sink");
assert.match(renderBody, /never\.textContent=/, "the exclusion line must use textContent");

// ---------- the stepper stays entirely local ----------
const stepperStart = html.indexOf("// ---------- pilot report stepper ----------");
const stepperEnd = html.indexOf("function revealStandardPostReport", stepperStart);
assert.ok(stepperStart >= 0 && stepperEnd > stepperStart, "could not locate the stepper");
const stepper = html.slice(stepperStart, stepperEnd);
for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "navigator.sendBeacon", "EventSource", "import(", "//cdn", "https://"]) {
  assert.ok(!stepper.includes(forbidden), `the stepper must stay fully client-side: found ${forbidden}`);
}

console.log("TOP Analyzer pilot stepper and pinned share tests passed");
