"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1]);

inlineScripts.forEach((source, index) => {
  assert.doesNotThrow(() => new vm.Script(source, { filename: `forecast-inline-${index}.js` }));
});

assert.match(html, /selected log contents stay in this browser/i);
assert.match(html, /does not send their contents to TOP or another service/i);
assert.match(html, /Loading the hosted page still creates routine web requests/i);
assert.match(html, /no log-content upload request/i);
assert.match(html, /External collection is currently paused/i);
assert.match(html, /do not send it to TOP until an approved consent and privacy process is available/i);
assert.match(html, /do not guarantee anonymity/i);
assert.match(html, /content-free aggregate summary/i);
assert.match(html, /selected local sessions/i);
assert.match(html, /No selected log contents were sent/i);
assert.match(html, /id="copybtn" aria-describedby="summarycopy-status"/);
assert.match(html, /id="summarycopy-status" role="status" aria-live="polite"/);
assert.match(html, /typeof navigator\.clipboard\.writeText==="function"/);
assert.match(html, /Automatic copy was blocked/);

for (const retired of [
  /raw data never leaves your browser/i,
  /nothing is uploaded anywhere/i,
  /100% client-side/i,
  /no network calls/i,
  /share your \(anonymised\) result/i,
  /copy anonymised summary/i,
  /send it to Adam yourself/i,
  /uploaded sessions/i,
]) {
  assert.doesNotMatch(html, retired);
}

const source = inlineScripts.join("\n");
assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|sendBeacon/,
  "the forecast page must not gain an automatic network submission path");
assert.equal((html.match(/<script src="forecaster\.js"><\/script>/g) || []).length, 1,
  "the local forecast engine must remain the only script dependency");

console.log("TOP forecast privacy-copy and no-submission regression tests passed");
