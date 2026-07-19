"use strict";

/*
 * Browser-level fail-first contract for the public analyzer entry state.
 *
 * The shared harness launches Chrome or Edge with a new temporary profile,
 * blocks every non-local page request, and closes only that owned process.
 * This proves computed browser visibility and runtime state. It does not claim
 * to replace a literal clean-machine install or provider-export walkthrough.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { runCase } = require("./test-seven-source-local-browser.cjs");

test("the canonical analyzer opens a visible seven-source stranger chooser in a clean browser profile",
  { concurrency: false, timeout: 45_000 }, async () => {
    const output = await runCase({ entryOnly: true, query: "" });
    const { entry } = output;
    const failures = [];

    assert.deepEqual(output.runtimeErrors, [], "the canonical entry must raise no browser runtime errors");
    assert.deepEqual(output.consoleErrors, [], "the canonical entry must log no browser errors");
    assert.ok(output.pageRequests.length >= 1, "the browser must record the local analyzer navigation");
    for (const requestUrl of output.pageRequests) {
      const protocol = new URL(requestUrl).protocol;
      assert.ok(protocol === "file:" || protocol === "data:",
        `the canonical entry attempted a non-local request: ${requestUrl}`);
    }

    const canonicalUrl = new URL(entry.location);
    if (canonicalUrl.search !== "") failures.push("plain /analyze/ must not require a hidden query parameter");
    if (entry.pilotMode !== true) failures.push("plain /analyze/ did not initialize guided mode");
    if (!entry.pilotClass) failures.push("plain /analyze/ did not apply the guided-mode page class");
    if (!entry.pilotFlowVisible) failures.push("the guided flow is not visibly rendered");
    if (!entry.sourceStepVisible) failures.push("the first source-choice step is not visibly rendered");
    if (entry.legacyGateVisible) failures.push("the legacy resonance gate still blocks the first visible screen");
    if (entry.visibleSourceChoices.length < 6) {
      failures.push(`only ${entry.visibleSourceChoices.length} of 6 provider choices are visibly reachable`);
    }

    const requiredSources = [
      "Claude Chat",
      "ChatGPT",
      "Claude Code",
      "Codex",
      "Cursor",
      "Cursor Composer",
      "GitHub Copilot",
    ];
    for (const source of requiredSources) {
      const named = entry.sourceChoices.some((choice) => choice.includes(source));
      const visiblyNamed = entry.visibleSourceChoices.some((choice) => choice.includes(source));
      if (!named) {
        failures.push(`${source} is not named in the first source chooser`);
      } else if (!visiblyNamed) {
        failures.push(`${source} is named but not visibly reachable in the first source chooser`);
      }
    }

    if (!entry.advancedVisible) failures.push("the advanced-analyzer escape is not visibly reachable");
    const advancedUrl = new URL(entry.advancedHref || "", entry.location);
    if (advancedUrl.searchParams.get("full") !== "1") {
      failures.push("the advanced-analyzer escape is not an explicit ?full=1 route");
    }

    assert.deepEqual(failures, [], failures.join("\n"));
  });
