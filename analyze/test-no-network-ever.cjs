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

function extractFunctionSource(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing function marker: ${marker}`);
  const braceStart = source.indexOf("{", start + marker.length);
  assert.ok(braceStart >= 0, `missing function body: ${marker}`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = braceStart; index < source.length; index++) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") { blockComment = false; index++; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (character === "\\") { escaped = true; continue; }
      if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "/") { lineComment = true; index++; continue; }
    if (character === "/" && next === "*") { blockComment = true; index++; continue; }
    if (character === "'" || character === '"' || character === "`") { quote = character; continue; }
    if (character === "{") depth++;
    if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function body: ${marker}`);
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

const permittedUserInitiatedFetch = 'await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:attempt.requestBody,mode:"cors",cache:"no-store",credentials:"omit",redirect:"error",referrerPolicy:"no-referrer"})';

test("the analyzer exposes only the byte-pinned user-initiated delivery fetch and keeps every other connection API absent", () => {
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
    let executable = foldIdentifierStringConcatenations(staticSource.source);
    if (staticSource.label === "analyze/index.html") {
      const exactFetchCount = executable.split(permittedUserInitiatedFetch).length - 1;
      assert.equal(exactFetchCount, 1,
        "the one pre-existing user-initiated delivery fetch must remain byte-identical");
      const handler = extractFunctionSource(executable, "async function submitResearchSafeReport()");
      assert.equal(handler.split(permittedUserInitiatedFetch).length - 1, 1,
        "the permitted fetch must be structurally inside the submit handler");
      const consentGuard = handler.indexOf("!consent.checked");
      const handlerFetch = handler.indexOf(permittedUserInitiatedFetch);
      assert.ok(consentGuard >= 0 && consentGuard < handlerFetch,
        "the explicit consent guard must run before the permitted fetch");
      const submitListener = 'submitResearchButton.addEventListener("click",submitResearchSafeReport)';
      assert.equal(executable.split(submitListener).length - 1, 1,
        "the Submit click must be the only registered entry point");
      const outsideHandlerAndListener = executable.replace(handler, "").replace(submitListener, "");
      assert.doesNotMatch(outsideHandlerAndListener, /\bsubmitResearchSafeReport\b/,
        "the submit handler must have no call or reference outside the one Submit listener");
      assert.match(executable, /var TOP_DELIVERY_ENDPOINT="";/,
        "the pre-existing delivery endpoint must remain unconfigured in the analyzer source");
      executable = executable.replace(permittedUserInitiatedFetch, "");
    } else {
      assert.equal(executable.includes(permittedUserInitiatedFetch), false,
        `${staticSource.label} must not copy the one delivery-fetch exception`);
    }
    for (const [label, pattern] of directNetworkCalls) {
      const matches = executable.match(pattern) || [];
      assert.equal(matches.length, 0,
        `${label} must not exist in ${staticSource.label} outside the one exact user-initiated delivery fetch`);
    }
  }

  assert.doesNotMatch(html,
    /\b(?:src|srcset|poster|action|formaction)\s*=\s*["']\s*(?:https?:|\/\/)/i,
    "the analyzer must not auto-load or submit to a remote URL through markup");
  assert.doesNotMatch(html, /url\(\s*["']?\s*(?:https?:|\/\/)/i,
    "the analyzer must not auto-load a remote URL through CSS");
});
