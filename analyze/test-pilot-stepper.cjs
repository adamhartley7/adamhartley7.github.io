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

// ---------- the pinned rail must not lead a subscription-covered export with $0.00 ----------
// The rail is the first thing on screen, so its one-liner carries the first dollar figure the reader
// meets. On the founder's real export cost.usd is the RECORDED CHARGE of zero: it is the subscription
// outcome, not an API-price comparison. Printing it put "$0.00" above a report whose own headline is
// "$2.66 to $49.86". The describer is handed the body's covered summary and must use it instead.
const coveredNote = { amount: "$2.66 to $49.86", isRange: true, rateCount: 10, modelsUndisclosed: true };
const coveredSafeObject = {
  totals: { input_tokens: 2065761, output_tokens: 98409, cache_write_tokens: 0, cache_read_tokens: 7665024, reasoning_tokens: null, total_tokens: 9829194 },
  activity: { ai_replies: null, usage_events: 34, console_records: null, text_messages: null, sessions: null, active_days: 1 },
  // What buildResearchSafeObject really produces for that file: a recorded charge of zero and no
  // applied rate card, because Cursor never disclosed a model to price.
  cost: { status: "partial", usd: 0 },
  pricing: { applied_rates: [] },
  by_model: [{}],
  questionnaire: null,
  value_model: { truth_status: "not_available" },
  privacy: { excluded: ["prompts", "replies", "code"] },
};
const coveredPlain = context.describeResearchSafePlain(coveredSafeObject, coveredNote);
const coveredText = [coveredPlain.oneLine].concat(coveredPlain.contains).join("\n");

assert.ok(!/\$0\.00/.test(coveredText),
  "a subscription-covered export must never present its zero recorded charge as a dollar figure");
assert.match(coveredPlain.oneLine, /\$2\.66 to \$49\.86/,
  "the rail one-liner must carry the same API-equivalent range the report headline shows");
assert.match(coveredPlain.oneLine, /9,829,194 tokens/);
assert.match(coveredPlain.oneLine, /No prompts, replies, code or file contents\./);

// The cost line must not invert the two facts. $0.00 is the subscription outcome; the range is the
// API comparison. The old line said the reverse.
const coveredCost = coveredPlain.contains.find((line) => /^Cost: /.test(line));
assert.ok(coveredCost, "a cost line must still be described");
assert.match(coveredCost, /subscription covered this usage/);
assert.match(coveredCost, /\$2\.66 to \$49\.86/);
assert.match(coveredCost, /not money you paid and not a saving/,
  "the covered cost line must refuse both the bill claim and the saving claim");
assert.ok(!/comparison against published API rates\. It is not your subscription bill\./.test(coveredCost),
  "the uncovered wording inverts the facts on a covered export and must not be reused there");

// The applied-rate count must agree with the report body, which priced these tokens against all 10
// cards in the checked table. Reading pricing.applied_rates gave 0 and contradicted it.
const coveredPricing = coveredPlain.contains.find((line) => /^Pricing: /.test(line));
assert.match(coveredPricing, /the 10 published rate cards/,
  "the rail must name the rate cards the range was actually built from");
assert.ok(!/the 0 published rate card/.test(coveredPricing));

// "auto" is not a model name. The one by_model row must not be presented as one.
const coveredModels = coveredPlain.contains.find((line) => /^AI versions: /.test(line));
assert.match(coveredModels, /none named/);
assert.match(coveredModels, /did not record which AI version ran/);
assert.ok(!/1 model name/.test(coveredModels),
  "an undisclosed AI version must never be counted as a disclosed model name");
assert.ok(!/across 1 AI version/.test(coveredPlain.oneLine),
  "the one-liner must not claim a model count the file never disclosed");

