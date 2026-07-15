const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

assert.match(html, /class="coast-world"/);
assert.match(html, /class="black-hole"/);
assert.match(html, /assets\/hubble-c1-starfield\.webp/);
assert.match(html, /assets\/eht-m87-black-hole\.webp/);
assert.match(html, /NASA, ESA, and L\. Dressel/);
assert.match(html, /EHT Collaboration/);
assert.ok(fs.existsSync(new URL("assets/hubble-c1-starfield.webp", `file://${__dirname}/`)));
assert.ok(fs.existsSync(new URL("assets/eht-m87-black-hole.webp", `file://${__dirname}/`)));
assert.match(html, /class="interstellar-scout"/);
assert.match(html, /#8f6cff/);
assert.match(html, /--cosmos-y/);
assert.match(html, /class="orbit-layer orbit-back"/);
assert.match(html, /class="orbit-layer orbit-front"/);
assert.match(html, /class="totem-spin" id="topTotemSpin"/);
assert.match(html, /class="hex-back hex-face"/);
assert.match(html, /translateZ\(27px\)/);
assert.match(html, /assets\/top-spin-physics\.js/);
assert.ok(fs.existsSync(new URL("assets/top-spin-physics.js", `file://${__dirname}/`)));
assert.match(html, /id="topMotionToggle"/);
assert.match(html, /tilt\.addEventListener\('pointerdown'/);
assert.match(html, /tilt\.addEventListener\('pointermove'/);
assert.match(html, /tilt\.addEventListener\('pointerup'/);
assert.match(html, /tilt\.addEventListener\('pointercancel'/);
assert.match(html, /tilt\.addEventListener\('lostpointercapture'/);
assert.match(html, /setPointerCapture/);
assert.match(html, /requestAnimationFrame\(animate\)/);
assert.match(html, /angularVelocity/);
assert.match(html, /unpauseAnimations/);
assert.match(html, /motionQuery\.addEventListener\('change'/);
assert.match(html, /touch-action:none/);
assert.doesNotMatch(html, /\(pointer: coarse\)/);
assert.doesNotMatch(html, /spin\.animate\(/);
assert.doesNotMatch(html, /stroke="#ff9d74"|stroke="#ffc199"/);
assert.match(html, /width:min\(470px,92%\)/);
assert.match(html, /Private on-device analysis, nothing sends itself/);
assert.doesNotMatch(html, /class="hero-totem"/);

const back = html.indexOf('class="orbit-layer orbit-back"');
const prism = html.indexOf('class="totem-tilt"');
const front = html.indexOf('class="orbit-layer orbit-front"');
assert.ok(back >= 0 && prism > back && front > prism,
  "the 3D prism must sit between the back and front orbit layers");

console.log("TOP homepage experience regression tests passed");
