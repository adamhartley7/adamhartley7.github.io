const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

assert.match(html, /Show My Report First/);
assert.match(html, /Every successful report is followed by optional questions/);
assert.match(html, /Download Or Email My Own Copy/);
assert.match(html, /Open Reviewed Email Draft/);

const start = html.indexOf("function revealStandardPostReport");
const end = html.indexOf("function render(res)", start);
assert.ok(start >= 0 && end > start, "could not locate the standard post-report transition");

const nodes = {
  shareSummaryBox: { hidden: true },
  survey: { hidden: true },
  shareWithTop: { hidden: false },
  out: { scrollIntoViewOptions: null, scrollIntoView(options) { this.scrollIntoViewOptions = options; } },
  resultsHeading: { focusOptions: null, focus(options) { this.focusOptions = options; } },
};
let journey = null;
const context = {
  PILOT_MODE: false,
  document: { getElementById(id) { return nodes[id]; } },
  setJourney(progress, message) { journey = { progress, message }; },
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);
context.revealStandardPostReport();

assert.equal(nodes.shareSummaryBox.hidden, false, "the summary must appear after Route A reports");
assert.equal(nodes.survey.hidden, false, "the optional questions must appear after Route A reports");
assert.equal(nodes.shareWithTop.hidden, true, "the final stage must wait for Finish or Skip");
assert.equal(nodes.out.scrollIntoViewOptions.behavior, "smooth");
assert.equal(nodes.out.scrollIntoViewOptions.block, "start");
assert.equal(nodes.resultsHeading.focusOptions.preventScroll, true);
assert.equal(journey.progress, 0.68);
assert.match(journey.message, /optional questions below/);

console.log("TOP Analyzer post-report flow regression tests passed");
