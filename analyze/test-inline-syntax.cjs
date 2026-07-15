const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
assert.ok(scripts.length > 0, "the analyzer must contain its inline application script");
for (const [index, source] of scripts.entries()) {
  assert.doesNotThrow(() => new vm.Script(source, { filename: `analyze-inline-${index}.js` }),
    `inline analyzer script ${index} must parse as JavaScript`);
}

const water = fs.readFileSync(new URL("../assets/analyzer-water.js", `file://${__dirname}/`), "utf8");
assert.doesNotThrow(() => new vm.Script(water, { filename: "analyzer-water.js" }),
  "the optional water overlay must parse as JavaScript");

console.log("TOP Analyzer JavaScript syntax checks passed");
