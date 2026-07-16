const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

assert.match(html, /data-mode="obsidian"/);
assert.match(html, /id="vaultFolder" webkitdirectory directory multiple/);
assert.match(html, /id="vaultFiles"[^>]*multiple/);
assert.match(html, /Use An AI History Export Instead/);
assert.match(html, /Download My 7C's Setup Plan/);
assert.match(html, /A one-click public integration is not live yet/);
assert.match(html, /No Markdown note contents were read/);
assert.match(html, /id="vaultHistoryHeading">No supported AI history files found/);
assert.doesNotMatch(html, /AI history found in the vault/);

const vaultStart = html.indexOf("var VAULT_SCAN");
const vaultEnd = html.indexOf("function showVaultError", vaultStart);
assert.ok(vaultStart >= 0 && vaultEnd > vaultStart, "could not locate pure Obsidian vault scanner");

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(vaultStart, vaultEnd), context);

const now = Date.UTC(2026, 6, 15);
function file(path, { size = 1200, lastModified = now } = {}) {
  return {
    name: path.split("/").pop(),
    webkitRelativePath: path,
    size,
    lastModified,
  };
}

const files = [
  file("PrivateVault/AGENTS.md"),
  file("PrivateVault/Notes/Alpha.md"),
  file("PrivateVault/01 - Daily Notes/2026-07-15.md"),
  file("PrivateVault/.obsidian/app.json"),
  file("PrivateVault/.git/config"),
  file("PrivateVault/Attachments/photo.png"),
  file("PrivateVault/Resources/Claude History/session.jsonl"),
  file("PrivateVault/AI History/Sessions/codex/rollout-2026-07-16.jsonl"),
  file("PrivateVault/AI History/Usage Log/ai-events.jsonl"),
  file("PrivateVault/conversations.json"),
  file("PrivateVault/usage.csv"),
  file("PrivateVault/projects.json"),
  file("PrivateVault/memories.json"),
  file("PrivateVault/users.json"),
  file("PrivateVault/random.json"),
  file("PrivateVault/export.zip"),
  file("PrivateVault/events.jsonl"),
  file("PrivateVault/history.jsonl"),
  file("PrivateVault/Personal/api-key.txt"),
];

const scan = context.scanVaultFiles(files, true, now);
assert.equal(scan.notes, 3);
assert.equal(scan.recent, 3);
assert.equal(scan.candidates.cc.length, 1);
assert.equal(scan.candidates.codex.length, 2);
assert.equal(scan.candidates.conversation.length, 1);
assert.equal(scan.candidates.csv.length, 1);
assert.equal(context.vaultCandidateCount(scan), 5);
assert.equal(scan.claudeContext, 3);
assert.equal(scan.regularJson, 1);
assert.equal(scan.archives, 1);
assert.equal(scan.otherData, 2);
assert.equal(scan.structures.agents, true);
assert.equal(scan.structures.daily, true);
assert.ok(scan.skipped >= 4, "hidden folders, attachments and sensitive files must be skipped");

assert.equal(context.vaultCandidateKind(file("PrivateVault/random.json"), true), "regular-json");
assert.equal(context.vaultCandidateKind(file("random.json"), false), "regular-json");
assert.equal(context.vaultCandidateKind(file("conversations.JSON"), false), "conversation");
assert.equal(context.vaultCandidateKind(file("projects.JSON"), false), "claude-context");
assert.equal(context.vaultCandidateKind(file("memories.JSON"), false), "claude-context");
assert.equal(context.vaultCandidateKind(file("users.JSON"), false), "claude-context");
assert.equal(context.vaultCandidateKind(file("PrivateVault/events.jsonl"), true), "other-data");
assert.equal(context.vaultCandidateKind(file("PrivateVault/history.jsonl"), true), "other-data");
assert.equal(context.vaultCandidateKind(file("PrivateVault/Claude/events.jsonl"), true), "other-data", "a generic Claude folder must not be treated as Claude Code history");
assert.equal(context.vaultCandidateKind(file("PrivateVault/Claude Code/events.jsonl"), true), "cc");
assert.equal(context.vaultCandidateKind(file("PrivateVault/claude-usage-only.jsonl"), true), "cc");
assert.equal(context.vaultCandidateKind(file("PrivateVault/.obsidian/plugin.json"), true), "skip");
assert.equal(context.vaultCandidateKind(file("PrivateVault/Attachments/conversations.json"), true), "skip");
assert.equal(context.vaultCandidateKind(file("PrivateVault/session.jsonl", { size: 400 * 1024 * 1024 }), true), "oversized");

