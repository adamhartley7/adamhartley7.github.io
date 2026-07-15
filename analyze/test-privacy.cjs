const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

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
];

for (const [pattern, label] of forbiddenPatterns) {
  assert.equal(pattern.test(html), false, `${label} must not exist in the local analyzer`);
}

assert.match(html, /Nothing is sent automatically\./);
assert.match(html, /Analysis and exports remain local\./);
assert.match(html, /connect-src 'none'/);
assert.match(html, /Copy summary/);
assert.match(html, /Download \.txt/);

console.log("TOP Analyzer privacy regression tests passed");
