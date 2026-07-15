const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
assert.match(html, /class="mini-emblem"/);
assert.match(html, /\.vcard input\[type=range\][^}]*min-width:0/);
assert.match(html, /@media\(max-width:640px\)\{\.vcard \.vcontrols\{display:grid/);

const forbiddenPatterns = [
  [/\bfetch\s*\(/, "fetch call"],
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/sendBeacon/, "sendBeacon"],
  [/\bWebSocket\s*\(/, "WebSocket"],
  [/web3forms/i, "Web3Forms relay"],
  [/\baccess_key\b/i, "relay access key field"],
  [/ntfy\.sh/i, "visitor notification endpoint"],
  [/fonts\.googleapis|fonts\.gstatic/i, "remote font request"],
  [/id=["']sendbtn["']/, "remote send button"],
  [/mailto:adam1hartley/i, "email collection action"],
  [/send Adam/i, "instruction to send a file to Adam"],
  [/send us/i, "instruction to send a file to TOP"],
  [/\banonym(?:ised|ized|ous)\b/i, "unsupported anonymous-data claim"],
];

for (const [pattern, label] of forbiddenPatterns) {
  assert.equal(pattern.test(html), false, `${label} must not exist in the local analyzer`);
}

assert.match(html, /Nothing is sent automatically\./);
assert.match(html, /Analysis and exports remain local\./);
assert.match(html, /connect-src 'none'/);
assert.match(html, /Copy summary/);
assert.match(html, /Download \.txt/);
assert.match(html, /Analysis is open\. Data collection is paused\./);
assert.match(html, /Please do not send files to TOP yet/);
assert.match(html, /Route A, fastest/);
assert.match(html, /Route B, text-free copy/);
assert.match(html, /Like opening a spreadsheet on your own laptop/);
assert.match(html, /Like sharing the totals from a bank statement instead of the statement itself/);
assert.match(html, /cc:\{[\s\S]*?a:"Choose your original Claude Code session logs[\s\S]*?b:"Run the readable privacy tool first/);
assert.match(html, /chat:\{[\s\S]*?a:"Choose conversations\.json[\s\S]*?b:"Choose conversations\.json/);
assert.match(html, /openai:\{[\s\S]*?a:"Choose your OpenAI conversation export[\s\S]*?b:"Choose your OpenAI conversation export/);
assert.match(html, /csv:\{[\s\S]*?a:"Choose your Anthropic usage CSV[\s\S]*?b:"Choose your Anthropic usage CSV/);
assert.match(html, /class="journey-world"/);
assert.match(html, /function setJourney\(/);
assert.match(html, /assets\/analyzer-ocean-sunset\.webp/);
assert.match(html, /Pok Rie \/ Pexels/);
assert.ok(fs.existsSync(new URL("../assets/analyzer-ocean-sunset.webp", `file://${__dirname}/`)));
assert.doesNotMatch(html, /assets\/nasa-sdo-sun-pia26681\.webp/);
assert.match(html, /assets\/nasa-lro-full-moon-2017\.webp/);
assert.doesNotMatch(html, /NASA\/GSFC\/Solar Dynamics Observatory/);
assert.match(html, /NASA's Scientific Visualization Studio/);
assert.ok(fs.existsSync(new URL("../assets/nasa-lro-full-moon-2017.webp", `file://${__dirname}/`)));
assert.match(html, /\.journey-sun\{[^}]*radial-gradient/);
assert.match(html, /--world-brightness/);
assert.match(html, /--world-saturation/);
assert.match(html, /--world-warmth/);
assert.match(html, /--world-light/);
assert.match(html, /viewBox="0 0 520 390"/);
assert.match(html, /AI cost · output value · value left after cost/);
assert.match(html, /Which Of These Applies To You\?/);
assert.match(html, /Running Out Of Tokens/);
assert.match(html, /Budgeting Tokens Feels Unclear/);
assert.match(html, /My AI Workflow Is Hard To Optimize/);
assert.match(html, /Spending Too Much On AI/);
assert.match(html, /Select all that resonate/);
assert.match(html, /id="providerStep" hidden/);
assert.match(html, /id="routechooser" hidden/);
assert.match(html, /aria-pressed="false"/);
assert.match(html, /starting_challenges:/);
assert.match(html, /id="shareWithTop" hidden/);
assert.match(html, /<h2 id="shareWithTopHeading">Share With TOP<\/h2>/);
assert.match(html, /Sharing is not open yet\./);
assert.match(html, /Download My Safe Copy/);
assert.match(html, /id="shareTopPaused" disabled aria-describedby="shareHold"/);
assert.match(html, /selectedRoute==="b"&&mode==="cc"&&ROUTEB\?buildBJSON\(\):lastSummary/);
assert.match(html, /share\.scrollIntoView\(\{behavior:"smooth",block:"start"\}\)/);
assert.match(html, /document\.getElementById\('shareWithTop'\)\.hidden=true/);
assert.match(html, /ROUTEB=null/);

const holdPosition = html.indexOf("Analysis is open. Data collection is paused.");
const routePosition = html.indexOf('id="routechooser"');
assert.ok(holdPosition >= 0 && routePosition >= 0 && holdPosition < routePosition,
  "the intake pause must be visible before route selection");
const questionPosition = html.indexOf("Which Of These Applies To You?");
const providerPosition = html.indexOf('id="providerStep"');
assert.ok(questionPosition >= 0 && providerPosition > questionPosition && routePosition > providerPosition,
  "the multi-select problem screen must come before provider and route selection");
const surveyPosition = html.indexOf('id="survey"');
const sharePosition = html.indexOf('id="shareWithTop"');
const footerPosition = html.indexOf("<footer>");
assert.ok(surveyPosition >= 0 && sharePosition > surveyPosition && footerPosition > sharePosition,
  "the shared safe-copy step must appear after the questionnaire and before the footer");

console.log("TOP Analyzer privacy regression tests passed");
