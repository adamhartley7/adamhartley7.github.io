"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const repositoryRoot = path.resolve(__dirname, "..");

function analyzerStaticSources() {
  const inlineExecutable = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/i.test(match[1])) inlineExecutable.push(match[2]);
  }
  for (const match of html.matchAll(/\bon[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    inlineExecutable.push(match[2]);
  }
  const sources = [{ label: "analyze/index.html", source: inlineExecutable.join("\n") }];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const sourceUrl = match[1].trim();
    if (/^(?:data:|https?:|\/\/)/i.test(sourceUrl)) continue;
    const cleanPath = sourceUrl.split(/[?#]/, 1)[0];
    const resolved = cleanPath.startsWith("/")
      ? path.resolve(repositoryRoot, cleanPath.replace(/^[/\\]+/, ""))
      : path.resolve(__dirname, cleanPath);
    assert.ok(resolved === repositoryRoot || resolved.startsWith(`${repositoryRoot}${path.sep}`),
      `local analyzer script escapes the repository: ${sourceUrl}`);
    assert.ok(fs.existsSync(resolved), `local analyzer script does not exist: ${sourceUrl}`);
    sources.push({
      label: path.relative(repositoryRoot, resolved).replace(/\\/g, "/"),
      source: fs.readFileSync(resolved, "utf8"),
    });
  }
  return sources;
}

function foldIdentifierStringConcatenations(source) {
  let folded = String(source);
  let previous;
  do {
    previous = folded;
    folded = folded.replace(
      /(["'])([A-Za-z_$][\w$]*)\1\s*\+\s*(["'])([A-Za-z_$][\w$]*)\3/g,
      (match, firstQuote, left, secondQuote, right) => JSON.stringify(left + right),
    );
  } while (folded !== previous);
  return folded.replace(
    /\[\s*(["'])(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\1\s*\]/g,
    ".$2",
  );
}

// Static spellings complement the browser integration test, which traps these
// APIs at runtime and rejects every non-file page request. Keep both layers so
// a dormant future gate cannot silently re-enable a connection path.
const directNetworkCalls = [
  ["fetch", /(?:\bfetch\s*(?:\(|\.|\?\.)|\.\s*fetch\b|[=(:,{]\s*\bfetch\b|\b(?:return|typeof|void)\s+fetch\b)/],
  ["XMLHttpRequest", /(?:\bnew\s+XMLHttpRequest\b|\bXMLHttpRequest\s*(?:\(|\.|\?\.)|\.\s*XMLHttpRequest\b|[=(:,{]\s*\bXMLHttpRequest\b)/],
  ["sendBeacon", /(?:\bsendBeacon\s*(?:\(|\.|\?\.)|\.\s*sendBeacon\b|[=(:,{]\s*\bsendBeacon\b)/],
  ["WebSocket", /(?:\bnew\s+WebSocket\b|\bWebSocket\s*(?:\(|\.|\?\.)|\.\s*WebSocket\b|[=(:,{]\s*\bWebSocket\b)/],
  ["EventSource", /(?:\bnew\s+EventSource\b|\bEventSource\s*(?:\(|\.|\?\.)|\.\s*EventSource\b|[=(:,{]\s*\bEventSource\b)/],
];

test("the analyzer exposes no direct connection API and keeps a fail-closed CSP", () => {
  assert.match(html, /connect-src 'none'/,
    "the browser policy must continue to block analyzer connections");

  const dormantAliases = {
    fetch: "const request = globalThis.fetch; function dormant(){ return request('https://example.invalid'); }",
    XMLHttpRequest: "const Request = window.XMLHttpRequest;",
    sendBeacon: "const beacon = navigator.sendBeacon;",
    WebSocket: "const Socket = globalThis['WebSocket'];",
    EventSource: "const Events = self.EventSource;",
  };
  const computedFetchAlias = "const request = globalThis[\"fet\" + \"ch\"];";
  assert.match(foldIdentifierStringConcatenations(computedFetchAlias), directNetworkCalls[0][1],
    "computed fetch aliases must not evade the static no-network gate");
  const harmlessText = 'const note = "No fetch requests are made";';
  assert.doesNotMatch(harmlessText, directNetworkCalls[0][1],
    "non-executable user-facing network vocabulary must remain permitted");
  for (const [label, pattern] of directNetworkCalls) {
    assert.match(foldIdentifierStringConcatenations(dormantAliases[label]), pattern,
      `${label} aliases must not evade the static no-network gate`);
  }

  const staticSources = analyzerStaticSources();
  assert.ok(staticSources.some((source) => source.label === "assets/analyzer-water.js"),
    "the static gate must include the analyzer's loaded local script assets");
  for (const staticSource of staticSources) {
    const executable = foldIdentifierStringConcatenations(staticSource.source);
    for (const [label, pattern] of directNetworkCalls) {
      const matches = executable.match(pattern) || [];
      assert.equal(matches.length, 0,
        `${label} must not exist in ${staticSource.label}, even behind a blank endpoint or future configuration gate`);
    }
  }

  assert.doesNotMatch(html,
    /\b(?:src|srcset|poster|action|formaction)\s*=\s*["']\s*(?:https?:|\/\/)/i,
    "the analyzer must not auto-load or submit to a remote URL through markup");
  assert.doesNotMatch(html, /url\(\s*["']?\s*(?:https?:|\/\/)/i,
    "the analyzer must not auto-load a remote URL through CSS");
});
