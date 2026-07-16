const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

assert.match(html, /data-mode="obsidian"/);
assert.match(html, /id="vaultFolder" webkitdirectory directory multiple/);
assert.match(html, /id="vaultFiles"[^>]*multiple/);
assert.match(html, /id="vaultChooseClaudeCodeFolder">Choose My Claude Code Folder/);
assert.match(html, /id="vaultChooseConversations">Choose conversations\.json/);
assert.match(html, /id="vaultChooseCodexFolder">Choose My Codex Sessions Folder/);
assert.match(html, /%USERPROFILE%\\\.claude\\projects/);
assert.match(html, /id="vaultCopyClaudePath">Copy Path/);
assert.match(html, /Opening Claude Code inside an Obsidian vault does not put its usage logs inside that vault/);
assert.match(html, /reads the JSONL session files locally and keeps only their usage fields/);
assert.match(html, /Use An AI History Export Instead/);
assert.match(html, /Download My 7C's Setup Plan/);
assert.match(html, /id="vaultAnalyzeClaudeFolder" hidden>Analyze This Claude Code Folder/);
assert.match(html, /id="vaultUseClaudeFolderPicker" hidden>Choose Claude Code Folder Safely/);
assert.match(html, /id="vaultChooseAgain">Choose My Actual Vault Folder/);
assert.match(html, /You chose your Claude Code history folder/);
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
  file("PrivateVault/.claude/projects/C--Users-Adam-7Cs-Vault/session-2.jsonl"),
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
assert.equal(scan.selected, files.length);
assert.equal(scan.notes, 3);
assert.equal(scan.recent, 3);
assert.equal(scan.candidates.cc.length, 2);
assert.equal(scan.candidates.codex.length, 2);
assert.equal(scan.candidates.conversation.length, 1);
assert.equal(scan.candidates.csv.length, 1);
assert.equal(context.vaultCandidateCount(scan), 6);
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
assert.equal(context.vaultCandidateKind(file("rollout-2026-07-16.jsonl"), false), "codex", "an individually selected Codex rollout must match the fallback copy");
assert.equal(context.vaultCandidateKind(file("PrivateVault/rollout-2026-07-16.jsonl"), true), "other-data", "a strict vault scan must not guess that an arbitrary rollout file belongs to Codex");
assert.equal(context.vaultCandidateKind(file("PrivateVault/Claude/events.jsonl"), true), "other-data", "a generic Claude folder must not be treated as Claude Code history");
assert.equal(context.vaultCandidateKind(file("PrivateVault/Claude Code/events.jsonl"), true), "cc");
assert.equal(context.vaultCandidateKind(file("PrivateVault/claude-usage-only.jsonl"), true), "cc");
assert.equal(context.vaultCandidateKind(file("PrivateVault/.obsidian/plugin.json"), true), "skip");
assert.equal(context.vaultCandidateKind(file("PrivateVault/Attachments/conversations.json"), true), "skip");
assert.equal(context.vaultCandidateKind(file("PrivateVault/session.jsonl", { size: 400 * 1024 * 1024 }), true), "oversized");

const plan = context.build7CsPlan(scan);
assert.match(plan, /Markdown notes: 3/);
assert.match(plan, /Files with recognized AI history names: 6/);
assert.match(plan, /Claude project, memory or user files recognized but not read: 3/);
assert.match(plan, /AGENTS\.md: found/);
assert.match(plan, /does not connect to, change, upload or index your vault/);
for (const privateText of ["PrivateVault", "Alpha.md", "session.jsonl", "session-2.jsonl", "rollout-2026-07-16.jsonl", "ai-events.jsonl", "conversations.json", "usage.csv", "api-key.txt", "projects.json", "memories.json", "users.json", "random.json"]) {
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
context.mode = "cursor";
assert.equal(context.inferModeFromFileNames([file("usage.CSV")]), "cursor",
  "a CSV selected through the Cursor route must stay on the strict Cursor parser");
context.mode = "";

const oneCursorCsv = context.historyFilesForMode([file("cursor-usage.csv")], "cursor");
assert.equal(oneCursorCsv.files.length, 1);
assert.equal(oneCursorCsv.multipleCursorFiles, false);
const twoCursorCsvs = context.historyFilesForMode([file("cursor-usage.csv"), file("cursor-usage-old.csv")], "cursor");
assert.equal(twoCursorCsvs.files.length, 0);
assert.equal(twoCursorCsvs.multipleCursorFiles, true,
  "overlapping Cursor exports must fail rather than double-count");
const mixedCursorSelection = context.historyFilesForMode([file("cursor-usage.csv"), file("notes.md")], "cursor");
assert.equal(mixedCursorSelection.files.length, 0);
assert.equal(mixedCursorSelection.multipleCursorFiles, true,
  "Cursor must not silently skip extra selected files");

const oversizedConversation = context.historyFilesForMode([file("conversations.json", { size: 65 * 1024 * 1024 })], "chat");
assert.equal(oversizedConversation.files.length, 0, "large conversation JSON must fail before a phone tab tries to retain and parse it");

const giantMergedClaude = context.historyFilesForMode([file("TOP-claude-export.jsonl", { size: 546 * 1024 * 1024 })], "cc");
assert.equal(giantMergedClaude.files.length, 0, "a giant raw merged history must not be retained as one browser string");
assert.equal(giantMergedClaude.oversized, 1, "the UI must be able to redirect a giant merged history to the safer folder route");

const validClaudeProjectsRoot = context.historyFilesForMode([
  file("projects/C--Users-Adam-Project/session.jsonl"),
], "cc", "folder");
assert.equal(validClaudeProjectsRoot.files.length, 1,
  "the promoted folder route must accept the exact .claude/projects folder");

const wholeClaudeRoot = context.historyFilesForMode([
  file(".claude/projects/C--Users-Adam-Project/session.jsonl"),
  file(".claude/history.jsonl"),
], "cc", "folder");
assert.equal(wholeClaudeRoot.unsafeClaudeRoot, true);
assert.equal(wholeClaudeRoot.files.length, 0,
  "the whole .claude folder must fail closed before prompt history is opened");

const oneProjectSubfolder = context.historyFilesForMode([
  file("C--Users-Adam-Project/session.jsonl"),
], "cc", "folder");
assert.equal(oneProjectSubfolder.invalidClaudeFolder, true);
assert.equal(oneProjectSubfolder.files.length, 0,
  "the folder-first route must require the complete projects root instead of silently undercounting one project");

const directClaudeHistory = context.historyFilesForMode([file("history.jsonl")], "cc", "files");
assert.equal(directClaudeHistory.unsafeClaudeHistory, true);
assert.equal(directClaudeHistory.files.length, 0,
  "Claude prompt history must never be accepted as token usage through the file fallback");

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

const ordinaryVault = context.scanVaultFiles([
  file("OrdinaryVault/VAULT-INDEX.md"),
  file("OrdinaryVault/Resources/Chat History/claude/session.md"),
  file("OrdinaryVault/projects.json"),
  file("OrdinaryVault/random.json"),
], true, now);
assert.equal(context.vaultCandidateCount(ordinaryVault), 0, "Markdown history and ordinary JSON are not usage records");
assert.equal(ordinaryVault.notes, 2);
assert.equal(ordinaryVault.claudeContext, 1);
assert.equal(ordinaryVault.regularJson, 1);

const canonical7Cs = context.scanVaultFiles([
  file("7Cs-Vault/AGENTS.md"),
  file("7Cs-Vault/CLAUDE.md"),
  file("7Cs-Vault/VAULT-INDEX.md"),
  file("7Cs-Vault/Active Priorities.md"),
  file("7Cs-Vault/Birds-Eye-View.md"),
  file("7Cs-Vault/01 - Daily Notes/2026-07-16.md"),
], true, now);
assert.deepEqual(
  { ...canonical7Cs.structures },
  { agents: true, claude: true, index: true, priorities: true, birds: true, daily: true },
  "Adam's exact canonical starter names must all be recognized without reading note contents",
);
assert.equal(canonical7Cs.rootName, "7Cs-Vault");
assert.equal(canonical7Cs.looksLikeClaudeProjects, false);

const mistakenClaudeFolder = context.scanVaultFiles(
  Array.from({ length: 12 }, (_, index) => file(`projects/C--Users-Adam-Project/session-${index}.jsonl`)),
  true,
  now,
);
assert.equal(mistakenClaudeFolder.rootName, "projects");
assert.equal(mistakenClaudeFolder.looksLikeClaudeProjects, true,
  "selecting .claude/projects as the vault must produce a corrective Claude Code route");
assert.equal(mistakenClaudeFolder.candidates.cc.length, 12);
assert.equal(mistakenClaudeFolder.notes, 0);

const unsafeClaudeRoot = context.scanVaultFiles(
  Array.from({ length: 12 }, (_, index) => file(`.claude/projects/C--Users-Adam-Project/session-${index}.jsonl`)),
  true,
  now,
);
assert.equal(unsafeClaudeRoot.looksLikeUnsafeClaudeRoot, true,
  "selecting all of .claude must be recognized and redirected to a safer subfolder");
assert.equal(unsafeClaudeRoot.looksLikeClaudeProjects, false);

const arbitraryProjectsFolder = context.scanVaultFiles([
  file("projects/not-claude.jsonl"),
], true, now);
assert.equal(arbitraryProjectsFolder.looksLikeClaudeProjects, false,
  "an arbitrary folder named projects must not be mistaken for Claude Code history");
assert.equal(arbitraryProjectsFolder.candidates.cc.length, 0);

const blockedProjectsFolder = context.scanVaultFiles(
  Array.from({ length: 12 }, (_, index) => file(`projects/C--Users-Adam-Project/secret-${index}.jsonl`)),
  true,
  now,
);
assert.equal(blockedProjectsFolder.looksLikeClaudeProjects, false,
  "blocked private-looking JSONL names must not create Claude Code confidence");
assert.equal(blockedProjectsFolder.candidates.cc.length, 0);

const cappedClaudeFolder = context.scanVaultFiles(
  Array.from({ length: 12 }, (_, index) => file(`projects/C--Users-Adam-Project/session-${index}.jsonl`, { size: 200 * 1024 * 1024 })),
  true,
  now,
);
assert.equal(cappedClaudeFolder.looksLikeClaudeProjects, true);
assert.equal(cappedClaudeFolder.candidatesIncomplete, true,
  "the recovery shortcut must fail closed if its candidate byte cap would truncate the report");
assert.ok(cappedClaudeFolder.candidates.cc.length < 12);
assert.match(html, /if\(scan\.candidatesIncomplete\)[\s\S]*safeClaudePicker\.hidden=false/,
  "an incomplete recovery scan must redirect to the dedicated folder picker");

const individualRollout = context.scanVaultFiles([file("rollout-2026-07-16.jsonl")], false, now);
assert.equal(individualRollout.candidates.codex.length, 1, "the individual-file fallback must retain a valid Codex rollout");

const claudeFolderScale = Array.from({ length: 2393 }, (_, index) =>
  file(`ClaudeRoot/.claude/projects/C--Users-Adam-Project/session-${index}.jsonl`, { size: 226000 })
);
const largeClaudeFolder = context.scanVaultFiles(claudeFolderScale, true, now);
assert.equal(largeClaudeFolder.tooMany, false);
assert.equal(largeClaudeFolder.candidates.cc.length, claudeFolderScale.length, "a realistic Claude Code folder must remain within the metadata-scan limits");

const takeStart = html.indexOf("function takeChosenFiles");
const takeEnd = html.indexOf("vaultFolder.addEventListener", takeStart);
assert.ok(takeStart >= 0 && takeEnd > takeStart, "could not locate retry-safe input helper");
vm.runInContext(html.slice(takeStart, takeEnd), context);
let clearedValue = "unchanged";
const retryInput = { files: [file("conversations.json")], set value(value) { clearedValue = value; } };
const retainedFiles = context.takeChosenFiles(retryInput);
assert.equal(retainedFiles.length, 1);
assert.equal(retainedFiles[0].name, "conversations.json");
assert.equal(clearedValue, "", "the native input must be cleared so choosing the same file or folder can fire change again");

console.log("TOP Analyzer Obsidian vault regression tests passed");
