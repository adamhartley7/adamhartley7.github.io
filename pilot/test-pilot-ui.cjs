const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const app = fs.readFileSync(new URL("pilot-app.js", `file://${__dirname}/`), "utf8");

new vm.Script(app, { filename: "pilot-app.js" });

assert.match(html, /<main id="main"/);
assert.match(html, /id="roleScreen"/);
assert.match(html, /id="participantScreen"[^>]*hidden/);
assert.match(html, /id="coordinatorScreen"[^>]*hidden/);
assert.match(html, /id="questionCard"[^>]*aria-live="polite"/);
assert.equal((html.match(/id="questionCard"/g) || []).length, 1,
  "the participant must see one adaptive question surface, not a long form");
assert.match(html, /id="questionBack" hidden/);
assert.match(html, /id="questionNext"/);
assert.match(html, /id="attemptList"/);
assert.match(html, /id="downloadBackup"/);
assert.match(html, /id="chooseBackup"/);
assert.match(html, /id="confirmRestore"/);
assert.match(html, /id="coordinatorFiles"[^>]*multiple/);
assert.match(html, /id="overallMetrics"/);
assert.match(html, /id="participantSplits"/);
assert.match(html, /id="versionSplits"/);
assert.match(html, /id="classSplits"/);

assert.match(app, /Pilot\.startDraft\(currentParticipant\)/);
assert.match(app, /Pilot\.updateDraft\(currentParticipant/);
assert.match(app, /Pilot\.freezeDraft\(currentParticipant/);
assert.match(app, /Pilot\.pairAttempt\(currentParticipant/);
assert.match(app, /Pilot\.invalidateAttempt\(currentParticipant/);
assert.match(app, /Pilot\.replaceInvalidated\(currentParticipant/);
assert.match(app, /questionBack"\)\.textContent = "Cancel"/);
assert.match(app, /pendingInvalidation = null; renderParticipant\(\)/,
  "starting an invalidation must remain cancelable until a fixed reason is confirmed");
assert.ok(app.indexOf("Pilot.freezeDraft") < app.indexOf("Pilot.pairAttempt"),
  "the source flow must freeze forecasts before accepting an actual");
assert.match(app, /addEventListener\("click", function \(\) \{ pendingInvalidation/);
assert.match(app, /No free-text explanation is collected/);
assert.match(app, /Backup validated\. Nothing has been overwritten yet/);
assert.match(app, /confirmRestore[\s\S]*Pilot\.exportToParticipant/);
assert.match(app, /localStorage\.setItem\(storageKey/);
assert.match(app, /localStorage\.getItem\(storageKey/);
assert.match(app, /Pilot\.parseExport\(await this\.files\[0\]\.text\(\)\)/);
assert.match(app, /Pilot\.coordinatorSummary\(exports\)/);

assert.match(html, /This is an instrumentation check, not evidence that TOP is accurate/);
assert.match(html, /observed coverage is reported, not assumed/i);
assert.match(html, /every forecast excluded from accuracy remain visible/i);
assert.match(html, /coverage floor treats every excluded forecast as a miss/i);
assert.match(html, /95% uncertainty range is a Wilson interval/i);
assert.match(html, /Even 24 tasks cannot establish precise calibration/i);
assert.match(app, /\["95% uncertainty range", percentRange\(summary\.within_p10_p90_wilson_95\)/);
assert.match(app, /\.numerator \+ " covered \/ " \+ summary\.within_p10_p90_wilson_95\.denominator/);
assert.match(html, /No accuracy or savings claim/);

console.log("TOP prospective pilot UI flow tests passed");
