"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const pages = {
  homepage: fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8"),
  analyzer: fs.readFileSync(path.join(__dirname, "index.html"), "utf8"),
  forecast: fs.readFileSync(path.join(__dirname, "..", "forecast", "index.html"), "utf8"),
};

function matchingPages(pattern) {
  return Object.entries(pages)
    .filter(([, source]) => pattern.test(source))
    .map(([name]) => name);
}

function publicAndGeneratedText(source) {
  return source
    .replace(/<\/(?:a|p|li|div|section|h[1-6]|script)\s*>/gi, ". ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
}

function savingClaimMatch(source) {
  const text = publicAndGeneratedText(source);
  const claimPatterns = [
    /\b(?:save|saves|saved|saving)\s+(?:you\s+)?(?:money|costs?|spend|(?:up\s+to\s+)?(?:US\$|\$|USD\s*)?\d+(?:\.\d+)?\s*(?:%|percent|dollars?|USD)?)\b/gi,
    /\bsavings?\s+(?:of|worth|total(?:l)?ing|equal(?:s|ling)?)\s*(?:US\$|\$|USD\s*)?\d+(?:\.\d+)?\s*(?:%|percent|dollars?|USD)?/gi,
    /(?:US\$|\$|USD\s*)?\d+(?:\.\d+)?\s*(?:%|percent|dollars?|USD)?\s+(?:in\s+)?savings?\b/gi,
    /\b(?:guaranteed|verified|proven|actual|achieved)\s+savings?\b/gi,
    /\b(?:cut|reduce[sd]?|lower(?:ed|s)?)\s+(?:your\s+)?(?:AI\s+)?(?:costs?|spend)\s+by\s+(?:US\$|\$|USD\s*)?\d+(?:\.\d+)?\s*(?:%|percent|dollars?|USD)?/gi,
  ];
  for (const pattern of claimPatterns) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, match.index - 180), match.index);
      const clause = before.split(/[.!?;]|\b(?:but|however)\b/i).pop();
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 100);
      const afterClause = after.split(/[.!?;]/)[0];
      const negated = /\b(?:not|never|no|cannot|can't|won't|doesn't|didn't|isn't|aren't|without)\b/i.test(clause);
      const explicitlyFuture = /\b(?:coming soon|research only|not available)\b/i.test(afterClause);
      if (!negated && !explicitlyFuture) return match[0];
    }
  }
  return "";
}

function stageIsPresentedAsShipped(source, stage) {
  const claimTail =
    "(?:(?!\\b(?:not|never|no|neither|without)\\b|[.!?]|</(?:a|p|li|div|section|h[1-6])\\s*>)[\\s\\S]){0,160}?";
  const positiveShip = new RegExp(
    `${stage}${claimTail}\\b(?:`
      + `(?:is|are)\\s+(?:(?:now|currently)\\s+)?(?:live|available|launched|ready\\s+today|shipping|shipped)`
      + `|(?:has|have)\\s+(?:launched|shipped)`
      + `|(?:now|currently)\\s+(?:live|available|shipping|shipped)`
      + `|ships?\\s+today`
      + `|works?\\s+(?:now|today)`
      + `|(?:live|available|launched|shipping|shipped)(?:\\s+(?:now|today))?`
      + `)\\b`,
    "i",
  );
  return positiveShip.test(source);
}

test("public TOP pages obey the binding copy and research boundaries", () => {
  const failures = [];
  const combined = Object.values(pages).join("\n");

  assert.ok(savingClaimMatch("TOP saves money."), "the claim detector must catch an unqualified money-saving claim");
  assert.ok(savingClaimMatch("TOP can save 35%."), "the claim detector must catch a quantified saving claim");
  assert.ok(savingClaimMatch("TOP saves 35%. TOP-3 is research only."),
    "a later research disclaimer must not excuse a separate saving claim");
  assert.equal(savingClaimMatch("TOP has not proved that it saves money."), "",
    "a truthful negative boundary is not itself a saving claim");
  assert.equal(savingClaimMatch("Previously saved text was reused."), "",
    "cache vocabulary must not be mistaken for a money-saving claim");
  assert.equal(stageIsPresentedAsShipped("TOP-2 is not currently available.", "TOP-2"), false);
  assert.equal(stageIsPresentedAsShipped("TOP-2 has never shipped.", "TOP-2"), false);
  assert.equal(stageIsPresentedAsShipped("TOP-2 works now.", "TOP-2"), true);
  assert.equal(stageIsPresentedAsShipped("TOP-3 has launched.", "TOP-3"), true);

  const emDashPages = matchingPages(/\u2014|&mdash;|&#(?:8212|x2014);|\\u2014/i);
  if (emDashPages.length) failures.push(`em dash found in: ${emDashPages.join(", ")}`);

  const savingClaimPages = Object.entries(pages)
    .filter(([, source]) => savingClaimMatch(source))
    .map(([name]) => name);
  if (savingClaimPages.length) failures.push(`a saving claim was found in: ${savingClaimPages.join(", ")}`);

  const accuracyFigurePatterns = [
    /80%\s+coverage target/i,
    /observed coverage was[\s\S]{0,80}fmtPct/i,
    /["']Coverage \(/,
    /["']Median error \(/,
    /coverage \(target 80%\)/i,
    /(?:coverage|medErr)[\s\S]{0,100}fmtPct|fmtPct[\s\S]{0,100}(?:coverage|medErr)/,
  ];
  accuracyFigurePatterns.push(
    /(?:accuracy|accurate|coverage|median (?:relative )?error)[^\r\n<>]{0,100}\d+(?:\.\d+)?\s*(?:%|percent)/i,
    /\d+(?:\.\d+)?\s*(?:%|percent)[^\r\n<>]{0,100}(?:accuracy|accurate|coverage|median (?:relative )?error)/i,
  );
  if (accuracyFigurePatterns.some((pattern) => pattern.test(combined))) {
    failures.push("a public forecast accuracy figure is still rendered or exported");
  }

  if (/91(?:\.0+)?\s*(?:%|percent|&#37;|&percnt;)/i.test(combined)) {
    failures.push("literal 91% claim found");
  }

  for (const stage of ["TOP-2", "TOP-3"]) {
    for (const [page, source] of Object.entries(pages)) {
      if (!source.includes(stage)) continue;
      const safe = new RegExp(`${stage}[\\s\\S]{0,600}(?:research|idea for later|not available|not a shipped feature|example numbers only)`, "i");
      if (!safe.test(source)) failures.push(`${stage} lacks a research-only boundary on ${page}`);
      if (stageIsPresentedAsShipped(source, stage)) {
        failures.push(`${stage} is presented as shipped or available on ${page}`);
      }
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
});