// A covered export whose models WERE all disclosed gets one exact figure, and keeps the ordinary
// model-name wording, because there a model name really is on file.
const coveredNamed = context.describeResearchSafePlain(
  Object.assign({}, coveredSafeObject, { by_model: [{}, {}] }),
  { amount: "$12.40", isRange: false, rateCount: 2, modelsUndisclosed: false },
);
assert.match(coveredNamed.oneLine, /across 2 AI versions, with a \$12\.40 API-price comparison/);
assert.match(coveredNamed.contains.find((line) => /^AI versions: /.test(line)), /2 model names/);
assert.match(coveredNamed.contains.find((line) => /^Pricing: /.test(line)), /the 2 published rate cards TOP applied/);
assert.ok(!/\$0\.00/.test([coveredNamed.oneLine].concat(coveredNamed.contains).join("\n")));

// Absent the covered summary, nothing changes: the uncovered path is still driven by cost.usd.
const uncovered = context.describeResearchSafePlain(coveredSafeObject);
assert.match(uncovered.contains.find((line) => /^Cost: /.test(line)), /It is not your subscription bill\./);

// ---------- the rail is wired to the report body's own covered summary ----------
// The describer is pure, so these assertions pin the wiring that feeds it. Without them the describer
// could be correct while both call sites still passed nothing.
assert.match(html, /res\.coveredShareNote=included\?\{/,
  "render must publish the covered summary on the result the share surfaces read");
assert.match(html, /amount:cursorIncludedUsageAmount\(included\)/,
  "the rail's dollar figure must be the same one the report body prints, not a second derivation");
assert.match(html, /rateCount:included\.exact===null\?included\.range\.count:Object\.keys\(usedPriceKeys\)\.length/,
  "the rate-card count must come from the range actually used, or the rates actually applied");
assert.match(html, /describeResearchSafePlain\(pilotSafeObjectFor\(res\),res&&res\.coveredShareNote\)/,
  "the pinned rail must pass the covered summary through");
assert.match(html, /describeResearchSafePlain\(pilotSafeObjectFor\(LAST_RESULT\),LAST_RESULT&&LAST_RESULT\.coveredShareNote\)/,
  "the expanded plain-English list must pass it too, or the two surfaces would disagree");

// ---------- the range chart's axis must let the band read at its real scale ----------
// pilotNiceMax steps 5 straight to 10, so a $49.86 high end rounded the axis to $100 and the band
// filled half the canvas. Nothing was misstated, but the picture understated the magnitude.
const fineStart = html.indexOf("function pilotNiceMaxFine(");
assert.ok(fineStart > 0, "the range chart needs its own finer axis ladder");
assert.match(html, /var maxY=pilotNiceMaxFine\(high\*1\.08\)/,
  "the range chart must use the finer ladder rather than the coarse shared one");
const fineBody = html.slice(fineStart, html.indexOf("function pilotAxisMoney(", fineStart));
const fineCtx = { Math };
vm.createContext(fineCtx);
vm.runInContext(fineBody, fineCtx);
assert.equal(fineCtx.pilotNiceMaxFine(49.86 * 1.08), 60,
  "the founder's $49.86 high end must not round the axis all the way to $100");
assert.ok(49.86 / fineCtx.pilotNiceMaxFine(49.86 * 1.08) > 0.8,
  "the high end must reach past 80% of the axis so the band is legible at its real size");
assert.equal(fineCtx.pilotNiceMaxFine(0), 1, "a zero or negative high end must still yield a usable axis");
assert.equal(fineCtx.pilotNiceMaxFine(-5), 1);
// The ladder must never crop the value it was given.
for (const v of [0.004, 0.37, 1.01, 2.4, 5.01, 9.9, 53.85, 410, 7300]) {
  assert.ok(fineCtx.pilotNiceMaxFine(v) >= v, `the axis must contain ${v}`);
  assert.ok(fineCtx.pilotNiceMaxFine(v) <= v * 1.55, `the axis must stay close to ${v}`);
}

// ---------- "auto" must not be listed as a model without a checked price ----------
// It is not a model name, so it cannot head the "AI versions without a checked price" list. The fact
// is stated by the undisclosed-rows disclosures instead, which give the count and the reason.
assert.ok(!/undisclosedLabels/.test(html),
  "the diverted-label array was dead; either it is used or it is gone");
assert.match(html, /if\(!\(res\.cursor&&cursorUndisclosedModel\(model\)\)\)unpriced\.push\(safePublicModelLabel\(model\)\)/,
  "an undisclosed AI version must stay out of the unpriced-model list");
assert.match(html, /if\(res\.undisclosedRows\) lines\.push\("AI version disclosure: /,
  "the undisclosed rows must still be disclosed by count and reason");

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

// ---------- token types are explained in plain English, not left as jargon ----------
// A reader who has never met "cache read" must still be able to read the caching chart, so every
// entry in PILOT_TYPE_ORDER carries a fourth element: its meaning in ordinary words.
const typeOrderStart = html.indexOf("var PILOT_TYPE_ORDER=");
assert.ok(typeOrderStart >= 0, "could not locate PILOT_TYPE_ORDER");
const typeOrder = html.slice(typeOrderStart, html.indexOf("var PILOT_TIER_ORDER=", typeOrderStart));
for (const key of ["inp", "cw", "cr", "out"]) {
  const entry = new RegExp(`\\["${key}","[^"]+","#[0-9a-f]{6}","[^"]+"\\]`);
  assert.match(typeOrder, entry, `token type ${key} must carry a plain-English meaning`);
}
assert.ok(/text read again from that copy/.test(typeOrder) && /billed far more cheaply/.test(typeOrder),
  "the reused-from-cache type must say, in plain words, that it is billed far more cheaply");

// The legend renders those meanings, and escapes both the label and the meaning.
const legendStart = html.indexOf("function pilotLegend(");
const legendBody = html.slice(legendStart, html.indexOf("function pilotNiceMax(", legendStart));
assert.match(legendBody, /esc\(item\[0\]\)/, "legend labels must be escaped");
assert.match(legendBody, /esc\(item\[2\]\)/, "legend meanings must be escaped");
assert.match(legendBody, /class="glossed"/, "glossed legend entries need their own class");
assert.match(html, /pilotLegend\(PILOT_TYPE_ORDER\.map\(function\(t\)\{return \[t\[1\],t\[2\],t\[3\]\]\}\)\)/,
  "the caching chart legend must pass the plain-English meaning through");

// Layout invariant: `.pilot-legend span` is inline-flex, which would lay the label and its meaning
// out side by side. The wrapper must override that back to a block so they stack. Specificity
// (0,2,0) beats (0,1,1), so this rule wins wherever it sits in the sheet.
assert.match(html, /\.pilot-legend \.gloss-text\{display:block/,
  "the gloss wrapper must override the inline-flex legend span so label and meaning stack");
assert.match(html, /\.pilot-legend \.gloss-text b\{display:block/, "the label must be its own line");
assert.match(html, /\.pilot-legend \.gloss-text em\{display:block/, "the meaning must be its own line");
assert.match(html, /\.pilot-legend span\.glossed\{[^}]*flex:1 1 205px/,
  "glossed entries need a flex basis so they stack one-per-row on a phone");

// ---------- the plain-English key sits under every model table ----------
assert.equal((html.match(/class="token-key"/g) || []).length, 3,
  "all three model tables must carry the plain-English column key");
assert.match(html, /\.token-key\[hidden\]\{display:none!important\}/,
  "the key is display:grid, so [hidden] needs !important to actually hide it");
assert.match(html, /\.token-key\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(235px,1fr\)\)/,
  "the key must reflow to a single column on a narrow phone");
// Copilot exports have no token columns at all, so the key must not describe columns that are absent.
assert.match(html, /\["tokenKey","pilotTokenKey"\]\.forEach\(function\(id\)\{[\s\S]{0,120}hidden=!!res\.copilot/,
  "the token key must be hidden for Copilot, which meters credits rather than tokens");

// ---------- the Cursor export instructions point at the website, not the editor ----------
// The export is on the Cursor dashboard in a browser. Telling people to look in the app sends them
// hunting for a menu that does not exist.
for (const stale of [/In Cursor, open <b>Settings<\/b>/, /Cursor Settings, then Usage/, /Settings, then Usage, then Export/, /Open Cursor and sign in/]) {
  assert.ok(!stale.test(html), `stale Cursor export instruction must be gone: ${stale}`);
}
assert.ok(html.includes("cursor.com/dashboard"), "the Cursor instructions must name the dashboard URL");
assert.ok((html.match(/Cursor editor/g) || []).length >= 3,
  "the main Cursor instruction surfaces must rule out the editor explicitly");

// ---------- a subscription-covered report is charted in tokens, not in an empty dollar axis ----------
// The founder's real export charges $0 on every row and never names a model. The old charts degraded to
// an empty cost axis, a single bar labelled "auto", and two blank steps. Each of those is now either a
// real chart drawn from the tokens or a short honest line, and never an axis with nothing on it.
const scaleStart = html.indexOf("function pilotScaleChartHTML(");
const scaleBody = html.slice(scaleStart, html.indexOf("function pilotRangeChartHTML(", scaleStart));
assert.match(scaleBody, /res\.subscriptionCovered[\s\S]{0,200}pilotTokenTimeChartHTML\(res,true\)/,
  "a subscription-covered export must be charted in tokens rather than dollars");
assert.match(scaleBody, /pilotMonthlyTokenChartHTML\(res\)\|\|pilotTokenTimeChartHTML\(res,false\)/,
  "a source with no priced day series must still fall back to a token chart, never to an empty axis");

const tokenChartStart = html.indexOf("function pilotTokenTimeChartHTML(");
const tokenChartBody = html.slice(tokenChartStart, html.indexOf("function pilotScaleChartHTML(", tokenChartStart));
assert.match(tokenChartBody, /pilotGridY\(L,R,T,B,maxY,pilotAxisTokens\)/,
  "the token timeline's y axis must be formatted in tokens, not dollars");
assert.doesNotMatch(tokenChartBody, /pilotAxisMoney|fmt\$/,
  "nothing on the token timeline may be priced, so no dollar formatter belongs in it");
assert.match(tokenChartBody, /Cumulative tokens/, "the axis must say, in words, that it is counting tokens");
assert.match(tokenChartBody, /not adjusted for time zones/,
  "hour and day labels are read as written, and the chart must say so");
assert.match(tokenChartBody, /pts\.length<3[\s\S]{0,400}pilotPlain\(/,
  "too few points must produce a sentence, never a curve through two dots");

// Hours are only ever drawn when every dated row actually carried one.
const seriesStart = html.indexOf("function pilotTokenTimeSeries(");
const seriesBody = html.slice(seriesStart, tokenChartStart);
assert.match(seriesBody, /timeline\.hourRows>0&&timeline\.hourRows===timeline\.datedRows/,
  "an hourly axis requires every dated row to carry a real hour");

// ---------- the token composition is a chart in its own right where there is no rate ----------
const compStart = html.indexOf("function pilotCompositionChartHTML(");
const compBody = html.slice(compStart, html.indexOf("function pilotCacheChartHTML(", compStart));
assert.match(compBody, /PILOT_TYPE_ORDER\.filter\(function\(t\)\{return totals\[t\[0\]\]>0\}\)/,
  "only token types actually present may take a segment");
assert.match(compBody, /pilotCompositionRows\(/, "the proportional bar must carry labelled rows with real counts");
assert.match(compBody, /is not claiming you saved anything/,
  "the cache callout must refuse the saving claim outright");
assert.doesNotMatch(compBody, /fmt\$/, "an unpriced composition must not print a dollar figure");
assert.match(html, /if\(!\(costTotal>0\)\)return pilotCompositionChartHTML\(res,totals,tokTotal\)/,
  "with no rate to price the types, the composition becomes the chart rather than one thin strip");

const rowsStart = html.indexOf("function pilotCompositionRows(");
const rowsBody = html.slice(rowsStart, html.indexOf("function pilotTokenTimeSeries(", rowsStart) > 0
  ? html.indexOf("function pilotNiceMax(", rowsStart) : html.length);
for (const escaped of [/esc\(item\[0\]\)/, /esc\(item\[2\]\)/, /esc\(fmtN\(item\[3\]\)\)/, /esc\(pilotPct\(item\[3\],total\)/]) {
  assert.match(rowsBody, escaped, `composition row text must be escaped before the innerHTML sink: ${escaped}`);
}

// ---------- a model mix nobody disclosed is replaced, not faked ----------
const mixStart = html.indexOf("function pilotMixChartHTML(");
const mixBody = html.slice(mixStart, html.indexOf("function pilotCompositionChartHTML(", mixStart));
assert.match(mixBody, /res\.cursor&&res\.modelsUndisclosed[\s\S]{0,300}pilotRangeChartHTML\(res,included\)/,
  "an undisclosed model must get the API-equivalent range chart, never a bar labelled auto");
const rangeStart = html.indexOf("function pilotRangeChartHTML(");
const rangeBody = html.slice(rangeStart, mixStart);
assert.match(rangeBody, /not money you paid and it is not a saving/,
  "the range chart must refuse both the bill claim and the saving claim");
assert.match(rangeBody, /PRICING_CHECKED_DATE/, "the range must name when its rates were checked");
assert.match(rangeBody, /stacked/, "the two range labels must stack rather than collide on a narrow phone");

// ---------- steps that cannot be answered say so, instead of rendering an empty axis ----------
const routingStart = html.indexOf("function pilotRoutingChartHTML(");
const routingBody = html.slice(routingStart, html.indexOf("function pilotShapeChartHTML(", routingStart));
assert.match(routingBody, /!pilotRatePriced\(res\)\)\{[\s\S]{0,400}res\.cursor[\s\S]{0,120}pilotPlain\(/,
  "a Cursor export with no applied rate must get an honest line, not a blank tier bar");
assert.match(routingBody, /will not guess/, "the tier step must say plainly that it is not guessing");
assert.match(html, /function pilotShapeFallbackHTML\(res\)\{\s*return pilotShapeBucketChartHTML\(res\)\|\|pilotEventConcentrationChartHTML\(res\)/,
  "the shape step must fall back to a real token curve before it falls back to nothing");
const eventStart = html.indexOf("function pilotEventConcentrationChartHTML(");
const eventBody = html.slice(eventStart, html.indexOf("function pilotShapeBucketChartHTML(", eventStart));
assert.match(eventBody, /values\.length<5[\s\S]{0,300}pilotPlain\(/,
  "too few usage events must produce a sentence rather than a distribution drawn from nothing");
assert.doesNotMatch(eventBody, /fmt\$/, "the token concentration curve must not print dollars");

// ---------- every new chart stays inline, accessible, and honest about motion ----------
for (const fn of ["pilotTokenTimeChartHTML", "pilotRangeChartHTML", "pilotCompositionChartHTML", "pilotEventConcentrationChartHTML"]) {
  const start = html.indexOf(`function ${fn}(`);
  assert.ok(start > 0, `${fn} must exist`);
  const body = html.slice(start, start + 6000);
  assert.match(body, /pilotSvg\(/, `${fn} must draw hand-rolled inline SVG`);
  for (const f of ["fetch(", "XMLHttpRequest", "<img", "https://", "@import", "url(http"]) {
    assert.ok(!body.includes(f), `${fn} must stay fully offline: found ${f}`);
  }
}
// pilotSvg is the only door into an SVG, and it always sets role and a label, so every chart above
// carries a text alternative. Motion runs through the existing classes, which reduced motion disables.
assert.match(html, /function pilotSvg\(w,h,label,body\)\{[\s\S]{0,200}role="img" aria-label="'\+esc\(label\)/,
  "every chart must carry an escaped text alternative");
for (const cls of ["pilot-sweep", "pilot-fade", "pilot-grow", "pilot-rise"]) {
  assert.ok(html.includes(`@media(prefers-reduced-motion:reduce){.pilot-step.on .pilot-sweep`),
    "reduced motion must switch the chart animations off");
  assert.ok(html.includes(cls), `${cls} must remain a real class the reduced-motion rule covers`);
}
// Narrow phones: the labels that would otherwise run off the canvas have short variants.
assert.match(html, /narrow\?"Dashed line: all events equal"/, "the event curve needs a phone-width label");
assert.match(html, /narrow\?"Dashed line: all sessions equal"/, "the session curve needs a phone-width label");

// ---------- a mixed Cursor export must not name a rounding error as the model that drove the cost ----
// The shares in the mix panel are shares of PRICED cost. An Auto row can never be priced, so in an export
// that mixes Auto with one named model the named model is always 100% of the priced total however small
// it is. On the real shape below the named row is 1,300 of 6,721,300 tokens, 0.02% of the work, and it
// rendered as "claude-4.5-sonnet 100%" under the heading "Which models drove that estimate?", beside a
// lead reading "2 AI versions recorded" that counted Auto as one of them. The all-or-nothing
// modelsUndisclosed flag could not catch it: one disclosed row switched model naming back on.
const mixStart2 = html.indexOf("function pilotMixWithheld(");
assert.ok(mixStart2 > 0,
  "the mix panel's disclosure gate must be a named, testable function: inline res.modelsUndisclosed in render() lets one disclosed row put a 0.02%-of-tokens model on screen as '100%'");
const mixPanelBody = html.slice(mixStart2, html.indexOf("function render(res){", mixStart2));
assert.ok(mixPanelBody.length > 0, "the mix panel helpers must sit above render()");

const helperStart = html.indexOf("function fmt$(x)");
const mixCtx = { Math, Number, String, Array, Object };
vm.createContext(mixCtx);
vm.runInContext(html.slice(helperStart, html.indexOf("function pricingDetailsHTML(", helperStart)), mixCtx);
vm.runInContext(mixPanelBody, mixCtx);

const mixedRes = { cursor: true, turns: 13, undisclosedRows: 12, modelsUndisclosed: false };
const namedRow = { model: "claude-4.5-sonnet", cost: 0.0047 };

assert.equal(mixCtx.pilotMixWithheld(mixedRes), true,
  "one undisclosed row is enough to withhold the mix, exactly as one unreadable charge withdraws the covered claim");
const mixedPanel = mixCtx.pilotMixPanelHTML(mixedRes, [namedRow], 0.0047);
assert.ok(!/<span>100%<\/span>/.test(mixedPanel),
  "a mixed export must never present the only priceable row as 100% of the mix");
assert.ok(!/pilot-model-track/.test(mixedPanel),
  "no share track may be drawn from a priced total that excludes most of the work");
assert.ok(!/claude-4\.5-sonnet/.test(mixedPanel),
  "a model that ran 0.02% of the tokens must not be named as the one that drove the cost");
assert.match(mixedPanel, /did not record which AI version ran for 12 of these 13 usage events/,
  "the panel must say how many rows were left unnamed, and why there is no mix");
assert.ok(!/<div class="pilot-model-row">/.test(mixedPanel), "no share bar may be drawn at all");

assert.equal(mixCtx.pilotMixHeadingText(mixedRes), "What would these tokens cost at API prices?",
  "the heading must not ask which models drove an estimate the file cannot attribute");
const mixedLead = mixCtx.pilotMixLeadText(mixedRes, 2);
assert.ok(!/2 AI versions recorded/.test(mixedLead),
  '"auto" is not an AI version, so a mixed export must not report it as one');
assert.match(mixedLead, /picked an AI version for 12 of these 13 usage events/);

// The wholly-undisclosed export keeps its existing wording, and the wholly-disclosed one keeps its bars.
const allAuto = { cursor: true, turns: 34, undisclosedRows: 34, modelsUndisclosed: true };
assert.equal(mixCtx.pilotMixWithheld(allAuto), true);
assert.match(mixCtx.pilotMixPanelHTML(allAuto, [], 0), /TOP cannot show a model mix for this export/);
assert.equal(mixCtx.pilotMixHeadingText(allAuto), "What would these tokens cost at API prices?");
assert.match(mixCtx.pilotMixLeadText(allAuto, 1), /each of these 34 usage events/);

const allNamed = { cursor: true, turns: 5, undisclosedRows: 0, modelsUndisclosed: false };
assert.equal(mixCtx.pilotMixWithheld(allNamed), false);
assert.equal(mixCtx.pilotMixHeadingText(allNamed), "Which models drove that estimate?");
assert.equal(mixCtx.pilotMixLeadText(allNamed, 2), "2 AI versions recorded in the files you chose.");
const namedPanel = mixCtx.pilotMixPanelHTML(allNamed, [{ model: "claude-4.5-sonnet", cost: 3 }, { model: "gpt-5", cost: 1 }], 4);
assert.match(namedPanel, /claude-4\.5-sonnet/);
assert.match(namedPanel, /75%/, "a fully disclosed export must still get its real priced shares");
// Non-Cursor sources are untouched by the gate.
assert.equal(mixCtx.pilotMixWithheld({ turns: 3 }), false);
assert.equal(mixCtx.pilotMixWithheld(null), false);
// Model labels still reach the innerHTML sink through esc().
assert.match(mixPanelBody, /esc\(safePublicModelLabel\(row\.model\)\)/,
  "model labels must stay escaped before the innerHTML sink");
assert.match(mixPanelBody, /"<p>"\+esc\(pilotMixWithheldText\(res\)\)\+"<\/p>"/,
  "the withheld sentence must be escaped too");

// The render call sites must go through those functions, or the panel could regress independently.
assert.match(html, /document\.getElementById\("pilotUsageMix"\)\.innerHTML=pilotMixPanelHTML\(res,shownRows,pricedTotal\)/,
  "the mix panel must be rendered by the gated function, never by an inline shownRows.length check");
assert.match(html, /mixHeading\.textContent=pilotMixHeadingText\(res\)/);
assert.match(html, /document\.getElementById\("pilotMixLead"\)\.textContent=pilotMixLeadText\(res,rows\.length\)/);
assert.match(mixBody, /pilotMixWithheld\(res\)[\s\S]{0,120}pilotRangeChartHTML\(res,included\)/,
  "the mix CHART must be withheld on the same condition as the mix panel");

// ---------- the same table must not both print a cost and say nothing was charged ----------
// On a covered export the row cost is an API-price comparison, not a charge. Printing "~$0.0047" in the
// Cost column above a footer reading "No charge, plan covered" made one table say two things at once.
assert.match(html, /cursorUndisclosedModel\(r\.model\)\?"AI version not disclosed":\(included\?"No charge, plan covered"/,
  "a covered export's per-row cost cell must agree with its own table footer");

// ---------- the pinned rail must not count "auto" as an AI version in a mixed export ----------
const mixedNote = { amount: "$2.66 to $49.86", isRange: true, rateCount: 10, modelsUndisclosed: false, someUndisclosed: true, undisclosedRows: 12 };
const mixedPlain = context.describeResearchSafePlain(
  Object.assign({}, coveredSafeObject, { by_model: [{}, {}] }),
  mixedNote,
);
assert.ok(!/across 2 AI versions/.test(mixedPlain.oneLine),
  "a mixed export must not report Auto as one of two AI versions");
assert.match(mixedPlain.oneLine, /AI version not disclosed on some rows/);
const mixedModels = mixedPlain.contains.find((line) => /^AI versions: /.test(line));
assert.match(mixedModels, /not all named/);
assert.match(mixedModels, /did not record which AI version ran for 12 of these usage events/);
assert.ok(!/2 model names/.test(mixedModels),
  "one of those rows is Auto, which is not a model name");
// render must publish the partial flag, or the describer could be right and still never see it.
assert.match(html, /someUndisclosed:!!res\.undisclosedRows/,
  "render must carry the partial-disclosure flag onto the covered summary the rail reads");
assert.match(html, /undisclosedRows:res\.undisclosedRows\|\|0/);

console.log("TOP Analyzer pilot stepper and pinned share tests passed");
