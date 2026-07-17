const assert = require("node:assert/strict");
const fs = require("node:fs");
const Pilot = require("./pilot-core.js");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const app = fs.readFileSync(new URL("pilot-app.js", `file://${__dirname}/`), "utf8");

assert.doesNotMatch(html, /<textarea\b|contenteditable|type="(?:text|email|tel|search|url)"/i,
  "the pilot must not collect free text or contact details");
assert.doesNotMatch(app, /\.name\b|webkitRelativePath|\.path\b/,
  "selected filenames and paths must not enter application state or UI");
assert.doesNotMatch(app, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
  "imported values must be rendered with textContent, not HTML parsing");
assert.match(html, /No task text, names, prompts, replies, file contents, paths, credentials, account identifiers, or notes/);
assert.match(app, /No free-text explanation is collected/);

let participant = Pilot.startDraft(Pilot.createParticipant(1));
participant = Pilot.updateDraft(participant, 1, {
  task_class: Pilot.TASK_CLASSES[0],
  forecast_version: Pilot.FORECAST_VERSIONS[0],
  p10_usd: 1,
  p50_usd: 2,
  p90_usd: 3,
});
participant = Pilot.freezeDraft(participant, 1);
participant = Pilot.invalidateAttempt(participant, 1, "task_abandoned");
const exported = Pilot.toExport(participant, "2026-07-17");
const serialized = JSON.stringify(exported);

const forbiddenKeys = new Set([
  "task_text", "task_title", "name", "email", "phone", "prompt", "reply", "response",
  "code", "file", "filename", "file_contents", "path", "credential", "account_id",
  "session_id", "project_id", "internal_id", "notes", "free_text", "timestamp"
]);
function inspectKeys(value) {
  if (Array.isArray(value)) return value.forEach(inspectKeys);
  if (!value || typeof value !== "object") return;
  Object.keys(value).forEach(key => {
    assert.equal(forbiddenKeys.has(key), false, `forbidden export key: ${key}`);
    inspectKeys(value[key]);
  });
}
inspectKeys(exported);
assert.doesNotMatch(serialized, /C:\\|Users\\|@|https?:\/\//i);
assert.match(serialized, /"state":"invalidated"/);
assert.match(serialized, /"invalidation_reason":"task_abandoned"/,
  "abandoned attempts must remain as content-free structured records");

const injectedTop = JSON.parse(serialized);
injectedTop.notes = "private";
assert.throws(() => Pilot.validateExport(injectedTop), /invalid_export_shape/);
const injectedAttempt = JSON.parse(serialized);
injectedAttempt.attempts[0].prompt = "private";
assert.throws(() => Pilot.validateExport(injectedAttempt), /invalid_attempt_shape/);

console.log("TOP prospective pilot privacy and fail-closed export tests passed");
