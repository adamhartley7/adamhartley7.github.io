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
  file("PrivateVault/conversations.json"),
  file("PrivateVault/usage.csv"),
  file("PrivateVault/Personal/api-key.txt"),
];

const scan = context.scanVaultFiles(files, true, now);
assert.equal(scan.notes, 3);
assert.equal(scan.recent, 3);
assert.equal(scan.candidates.cc.length, 1);
assert.equal(scan.candidates.conversation.length, 1);
assert.equal(scan.candidates.csv.length, 1);
assert.equal(context.vaultCandidateCount(scan), 3);
assert.equal(scan.structures.agents, true);
assert.equal(scan.structures.daily, true);
assert.ok(scan.skipped >= 4, "hidden folders, attachments and sensitive files must be skipped");

assert.equal(context.vaultCandidateKind(file("PrivateVault/random.json"), true), "skip");
assert.equal(context.vaultCandidateKind(file("random.json"), false), "conversation");
assert.equal(context.vaultCandidateKind(file("PrivateVault/.obsidian/plugin.json"), true), "skip");
assert.equal(context.vaultCandidateKind(file("PrivateVault/Attachments/conversations.json"), true), "skip");
assert.equal(context.vaultCandidateKind(file("PrivateVault/session.jsonl", { size: 400 * 1024 * 1024 }), true), "oversized");

const plan = context.build7CsPlan(scan);
assert.match(plan, /Markdown notes: 3/);
assert.match(plan, /Possible AI history files: 3/);
assert.match(plan, /AGENTS\.md: found/);
assert.match(plan, /does not connect to, change, upload or index your vault/);
for (const privateText of ["PrivateVault", "Alpha.md", "session.jsonl", "conversations.json", "usage.csv", "api-key.txt"]) {
  assert.doesNotMatch(plan, new RegExp(privateText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `the 7C's plan must not disclose ${privateText}`);
}

const historyStart = html.indexOf("var HISTORY_LIMITS");
const historyEnd = html.indexOf("function finishParsedResult", historyStart);
assert.ok(historyStart >= 0 && historyEnd > historyStart, "could not locate history-file preflight");
vm.runInContext(html.slice(historyStart, historyEnd), context);

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

assert.doesNotMatch(html.slice(vaultStart, vaultEnd), /FileReader/,
  "the initial vault scan must not read file contents");

console.log("TOP Analyzer Obsidian vault regression tests passed");
