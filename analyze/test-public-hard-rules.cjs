"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function readRelative(...segments) {
  return fs.readFileSync(path.join(__dirname, ...segments), "utf8");
}

const pages = {
  homepage: readRelative("..", "index.html"),
  analyzer: readRelative("index.html"),
  forecast: [
    readRelative("..", "forecast", "index.html"),
    readRelative("..", "forecast", "forecaster.js"),
  ].join("\n"),
  pilot: [
    readRelative("..", "pilot", "index.html"),
    readRelative("..", "pilot", "pilot-core.js"),
    readRelative("..", "pilot", "pilot-app.js"),
  ].join("\n"),
  pitch: readRelative("..", "pitch", "index.html"),
  dashboard: readRelative("..", "dashboard", "index.html"),
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
    /\b(?:a|the|this|that|our|your)\s+savings?\b/gi,
    /\b(?:means?|represents?|delivers?|creates?|produces?)\s+(?:a\s+|the\s+)?savings?\b/gi,
    /\b(?:cuts?|cutting|reduces?|reduced|reducing|lowers|lowered|lowering)\s+(?:your\s+)?(?:AI\s+)?(?:costs?|spend)\b/gi,
    /\b(?:can|could|will|would|may|might|does|helps?\s+to|aims?\s+to)\s+(?:cut|reduce|lower)\s+(?:your\s+)?(?:AI\s+)?(?:costs?|spend)\b/gi,
    /\blower\s+(?:your|our|the)\s+(?:AI\s+)?(?:costs?|spend)\b/gi,
    /(?:^|[.!?]\s+)(?:cut|reduce|lower)\s+(?:your|our|the)\s+(?:AI\s+)?(?:costs?|spend)\b/gi,
  ];
  for (const pattern of claimPatterns) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, match.index - 180), match.index);
      const clause = before.split(/[.!?;,]|\b(?:but|however|and|while|although|though|yet)\b/i).pop();
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 100);
      const afterClause = after.split(/[.!?;]/)[0];
      const negated = /\b(?:not|never|no|cannot|can't|won't|doesn't|didn't|isn't|aren't|without)\b/i.test(clause);
      const explicitlyNonClaiming = /^\s*(?:(?:claim|pitch|promise|language|wording|figure)\s+)?(?:(?:is|are|would be|remains?)\s+)?(?:coming soon|research only|not available|unsafe|unproven|not credible)\b/i.test(afterClause);
      if (!negated && !explicitlyNonClaiming) return match[0];
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
      + `|(?:routes?|runs?|operates?|serves?|handles?|process(?:es)?|powers?)\\s+[^.!?]{0,60}?(?:now|today|live|in\\s+production)`
      + `|(?:is|are)\\s+(?:(?:now|currently)\\s+)?(?:deployed|in\\s+production)`
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
  assert.ok(savingClaimMatch("This is a saving."), "the claim detector must catch an unquantified saving claim");
  assert.ok(savingClaimMatch("TOP delivers savings."), "the claim detector must catch an asserted saving outcome");
  assert.ok(savingClaimMatch("TOP does not require setup and delivers savings."),
    "an unrelated negative clause must not hide a later saving claim");
  assert.ok(savingClaimMatch("TOP delivers savings while competitors are unsafe."),
    "a warning about somebody else must not excuse a saving claim");
  assert.ok(savingClaimMatch("TOP lowers your AI costs."),
    "the claim detector must catch an unquantified cost-reduction claim");
  assert.ok(savingClaimMatch("TOP cuts your AI spend."),
    "the claim detector must catch an unquantified spend-reduction claim");
  assert.ok(savingClaimMatch("TOP is reducing your AI costs."),
    "the claim detector must catch a continuing cost-reduction claim");
  assert.ok(savingClaimMatch("TOP is lowering your AI spend."),
    "the claim detector must catch a continuing spend-reduction claim");
  assert.ok(savingClaimMatch("TOP is cutting your AI costs."),
    "the claim detector must catch a continuing cost-cutting claim");
  assert.ok(savingClaimMatch("TOP teams lower your AI costs."),
    "the claim detector must catch a plural-subject cost-reduction claim");
  assert.ok(savingClaimMatch("TOP products lower your AI costs."),
    "the claim detector must catch cost reduction regardless of the subject noun");
  assert.equal(savingClaimMatch("TOP has not proved that it saves money."), "",
    "a truthful negative boundary is not itself a saving claim");
  assert.equal(savingClaimMatch("This is not a saving."), "",
    "an explicit rejection must not be mistaken for a saving claim");
  assert.equal(savingClaimMatch("A lower cost is not a saving."), "",
    "a truthful distinction between cost and saving must remain permitted");
  assert.equal(savingClaimMatch("A guaranteed savings pitch is unsafe."), "",
    "a warning about unsafe claim language must remain permitted");
  assert.equal(savingClaimMatch("Previously saved text was reused."), "",
    "cache vocabulary must not be mistaken for a money-saving claim");
  assert.equal(stageIsPresentedAsShipped("TOP-2 is not currently available.", "TOP-2"), false);
  assert.equal(stageIsPresentedAsShipped("TOP-2 has never shipped.", "TOP-2"), false);
  assert.equal(stageIsPresentedAsShipped("TOP-2 works now.", "TOP-2"), true);
  assert.equal(stageIsPresentedAsShipped("TOP-3 has launched.", "TOP-3"), true);
  assert.equal(stageIsPresentedAsShipped("TOP-2 is research only. Later TOP-2 routes requests today.", "TOP-2"), true);
  assert.equal(stageIsPresentedAsShipped("TOP-3 is research only. TOP-3 runs in production.", "TOP-3"), true);

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
    /(?:forecast|prediction|mean absolute percentage|percentage|relative|median)?\s*error(?: rate)?[^\r\n<>]{0,100}\d+(?:\.\d+)?\s*(?:%|percent)/i,
    /\d+(?:\.\d+)?\s*(?:%|percent)[^\r\n<>]{0,100}(?:forecast|prediction|mean absolute percentage|percentage|relative|median)?\s*error(?: rate)?/i,
    /(?:typical|median|average|mean)\s+(?:forecast|prediction|estimate)[^\r\n<>]{0,100}\d+(?:\.\d+)?\s+times\b/i,
  );
  assert.ok(accuracyFigurePatterns.some((pattern) => pattern.test("Forecast error: 12%.")),
    "the accuracy detector must catch a forecast error percentage");
  assert.ok(accuracyFigurePatterns.some((pattern) => pattern.test("Mean absolute percentage error: 12%.")),
    "the accuracy detector must catch a named percentage-error measure");
  assert.ok(accuracyFigurePatterns.some((pattern) => pattern.test("The typical estimate was 3.3 times the actual cost.")),
    "the accuracy detector must catch a benchmark multiplier");
  const accuracyFigurePages = Object.entries(pages)
    .filter(([, source]) => accuracyFigurePatterns.some((pattern) => pattern.test(source)))
    .map(([name]) => name);
  if (accuracyFigurePages.length) {
    failures.push(`a public accuracy figure is still rendered or exported in: ${accuracyFigurePages.join(", ")}`);
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
