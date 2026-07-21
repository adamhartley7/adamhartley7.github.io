"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const start = html.indexOf("function detectedDesktopPlatform");
const end = html.indexOf("var MODES={", start);
assert.ok(start >= 0 && end > start, "platform folder helpers must be present");

const elements = {
  vaultClaudePath: { textContent: "" },
  vaultClaudePathInstructions: { textContent: "" },
};
const context = {
  navigator: { platform: "MacIntel" },
  document: {
    getElementById(id) {
      return elements[id] || null;
    },
  },
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context, { filename: "analyze/index.html" });

const macClaude = context.historyLocationFor("cc", { platform: "MacIntel" });
assert.equal(macClaude.platform, "mac");
assert.equal(macClaude.path, "~/.claude/projects");
assert.match(macClaude.pickerAction, /Command\+Shift\+G/);
assert.match(macClaude.pickerAction, /label the confirmation Upload/);
assert.match(macClaude.pickerAction, /does not send them to TOP/);
assert.match(macClaude.invalidFolder, /not your source-code project folder/);
assert.doesNotMatch(macClaude.instructions, /%USERPROFILE%|Windows picker/);

const macCodex = context.historyLocationFor("codex", { userAgentData: { platform: "macOS" } });
assert.equal(macCodex.path, "~/.codex/sessions");
assert.equal(macCodex.archivedPath, "~/.codex/archived_sessions");
assert.match(macCodex.instructions, /browser option opens one folder at a time/i);

const windowsClaude = context.historyLocationFor("cc", { platform: "Win32" });
assert.equal(windowsClaude.platform, "windows");
assert.equal(windowsClaude.path, "%USERPROFILE%\\.claude\\projects");
assert.match(windowsClaude.pickerAction, /address bar/);
assert.doesNotMatch(windowsClaude.pickerAction, /Command\+Shift\+G/);

const linuxClaude = context.historyLocationFor("cc", { platform: "Linux x86_64" });
assert.equal(linuxClaude.platform, "unix");
assert.equal(linuxClaude.path, "~/.claude/projects");
assert.match(linuxClaude.pickerAction, /Ctrl\+L/);

context.applyPlatformFolderGuidance();
assert.equal(elements.vaultClaudePath.textContent, "~/.claude/projects");
assert.match(elements.vaultClaudePathInstructions.textContent, /Command\+Shift\+G/);

assert.match(html, /id="historyPathInstructions"/);
assert.match(html, /id="vaultClaudePath"/);
assert.match(html, /var guide=historyLocationFor\(m\)/);
assert.match(html, /var guide=historyLocationFor\(source\);document\.getElementById\("pilotFolderPath"\)/);
assert.match(html, /else if\(checked\.invalidClaudeFolder\) showErr\(claudeGuide\.invalidFolder\)/);
assert.match(html, /applyPlatformFolderGuidance\(\);\s*renderSteps\("cc"\)/);

console.log("TOP Analyzer platform folder guidance tests passed");
