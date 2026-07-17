const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const credits = fs.readFileSync(new URL("ASSET-CREDITS.md", `file://${__dirname}/`), "utf8");
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
inlineScripts.forEach((source, index) => {
  assert.doesNotThrow(() => new vm.Script(source, { filename: `index-inline-${index}.js` }));
});
assert.match(html, /The next-task estimate is still being tested/);
assert.doesNotMatch(html, /forecasts the token and euro cost of an AI task before it runs/);
assert.match(html, /Your past AI tasks should help price your next one/);
assert.match(html, /A normal usage screen is a receipt\. TOP aims to give you the quote first/);
assert.match(html, /TOP is not the only product trying to estimate AI costs/);
assert.match(html, /We still need to prove that this makes the estimate more accurate/);
assert.match(html, /downloaded copy of your Claude or ChatGPT history/);
assert.match(html, /do not need to change code or connect a developer account/);
assert.match(html, /TOP-1 · Icarus · being tested/);
assert.match(html, /TOP-2 · Daedalus · idea for later/);
assert.match(html, /TOP-3 · Athena · idea for later/);
assert.match(html, /Not available yet/);
assert.doesNotMatch(html, /the first (?:AI )?cost forecast|the only (?:AI )?cost forecast|guaranteed savings/i);

assert.match(html, /class="coast-world"/);
assert.match(html, /class="black-hole"/);
assert.match(html, /\.black-hole\{[^}]*mix-blend-mode:screen/);
assert.doesNotMatch(html, /\.black-hole\{[^}]*aspect-ratio:1/);
assert.doesNotMatch(html, /\.black-hole\{[^}]*mask-image:radial-gradient/);
assert.match(html, /assets\/hubble-c1-starfield\.webp/);
assert.match(html, /assets\/eht-m87-black-hole\.webp/);
assert.match(html, /NASA, ESA, and L\. Dressel/);
assert.match(html, /EHT Collaboration/);
assert.ok(fs.existsSync(new URL("assets/hubble-c1-starfield.webp", `file://${__dirname}/`)));
assert.ok(fs.existsSync(new URL("assets/eht-m87-black-hole.webp", `file://${__dirname}/`)));
assert.doesNotMatch(html, /class="interstellar-scout"/);
assert.match(html, /#a78af2/);
assert.match(html, /--cosmos-y/);
assert.match(html, /class="orbit-layer orbit-back"/);
assert.match(html, /class="orbit-layer orbit-front"/);
assert.match(html, /class="totem-spin" id="topTotemSpin"/);
assert.match(html, /class="hex-back hex-face"/);
assert.match(html, /translateZ\(16px\)/);
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
assert.match(html, /flickVelocityFromSamples/);
assert.match(html, /var idleVelocity=0\.00014/);
assert.match(html, /var decay=Math\.exp\(-0\.00048\*elapsed\)/);
assert.match(html, /unpauseAnimations/);
assert.match(html, /motionQuery\.addEventListener\('change'/);
assert.match(html, /localStorage\.setItem\('top-motion-mode'/);
assert.match(html, /touch-action:none/);
assert.doesNotMatch(html, /\(pointer: coarse\)/);
assert.doesNotMatch(html, /spin\.animate\(/);
assert.doesNotMatch(html, /stroke="#ff9d74"|stroke="#ffc199"/);
assert.match(html, /stroke="#b39cff"/);
assert.match(html, /width:min\(470px,92%\)/);
assert.match(html, /Your chosen history file is not sent to TOP/);
assert.equal((html.match(/href="\/analyze\/\?pilot=1"/g) || []).length, 5,
  "every homepage analyzer call to action must use the low-friction guided route");
assert.doesNotMatch(html, /href="\/analyze\/"/,
  "the homepage must not send new users into the advanced analyzer by default");
assert.doesNotMatch(html, /gc\.zgo\.at|goatcounter/i);
assert.match(html, /<main id="main-content">/);
assert.match(html, /aria-label="Main navigation"/);
assert.match(html, /aria-controls="explore-menu"/);
assert.doesNotMatch(html, /class="hero-totem"/);
assert.match(html, /class="mini-emblem"/);
assert.match(html, /class="mobile-nav"/);
assert.match(html, /class="face-labels"/);
assert.match(html, /\.face-labels\{[^}]*translateZ\(19px\)[^}]*backface-visibility:hidden/);
assert.match(html, /Why a cheaper task may not mean a smaller total bill/);
assert.match(html, /illustrative index, example only/);
assert.match(html, /class="vm-layout"/);
assert.match(html, /\.vm-layout\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
assert.match(html, /\.vm-plot svg\{[^}]*width:100%[^}]*height:auto/);
assert.match(html, /data-vm-graph/);
assert.match(html, /W:960,H:420/);
assert.match(html, /W:760,H:460/);
assert.match(html, /W:520,H:480/);
assert.match(html, /lower-cost AI begins/);
assert.match(html, /the green line rises twice as much as the red line/);
assert.match(html, /useful work, rising 2× as much/);
assert.doesNotMatch(html, /C\.vs1/,
  "the surplus calculation must not depend on the retired value-slope constant");
assert.doesNotMatch(html, /max-height:400px/);
assert.match(html, /aria-valuetext/);
assert.match(html, /Works now/);
assert.match(html, /co-founded with Sam O'Connell/);
assert.match(html, /Sam on LinkedIn/);
assert.match(html, /Sam on GitHub/);
assert.doesNotMatch(html, /📉|🔀|🔥/);
assert.match(html, /overflow-x:clip/);
assert.match(html, /\.vm-controls input\[type=range\][^}]*min-width:0/);
assert.doesNotMatch(html, /Spacecraft silhouette/);
assert.doesNotMatch(credits, /spacecraft/i);
assert.match(html, /max-height:calc\(100dvh - 88px\)/);
assert.match(html, /mobileNav\.open=false/);
assert.match(html, /@media\(max-width:360px\)\{\.logo\{font-size:0/);
assert.match(html, /\.mobile-menu\{position:fixed;top:82px;left:14px;right:14px;width:auto/);
assert.match(html, /\.motion-hint\{width:min\(280px,88vw\)[^}]*white-space:normal/);
assert.match(html, /@media\(max-width:640px\)\{[\s\S]*?\.hero h1\{order:2\}[\s\S]*?\.hero-orbit-stage\{order:5/);

assert.match(html, /href="#explain">Explain TOP to me<\/a>/);
assert.match(html, /<section class="ai-guide-section" id="explain" aria-labelledby="ai-guide-title">/);
assert.match(html, /id="copyTopExplainer"[^>]*aria-describedby="topExplainerStatus"/);
assert.match(html, /id="topExplainerStatus" role="status" aria-live="polite"/);
assert.match(html, /id="topExplainerPrompt" readonly/);
assert.match(html, /Copies the exact prompt available under Preview/);
assert.match(html, /Your AI provider handles anything you paste under its own terms and settings/);
assert.match(html, /Do not attach your account-history export to that chat/);
assert.match(html, /credential, password, secret, API key or confidential material/);
assert.match(html, /do not provide operational instructions for uploading, submitting, emailing or sharing data with TOP/);
assert.match(html, /TOP's own claims, not as independent proof/);
assert.match(html, /That forecast is not yet proven/);
assert.match(html, /Direct submission to TOP is not available today/);
assert.match(html, /Local download, copy and device-sharing controls remain user-controlled/);
assert.match(html, /visiting the sites can still disclose routine request metadata to their hosts and any permitted asset providers/);
assert.match(html, /without sharing your account-history export with TOP/);
assert.doesNotMatch(html, /without sharing any data/);
assert.match(html, /typeof navigator\.clipboard\.writeText==='function'/);
assert.match(html, /navigator\.clipboard\.writeText\(text\)/);
assert.match(html, /document\.execCommand\('copy'\)/);
assert.match(html, /field\.remove\(\);\s*button\.focus\(\);/);
assert.equal((html.match(/id="copyTopExplainer"/g) || []).length, 1,
  "the page must expose one explicit explainer-copy control");

const explainerStart = html.indexOf("(function initTopExplainer");
const explainerEnd = html.indexOf("})();", explainerStart);
assert.ok(explainerStart >= 0 && explainerEnd > explainerStart,
  "the explainer clipboard behavior must remain isolated and testable");
const explainerScript = html.slice(explainerStart, explainerEnd);
assert.doesNotMatch(explainerScript, /fetch\s*\(|XMLHttpRequest|sendBeacon|window\.open/,
  "copying the public explainer prompt must not create a network or provider handoff");

const menuStart = html.indexOf('id="explore-menu"');
const menuEnd = html.indexOf('</div>', menuStart);
const menu = html.slice(menuStart, menuEnd);
assert.equal((menu.match(/<a /g) || []).length, 5,
  "the desktop Explore menu must stay short enough to scan");
assert.ok(menu.indexOf('href="#valuemodel"') > menu.indexOf('href="#suite"'),
  "the value idea must be the third Explore choice");

const back = html.indexOf('class="orbit-layer orbit-back"');
const prism = html.indexOf('class="totem-tilt"');
const front = html.indexOf('class="orbit-layer orbit-front"');
assert.ok(back >= 0 && prism > back && front > prism,
  "the 3D prism must sit between the back and front orbit layers");

const explain = html.indexOf('id="explain"');
const usp = html.indexOf('id="usp"');
const suite = html.indexOf('id="suite"');
const problem = html.indexOf('id="problem"');
const how = html.indexOf('id="how"');
const analyze = html.indexOf('id="analyse"');
const status = html.indexOf('id="status"');
const valueModel = html.indexOf('id="valuemodel"');
assert.ok(explain >= 0 && usp > explain && suite > usp && problem > suite,
  "the plain-language bridge, USP and TOP 1, 2, 3 explanation must appear before the problem detail");
assert.ok(how > problem && analyze > how && status > analyze && valueModel > status,
  "the live TOP-1 path and honest status must appear before the TOP-2 thought experiment");

const graphModelStart = html.indexOf("var VM_VALUE_RISE_RATIO");
const graphModelEnd = html.indexOf("(function(){", graphModelStart);
assert.ok(graphModelStart >= 0 && graphModelEnd > graphModelStart,
  "the value graph model must remain independently testable");
const graphContext = {};
vm.createContext(graphContext);
vm.runInContext(html.slice(graphModelStart, graphModelEnd), graphContext);
const graphConfig = { BEND: 3.3, c0: 0.5, cs1: 1.15, v0: 0.5 };
for (const growth of [0.05, 0.2, 0.5, 1]) {
  for (const [from, to] of [[0, 1.4], [1.4, 3.3], [3.3, 4.8], [4.8, 6], [0, 6]]) {
    const redRise = graphContext.vmCostAt(graphConfig, to, growth)
      - graphContext.vmCostAt(graphConfig, from, growth);
    const greenRise = graphContext.vmValueAt(graphConfig, to, growth)
      - graphContext.vmValueAt(graphConfig, from, growth);
    assert.ok(redRise >= 0 && greenRise >= 0,
      "both graph lines must continue rising across every segment");
    assert.ok(Math.abs(greenRise - 2 * redRise) < 1e-10,
      `green rise must be exactly twice red rise from ${from} to ${to} at ${growth}`);
  }
  for (const x of [0, 1.4, 3.3, 4.8, 6]) {
    for (const value of [
      graphContext.vmCostAt(graphConfig, x, growth),
      graphContext.vmValueAt(graphConfig, x, growth),
    ]) {
      assert.ok(value >= 0 && value <= 14,
        "both graph lines must stay inside the graph at every slider extreme");
    }
  }
}
assert.ok(Math.abs(graphContext.vmValueAt(graphConfig, 6, 1) - 13.49) < 1e-10,
  "the maximum green endpoint must remain visible below the graph ceiling");

console.log("TOP homepage experience regression tests passed");
