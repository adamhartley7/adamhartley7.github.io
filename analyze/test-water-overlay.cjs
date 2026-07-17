const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const assetUrl = new URL("../assets/analyzer-water.js", `file://${__dirname}/`);
assert.ok(fs.existsSync(assetUrl), "the same-origin water overlay must exist");
const js = fs.readFileSync(assetUrl, "utf8");

assert.match(html, /<script src="\.\.\/assets\/analyzer-water\.js" defer><\/script>/);
assert.match(html, /\.journey-water\{[^}]*pointer-events:none/);
assert.match(html, /root\.dataset\.journeyProgress=p\.toFixed\(3\)/);
assert.match(html, /top:journey-progress/);
assert.match(html, /connect-src https:\/\/submit\.tokenoptimisationprotocol\.org;/);

for (const [pattern, label] of [
  [/\bfetch\s*\(/, "fetch"],
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/sendBeacon/, "sendBeacon"],
  [/\bWebSocket\s*\(/, "WebSocket"],
  [/\bimport\s*\(/, "dynamic import"],
  [/\beval\s*\(/, "eval"],
]) {
  assert.equal(pattern.test(js), false, `${label} must not exist in the decorative overlay`);
}

assert.match(js, /getContext\("webgl2"/);
assert.match(js, /prefers-reduced-motion: reduce/);
assert.match(js, /1000 \/ 30/);
assert.match(js, /performance\.now\(\) \+ 4000/);
assert.match(js, /2000000/);
assert.match(js, /document\.visibilityState === "hidden"/);
assert.match(js, /webglcontextlost/);
assert.match(js, /aria-hidden/);
assert.match(js, /powerPreference: "low-power"/);
assert.doesNotMatch(js, /three(?:\.module)?/i,
  "a 750 KB rendering library must not be shipped for a single decorative plane");

console.log("TOP Analyzer bounded water-overlay regression tests passed");
