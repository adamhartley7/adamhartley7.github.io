"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

// Static spellings complement the browser integration test, which traps these
// APIs at runtime and rejects every non-file page request. Keep both layers so
// a dormant future gate cannot silently re-enable a connection path.
const directNetworkCalls = [
  ["fetch", /(?:\bfetch|\b(?:window|self|globalThis)\s*(?:\.\s*fetch|\[\s*["']fetch["']\s*\]))\s*\(/g],
  ["XMLHttpRequest", /(?:\bXMLHttpRequest|\b(?:window|self|globalThis)\s*(?:\.\s*XMLHttpRequest|\[\s*["']XMLHttpRequest["']\s*\]))\s*\(/g],
  ["sendBeacon", /(?:\bsendBeacon|\b(?:navigator|window\s*\.\s*navigator)\s*(?:\.\s*sendBeacon|\[\s*["']sendBeacon["']\s*\]))\s*\(/g],
  ["WebSocket", /(?:\bWebSocket|\b(?:window|self|globalThis)\s*(?:\.\s*WebSocket|\[\s*["']WebSocket["']\s*\]))\s*\(/g],
  ["EventSource", /(?:\bEventSource|\b(?:window|self|globalThis)\s*(?:\.\s*EventSource|\[\s*["']EventSource["']\s*\]))\s*\(/g],
];

test("the analyzer exposes no direct connection API and keeps a fail-closed CSP", () => {
  assert.match(html, /connect-src 'none'/,
    "the browser policy must continue to block analyzer connections");

  for (const [label, pattern] of directNetworkCalls) {
    const matches = html.match(pattern) || [];
    assert.equal(matches.length, 0,
      `${label} must not exist in the analyzer, even behind a blank endpoint or future configuration gate`);
  }

  assert.doesNotMatch(html,
    /\b(?:src|srcset|poster|action|formaction)\s*=\s*["']\s*(?:https?:|\/\/)/i,
    "the analyzer must not auto-load or submit to a remote URL through markup");
  assert.doesNotMatch(html, /url\(\s*["']?\s*(?:https?:|\/\/)/i,
    "the analyzer must not auto-load a remote URL through CSS");
});