const plan = context.build7CsPlan(scan);
assert.match(plan, /Markdown notes: 3/);
assert.match(plan, /Files with recognized AI history names: 5/);
assert.match(plan, /Claude project, memory or user files recognized but not read: 3/);
assert.match(plan, /AGENTS\.md: found/);
assert.match(plan, /does not connect to, change, upload or index your vault/);
for (const privateText of ["PrivateVault", "Alpha.md", "session.jsonl", "rollout-2026-07-16.jsonl", "ai-events.jsonl", "conversations.json", "usage.csv", "api-key.txt", "projects.json", "memories.json", "users.json", "random.json"]) {
  assert.doesNotMatch(plan, new RegExp(privateText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `the 7C's plan must not disclose ${privateText}`);
}

const historyStart = html.indexOf("var HISTORY_LIMITS");
const historyEnd = html.indexOf("function finishParsedResult", historyStart);
assert.ok(historyStart >= 0 && historyEnd > historyStart, "could not locate history-file preflight");
vm.runInContext(html.slice(historyStart, historyEnd), context);
assert.equal(context.conversationLimitBytes(), 64 * 1024 * 1024, "non-browser tests use the bounded desktop conversation limit");

const markdownOnly = context.historyFilesForMode([file("PrivateVault/Note.md")], "cc");
assert.equal(markdownOnly.files.length, 0);
assert.equal(markdownOnly.markdown, 1);

const zipOnly = context.historyFilesForMode([file("export.zip")], "openai");
assert.equal(zipOnly.files.length, 0);
assert.equal(zipOnly.archives, 1);

const mixed = context.historyFilesForMode([
  file("session.jsonl"),
  file("Note.md"),
  file("photo.png"),
], "cc");
assert.equal(mixed.files.length, 1);
assert.equal(mixed.markdown, 1);
assert.equal(mixed.unsupported, 1);

const conversationFiles = context.historyFilesForMode([
  file("conversations.JSON"),
  file("conversations_2.json"),
], "chat");
assert.equal(conversationFiles.files.length, 2, "case-insensitive and numbered conversation exports should be accepted");
assert.match(html, /Check "\+fmtN\(scan\.candidates\.conversation\.length\)\+" conversation export files together/, "split conversation exports must be opened as one report");

const projectJson = context.historyFilesForMode([file("Projects/PROJECTS.JSON")], "cc");
assert.equal(projectJson.files.length, 0);
assert.equal(projectJson.projectJson, 1);
assert.equal(projectJson.regularJson, 1);
assert.equal(projectJson.contextJson, 1);

assert.equal(context.inferModeFromFileNames([file("session.JSONL")]), "", "generic JSONL must not be guessed to be Claude Code from its extension alone");
assert.equal(context.inferModeFromFileNames([file("rollout-2026-07-16.JSONL")]), "codex");
assert.equal(context.inferModeFromFileNames([file("conversations.JSON")]), "conversation");
assert.equal(context.inferModeFromFileNames([file("usage.CSV")]), "csv");

const oversizedConversation = context.historyFilesForMode([file("conversations.json", { size: 65 * 1024 * 1024 })], "chat");
assert.equal(oversizedConversation.files.length, 0, "large conversation JSON must fail before a phone tab tries to retain and parse it");

const codexFiles = context.historyFilesForMode([
  file("rollout-2026-07-16.jsonl"),
  file("history.jsonl"),
  file("arbitrary.jsonl"),
  file("auth.json"),
], "codex");
assert.equal(codexFiles.files.length, 1);
assert.equal(codexFiles.files[0].name, "rollout-2026-07-16.jsonl");
assert.equal(codexFiles.unsupported, 3);

const codexAggregate = context.historyFilesForMode([file("ai-events.jsonl")], "codex");
assert.equal(codexAggregate.files.length, 1);
assert.equal(codexAggregate.files[0].name, "ai-events.jsonl");

const mixedCodexSources = context.historyFilesForMode([
  file("rollout-2026-07-16.jsonl"),
  file("ai-events.jsonl"),
], "codex");
assert.equal(mixedCodexSources.mixedCodexSources, true);
assert.equal(mixedCodexSources.files.length, 0, "raw and aggregate Codex usage must not be mixed or double-counted");

const multipleCodexAggregates = context.historyFilesForMode([
  file("first/ai-events.jsonl"),
  file("second/ai-events.jsonl"),
], "codex");
assert.equal(multipleCodexAggregates.multipleCodexAggregates, true);
assert.equal(multipleCodexAggregates.files.length, 0, "overlapping aggregate snapshots cannot be detected without private IDs");

const unsafeCodexRoot = context.historyFilesForMode([
  file(".codex/sessions/2026/07/16/rollout-2026-07-16.jsonl"),
  file(".codex/auth.json"),
], "codex");
assert.equal(unsafeCodexRoot.unsafeCodexRoot, true);
assert.equal(unsafeCodexRoot.files.length, 0);

assert.doesNotMatch(html.slice(vaultStart, vaultEnd), /FileReader/,
  "the initial vault scan must not read file contents");

console.log("TOP Analyzer Obsidian vault regression tests passed");
