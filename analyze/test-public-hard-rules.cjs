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

test("public TOP pages obey the binding copy and research boundaries", () => {
  const failures = [];
  const combined = Object.values(pages).join("\n");

  const emDashPages = matchingPages(/\u2014|&mdash;|&#(?:8212|x2014);|\\u2014/i);
  if (emDashPages.length) failures.push(`em dash found in: ${emDashPages.join(", ")}`);

  // Adam's rule is the literal, broader "no savings talk", so this raw-source
  // gate intentionally includes labels, generated copy, comments, and keys.
  const savingPages = matchingPages(/\bsavings?\b/i);
  if (savingPages.length) failures.push(`savings talk found in: ${savingPages.join(", ")}`);

  const accuracyFigurePatterns = [
    /80%\s+coverage target/i,
    /observed coverage was[\s\S]{0,80}fmtPct/i,
    /["']Coverage \(/,
    /["']Median error \(/,
    /coverage \(target 80%\)/i,
    /coverage_pct\s*=/i,
    /median_rel_err_pct\s*=/i,
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
      const claimTail =
        "(?:(?!\\bnot\\b|[.!?]|</(?:a|p|li|div|section|h[1-6])\\s*>)[\\s\\S]){0,160}?";
      const positiveShip = new RegExp(
        `${stage}${claimTail}\\b(?:`
          + `(?:is|are)\\s+(?:(?:now|currently)\\s+)?(?:live|available|launched|ready\\s+today|shipping|shipped)`
          + `|(?:has|have)\\s+(?:launched|shipped)`
          + `|(?:now|currently)\\s+(?:live|available|shipping|shipped)`
          + `|ships?\\s+today`
          + `|(?:live|available|launched|shipping|shipped)(?:\\s+(?:now|today))?`
          + `)\\b`,
        "i",
      );
      if (positiveShip.test(source)) {
        failures.push(`${stage} is presented as shipped or available on ${page}`);
      }
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
});
