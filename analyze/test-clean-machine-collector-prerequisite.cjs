"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const collector = fs.readFileSync(new URL("collector/top-collector.mjs", `file://${__dirname}/`), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `could not extract source between ${startMarker} and ${endMarker}`);
  return html.slice(start, end);
}

function textOnly(value) {
  return String(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function promptContext() {
  const declarations = [
    "PILOT_COLLECTOR_URL",
    "PILOT_COLLECTOR_SHA256",
    "PILOT_COLLECTOR_VERSION",
  ].map((name) => {
    const match = new RegExp(`var ${name}="[^"]+";`).exec(html);
    assert.ok(match, `could not find ${name}`);
    return match[0];
  }).join("\n");
  const platformSource = sourceBetween("function detectedDesktopPlatform", "var MODES={");
  const functionSource = sourceBetween("function pilotPromptFor(source){", "function pilotChooseSource(source){");
  const context = { navigator: { platform: "Win32" } };
  vm.runInNewContext(`${declarations}\n${platformSource}\n${functionSource}`, context);
  assert.equal(typeof context.pilotPromptFor, "function");
  return context;
}

function runtimeName() {
  const match = /^#!\/usr\/bin\/env\s+([^\s]+)/.exec(collector.replace(/^\uFEFF/, ""));
  assert.ok(match, "collector must declare its executable runtime in the shebang");
  return match[1];
}

function runtimePattern(runtime) {
  return runtime.toLowerCase() === "node" ? "Node(?:\\.js)?" : runtime.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function statesPositivePrerequisite(text, shownRuntime) {
  const runtime = new RegExp(`\\b${shownRuntime}\\b`, "i");
  const prerequisite = /\b(?:required|requires?|need(?:s|ed)?|installed|available|prerequisite|runtime)\b/i;
  const negation = /\b(?:not|never|no|without|isn't|isnt|doesn't|doesnt|don't|dont)\b/i;
  return String(text).split(/[.!?;\r\n]+/).some((clause) =>
    runtime.test(clause) && prerequisite.test(clause) && !negation.test(clause));
}

function controlIsEnabled(markup) {
  const openingTag = String(markup).match(/^<button\b[^>]*>/i)?.[0] || "";
  return openingTag
    && !/\s(?:hidden|disabled)(?:\s|=|>)/i.test(openingTag)
    && !/\saria-hidden\s*=\s*["']?true\b/i.test(openingTag)
    && !/\sstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(openingTag);
}

function hasSafeMissingRuntimeRecovery(prompt, shownRuntime) {
  const absent = /\b(?:missing|unavailable|not\s+installed|cannot\s+be\s+found|not\s+recognized|fails?|does\s+not\s+run)\b/i;
  const runtime = new RegExp(`\\b${shownRuntime}\\b`, "i");
  const recoveryActions = [
    /\b(?:tell|inform|notify)\s+(?:me|the\s+user|user)\b[^.\r\n]{0,100}\b(?:missing|unavailable|not\s+installed|cannot\s+be\s+found|not\s+recognized|does\s+not\s+run|folder|fallback)\b/gi,
    /\b(?:use|choose|offer|switch(?:\s+to)?|fall\s+back\s+to)\b[^.\r\n]{0,80}\b(?:folder|fallback)\b/gi,
  ];
  const segments = String(prompt).split(/\r?\n|(?<=[.!?])\s+/);
  for (let index = 0; index < segments.length; index += 1) {
    const condition = segments[index];
    if (!runtime.test(condition) || !absent.test(condition)) continue;
    const window = `${condition} ${segments[index + 1] || ""}`;
    for (const action of recoveryActions) {
      for (const candidate of window.matchAll(action)) {
        const prefix = window.slice(Math.max(0, candidate.index - 24), candidate.index);
        if (!/\b(?:do\s+not|don't|never|not|no)\s*$/i.test(prefix)) return true;
      }
    }
  }
  return false;
}

test("the recommended collector route discloses and safely handles its clean-machine runtime prerequisite", () => {
  const runtime = runtimeName();
  const shownRuntime = runtimePattern(runtime);
  const failures = [];
  const agentPanel = textOnly(sourceBetween('id="pilotAgentPanel"', 'id="pilotFolderPanel"'));
  const folderControl = /<button\b[^>]*\bdata-pilot-method="folder"[^>]*>([\s\S]*?)<\/button>/i.exec(html);

  assert.equal(statesPositivePrerequisite(`${runtime} is not required.`, shownRuntime), false,
    "negated runtime copy must not satisfy the prerequisite contract");
  assert.equal(hasSafeMissingRuntimeRecovery(`If ${runtime} is missing, do not stop.`, shownRuntime), false,
    "negated recovery wording must not satisfy the safe fallback contract");
  assert.equal(hasSafeMissingRuntimeRecovery(`If ${runtime} is missing, tell a joke.`, shownRuntime), false,
    "an unrelated action must not satisfy the safe fallback contract");
  assert.equal(hasSafeMissingRuntimeRecovery(`If ${runtime} is missing, tell the user a joke.`, shownRuntime), false,
    "an irrelevant user-directed action must not satisfy the safe fallback contract");
  assert.equal(hasSafeMissingRuntimeRecovery(`If ${runtime} is missing, stop and tell the user to use the folder fallback.`, shownRuntime), true,
    "an explicit stop-and-fallback instruction must satisfy the recovery contract");

  if (!statesPositivePrerequisite(agentPanel, shownRuntime)) {
    failures.push(`the visible recommended route does not disclose ${runtime} as a prerequisite`);
  }
  if (!folderControl || !/folder/i.test(textOnly(folderControl[1])) || !controlIsEnabled(folderControl[0])) {
    failures.push("the clean-machine flow has no deliberate folder fallback control");
  }

  const context = promptContext();
  for (const source of ["cc", "codex"]) {
    const label = source === "cc" ? "Claude Code" : "Codex";
    const prompt = context.pilotPromptFor(source);
    const lines = prompt.split(/\r?\n/);
    const runIndex = lines.findIndex((line) => new RegExp(`\\b${runtime}\\s+top-collector\\.mjs\\b`, "i").test(line));
    assert.ok(runIndex >= 0, `${label} prompt must contain the collector run command`);
    const beforeRun = lines.slice(0, runIndex).join("\n");
    const runLine = lines[runIndex];
    const preflight = new RegExp(`\\b${runtime}\\s+(?:--version|-v)\\b`, "i");
    if (!preflight.test(beforeRun)) {
      failures.push(`${label} prompt does not check ${runtime} availability before the collector command`);
    }

    if (!hasSafeMissingRuntimeRecovery(prompt, shownRuntime)) {
      failures.push(`${label} prompt does not give safe missing-${runtime} recovery`);
    }

    if (/<[^>\r\n]+>/.test(runLine)) {
      const placeholderGuidance = /\b(?:replace|resolve|expand|substitute)\b[^\n]{0,120}\b(?:placeholder|output path|Downloads folder)\b[^\n]{0,120}\b(?:quote|quoted|spaces)\b/i;
      if (!placeholderGuidance.test(prompt)) {
        failures.push(`${label} prompt leaves unresolved shell metasyntax in the collector command`);
      }
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
});
