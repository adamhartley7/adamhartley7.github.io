const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const core = fs.readFileSync(new URL("pilot-core.js", `file://${__dirname}/`), "utf8");
const app = fs.readFileSync(new URL("pilot-app.js", `file://${__dirname}/`), "utf8");
const source = core + "\n" + app;

const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
assert.ok(csp, "a strict CSP meta tag is required");
const directives = Object.fromEntries(csp[1].split(";").map(value => value.trim()).filter(Boolean).map(value => {
  const parts = value.split(/\s+/);
  return [parts[0], parts.slice(1)];
}));
assert.deepEqual(directives["connect-src"], ["'none'"]);
assert.deepEqual(directives["form-action"], ["'none'"]);
assert.deepEqual(directives["worker-src"], ["'none'"]);
assert.deepEqual(directives["script-src"], ["'self'"]);
assert.deepEqual(directives["style-src"], ["'self'"]);

for (const [pattern, label] of [
  [/\bfetch\s*\(/, "fetch"],
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/sendBeacon/, "sendBeacon"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/navigator\.serviceWorker|serviceWorker\.register/, "service worker"],
  [/RTCPeerConnection/, "peer connection"],
  [/new\s+Worker\s*\(/, "web worker"],
  [/importScripts\s*\(/, "importScripts"],
]) {
  assert.equal(pattern.test(source), false, `${label} must not exist in the local pilot`);
}

assert.doesNotMatch(html, /(?:src|href)="https?:\/\//i,
  "all page assets and links must be same-origin or relative");
assert.equal((html.match(/<script\s+src=/g) || []).length, 2);
assert.match(html, /<script src="pilot-core\.js"><\/script>/);
assert.match(html, /<script src="pilot-app\.js"><\/script>/);
assert.doesNotMatch(html, /<form\b|\saction=/i);
assert.match(html, /makes no runtime request that transmits participant data/);
assert.match(html, /makes no runtime request that transmits them/);

console.log("TOP prospective pilot no-network and CSP tests passed");
