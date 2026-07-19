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

test("every visible guided source control advances to its usable local acquisition path",
  { concurrency: false, timeout: 90_000 }, async () => {
    const cases = [
      { source: "chat", mode: "chat", label: /Claude Chat/i, kind: "link" },
      { source: "openai", mode: "openai", label: /ChatGPT/i, kind: "link" },
      { source: "cc", mode: "cc", label: /Claude Code/i, kind: "method" },
      { source: "codex", mode: "codex", label: /Codex/i, kind: "method" },
      { source: "cursor", mode: "cursor", label: /Cursor[\s\S]*Composer/i, kind: "cursor" },
      { source: "copilot", mode: "copilot", label: /GitHub Copilot/i, kind: "copilot" },
    ];
    const failures = [];

    for (const sourceCase of cases) {
      const output = await runCase({ guidedSource: sourceCase.source, query: "?pilot=1" });
      const { before, after } = output.guided;
      if (!before.found) {
        failures.push(`${sourceCase.source}: guided source control is missing`);
        continue;
      }
      if (!before.visible) failures.push(`${sourceCase.source}: guided source control is hidden`);
      if (!sourceCase.label.test(before.text)) {
        failures.push(`${sourceCase.source}: guided source control does not name the supported source`);
      }
      if (!after) {
        failures.push(`${sourceCase.source}: guided source control produced no destination state`);
        continue;
      }
      if (after.mode !== sourceCase.mode) {
        failures.push(`${sourceCase.source}: selected mode was ${after.mode || "empty"}`);
      }

      if (sourceCase.kind === "link") {
        if (after.selectedRoute !== "a" || !after.routeVisible || !after.providerVisible
            || !after.fileChooserVisible) {
          failures.push(`${sourceCase.source}: browser-chat link did not reach the usable local file route`);
        }
      } else {
        if (after.pilotSource !== sourceCase.mode || after.sourceStepVisible || !after.methodStepVisible) {
          failures.push(`${sourceCase.source}: guided button did not advance the source step`);
        }
        if (sourceCase.kind === "method" && !after.methodChoicesVisible) {
          failures.push(`${sourceCase.source}: preparation choices are not visible after selection`);
        }
        if (sourceCase.kind === "method"
            && (!after.folderMethodVisible || !after.folderMethodEnabled
              || !after.folderPanelVisible || !after.folderChooserVisible || !after.folderChooserEnabled)) {
          failures.push(`${sourceCase.source}: the folder fallback is not visibly usable from the guided flow`);
        }
        if (sourceCase.kind === "cursor" && !after.cursorPanelVisible) {
          failures.push("cursor: the CSV acquisition panel is not visible after selection");
        }
        if (sourceCase.kind === "copilot" && !after.copilotPanelVisible) {
          failures.push("copilot: the usage-report acquisition panel is not visible after selection");
        }
      }

      if (output.runtimeErrors.length) failures.push(`${sourceCase.source}: browser runtime error`);
      if (output.consoleErrors.length) failures.push(`${sourceCase.source}: browser console error`);
      for (const requestUrl of output.pageRequests) {
        const protocol = new URL(requestUrl).protocol;
        if (protocol !== "file:" && protocol !== "data:") {
          failures.push(`${sourceCase.source}: non-local request ${requestUrl}`);
        }
      }
    }

    assert.deepEqual(failures, [], failures.join("\n"));
  });
