const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

assert.match(html, /class="coast-world"/);
assert.match(html, /class="black-hole"/);
assert.match(html, /class="interstellar-scout"/);
assert.match(html, /class="orbit-layer orbit-back"/);
assert.match(html, /class="orbit-layer orbit-front"/);
assert.match(html, /class="totem-spin" id="topTotemSpin"/);
assert.match(html, /class="hex-back hex-face"/);
assert.match(html, /translateZ\(27px\)/);
assert.match(html, /spin\.animate\(/);
assert.match(html, /stage\.addEventListener\('pointermove'/);
assert.match(html, /motion\.playbackRate/);
assert.match(html, /width:min\(470px,92%\)/);
assert.match(html, /Private on-device analysis, nothing sends itself/);
assert.doesNotMatch(html, /class="hero-totem"/);

const back = html.indexOf('class="orbit-layer orbit-back"');
const prism = html.indexOf('class="totem-tilt"');
const front = html.indexOf('class="orbit-layer orbit-front"');
assert.ok(back >= 0 && prism > back && front > prism,
  "the 3D prism must sit between the back and front orbit layers");

console.log("TOP homepage experience regression tests passed");
