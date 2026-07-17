const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const css = fs.readFileSync(new URL("pilot.css", `file://${__dirname}/`), "utf8");

assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
assert.match(css, /html \{ min-width: 320px;/);
assert.match(css, /body \{[\s\S]*?overflow-x: hidden;/);
assert.match(css, /button \{ min-height: 48px; touch-action: manipulation; \}/);
assert.match(css, /\.numeric-field input, \.reason-field select \{[\s\S]*?font-size: 16px;/);
assert.match(css, /\.shell \{ width: min\(calc\(100% - 28px\), 980px\);/);
assert.match(css, /\.choice-grid, \.slot-grid \{ display: grid; grid-template-columns: 1fr;/,
  "the default mobile layout must stay single-column");
assert.match(css, /\.option-list \{ display: grid; grid-template-columns: 1fr;/,
  "question options must be single-column on small screens");
assert.match(css, /\.metric-grid \{ display: grid; grid-template-columns: 1fr 1fr;/);
assert.match(css, /@media \(min-width: 720px\)/,
  "multi-column enhancement must be opt-in above the mobile baseline");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(css, /h1 \{ max-width: 17ch; font-size: clamp\(/);
const wideFixedWidths = css.split(/\r?\n/).filter(line => /^\s*width:\s*(?:[4-9]\d{2}|\d{4,})px/.test(line));
assert.deepEqual(wideFixedWidths, [], "the page must not rely on a wide fixed content width");
assert.match(html, /aria-live="polite"/);
assert.match(html, /aria-label="Participant progress"/);

console.log("TOP prospective pilot mobile-first layout tests passed");
