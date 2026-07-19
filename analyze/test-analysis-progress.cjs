const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

assert.match(html, /id="analysisProgress" hidden/);
assert.match(html, /role="progressbar"/);
assert.match(html, /id="analysisProgressPercent">0%/);
assert.match(html, /Everything stays on this device/);
assert.match(html, /Math\.min\(99,Math\.floor\(ratio\*100\)\)/,
  "reading must stop below 100 until report construction finishes");
assert.match(html, /function completeAnalysisProgress\(jobId\)/);
assert.match(html, /document\.getElementById\('analysisProgressPercent'\)\.textContent='100%'/);
assert.match(html, /reader\.onprogress=/, "FileReader paths must report real bytes");
assert.match(html, /completedBytes\+offset/, "chunked Codex reads must join current-file bytes to prior files");
assert.match(html, /className='analysis-progress building'/,
  "unmeasurable report construction must use a visible indeterminate state");
assert.match(html, /This step has no honest percentage/,
  "the building state must not invent a percentage");
assert.match(html, /track\.removeAttribute\('aria-valuenow'\)/,
  "the indeterminate state must also be honest to assistive technology");
assert.match(html, /function readTextFiles\(files,done,jobId\)/);
assert.match(html, /function streamCodexFile\(file,fileIndex,accumulator,completedBytes,totalFiles,jobId\)/);
assert.match(html, /if\(!analysisJobIsCurrent\(jobId\)\)return/,
  "asynchronous readers must reject stale jobs");
assert.match(html, /\(readOk\?"Read ":"Attempted "\)/,
  "failed Codex files must not be reported as read");

const pilotStart = html.indexOf("function pilotReadSafeFile");
const pilotEnd = html.indexOf("function initPilot", pilotStart);
const pilotBody = html.slice(pilotStart, pilotEnd);
assert.ok(pilotBody.indexOf('document.getElementById("routea").hidden=false') < pilotBody.indexOf("startAnalysisProgress([file])"),
  "safe-file progress must be visible before reading begins");
assert.match(pilotBody, /analysisProgressBuilding\(jobId\)[\s\S]*setTimeout\(function\(\)/,
  "safe-file parsing must yield so the building state can paint");

const handleStart = html.indexOf("function handle(files,origin)");
const handleEnd = html.indexOf("function run(texts", handleStart);
const handleBody = html.slice(handleStart, handleEnd);
assert.ok(handleBody.indexOf("resetAnalysisProgress()") < handleBody.indexOf("if(!files||!files.length)"),
  "every new selection must clear a completed bar and invalidate older readers before validation");

const start = html.indexOf("function analysisProgressRatio");
const end = html.indexOf("function analysisProgressSet", start);
assert.ok(start >= 0 && end > start, "progress ratio helper not found");
const context = { Math, Number };
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

assert.equal(context.analysisProgressRatio(1000, 2, 0, 0), 0);
assert.equal(context.analysisProgressRatio(1000, 2, 250, 1), 0.25,
  "overall progress must be byte-weighted rather than pretending each file is equal");
assert.equal(context.analysisProgressRatio(1000, 2, 1500, 2), 1);
assert.equal(context.analysisProgressRatio(0, 4, 0, 3), 0.75,
  "zero-byte selections fall back to completed-file progress");
assert.equal(context.analysisProgressRatio(-1, -2, -3, -4), 0);

const elements = {
  analysisProgress: { hidden: true, className: "" },
  analysisProgressTrack: {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
  },
  analysisProgressFill: { style: {} },
  analysisProgressPercent: { textContent: "" },
  analysisProgressLabel: { textContent: "" },
  analysisProgressDetail: { textContent: "" },
};
const progressStart = html.indexOf("var ANALYSIS_JOB_SEQUENCE");
const progressEnd = html.indexOf("function resetDownstream", progressStart);
assert.ok(progressStart >= 0 && progressEnd > progressStart, "progress state helpers not found");
const progressContext = {
  Math,
  Number,
  Array,
  fmtN(value) { return String(value); },
  document: { getElementById(id) { return elements[id]; } },
};
vm.createContext(progressContext);
vm.runInContext(html.slice(progressStart, progressEnd), progressContext);

const firstJob = progressContext.startAnalysisProgress([{ size: 100 }]);
assert.equal(elements.analysisProgress.hidden, false);
assert.equal(elements.analysisProgressPercent.textContent, "0%");
const secondJob = progressContext.startAnalysisProgress([{ size: 200 }]);
assert.notEqual(firstJob, secondJob);
assert.equal(progressContext.analysisProgressSet(100, 1, "stale", null, firstJob), false,
  "a previous FileReader must not update a newer selection");
assert.equal(elements.analysisProgressDetail.textContent.includes("stale"), false);
assert.equal(progressContext.completeAnalysisProgress(firstJob), false,
  "a previous job must not complete the current report");
assert.equal(progressContext.analysisProgressBuilding(secondJob), true);
assert.equal(elements.analysisProgressPercent.textContent, "Final step");
assert.equal("aria-valuenow" in elements.analysisProgressTrack.attributes, false);
assert.equal(progressContext.completeAnalysisProgress(secondJob), true);
assert.equal(elements.analysisProgressPercent.textContent, "100%");
progressContext.resetAnalysisProgress();
assert.equal(elements.analysisProgress.hidden, true,
  "a new invalid selection must not leave an old completed bar visible");

console.log("TOP Analyzer visible progress regression tests passed");
