"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1]);
const homepageEnhancementScript = inlineScripts.find((source) => source.includes("initHomepageEasterEggs"));
assert.ok(homepageEnhancementScript, "homepage enhancement script should exist");
const easterEggStart = homepageEnhancementScript.indexOf("(function initHomepageEasterEggs(){");
const easterEggEnd = homepageEnhancementScript.indexOf("(function initRouteMap(){", easterEggStart);
assert.ok(easterEggStart >= 0, "homepage easter-egg script boundary should exist");
assert.ok(easterEggEnd > easterEggStart, "route-map script boundary should follow the easter eggs");
const easterEggSource = homepageEnhancementScript.slice(easterEggStart, easterEggEnd);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    larr: "←",
    lt: "<",
    nbsp: " ",
    quot: '"',
    rarr: "→",
  };
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] || match);
}

function normaliseText(value) {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function visibleText(markup) {
  return normaliseText(markup
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " "));
}

function openingTagById(id) {
  const pattern = new RegExp(
    `<([a-z][\\w:-]*)\\b(?=[^>]*\\bid\\s*=\\s*(["'])${escapeRegExp(id)}\\2)[^>]*>`,
    "i",
  );
  const match = pattern.exec(html);
  assert.ok(match, `#${id} must exist`);
  return { index: match.index, markup: match[0], tag: match[1] };
}

function elementMarkupById(id) {
  const opening = openingTagById(id);
  const tokens = new RegExp(`<\\/?${escapeRegExp(opening.tag)}\\b[^>]*>`, "gi");
  tokens.lastIndex = opening.index + opening.markup.length;
  let depth = 1;
  let token;
  while ((token = tokens.exec(html))) {
    if (/^<\s*\//.test(token[0])) depth -= 1;
    else if (!/\/\s*>$/.test(token[0])) depth += 1;
    if (depth === 0) return html.slice(opening.index, token.index + token[0].length);
  }
  assert.fail(`#${id} must have a closing </${opening.tag}> tag`);
}

function cssDeclarations(selector) {
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
  const match = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "i").exec(styles);
  assert.ok(match, `${selector} must have an explicit CSS rule`);
  return match[1];
}

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      const active = force === undefined ? !values.has(name) : Boolean(force);
      if (active) values.add(name);
      else values.delete(name);
      return active;
    },
  };
}

function runEasterEggHarness({ reducedMotion = false, text = "ABCDE" } = {}) {
  const timers = new Map();
  const frames = new Map();
  const clearedTimers = new Set();
  const documentEvents = {};
  const created = [];
  let nextTimerId = 0;
  let nextFrameId = 0;
  let capturedPointer = null;

  function makeElement(attrs = {}) {
    const listeners = {};
    const element = {
      attrs: { ...attrs },
      children: [],
      className: "",
      classList: makeClassList(),
      offsetWidth: 100,
      textContent: "",
      addEventListener(type, listener) {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(listener);
      },
      appendChild(child) { this.children.push(child); return child; },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
      },
      hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      setPointerCapture(pointerId) { capturedPointer = pointerId; },
      dispatch(type, event = {}) {
        for (const listener of listeners[type] || []) listener(event);
      },
      listeners,
    };
    created.push(element);
    return element;
  }

  const table = makeElement({ "data-tactile-table": "" });
  const playful = makeElement({ "aria-controls": "product-direction-table" });
  const top = makeElement();
  const letter = makeElement();
  const copy = makeElement();
  const toggle = makeElement();
  const status = makeElement();
  const textParent = {
    closest() { return null; },
    replaceChild(fragment) { copy.children = [...fragment.children]; },
  };
  const textNode = { nodeValue: text, parentElement: textParent, parentNode: textParent };
  let textVisited = false;

  const document = {
    hidden: false,
    NodeFilter: { SHOW_TEXT: 4 },
    querySelectorAll(selector) {
      if (selector === "[data-playful-press]") return [playful];
      if (selector === "[data-spin-top]") return [top];
      if (selector === "[data-tactile-table]") return [table];
      throw new Error(`unexpected selector: ${selector}`);
    },
    querySelector(selector) {
      if (selector === ".manuscript-letter") return letter;
      throw new Error(`unexpected selector: ${selector}`);
    },
    getElementById(id) {
      if (id === "product-direction-table") return table;
      if (id === "letter-copy") return copy;
      if (id === "letter-style-toggle") return toggle;
      if (id === "letter-style-status") return status;
      return null;
    },
    createTreeWalker() {
      textVisited = false;
      return { nextNode() { if (textVisited) return null; textVisited = true; return textNode; } };
    },
    createDocumentFragment() {
      return { children: [], appendChild(child) { this.children.push(child); return child; } };
    },
    createTextNode(nodeValue) { return { nodeValue }; },
    createElement() { return makeElement(); },
    addEventListener(type, listener) { documentEvents[type] = listener; },
  };

  const window = {
    matchMedia(query) {
      assert.equal(query, "(prefers-reduced-motion: reduce)");
      return { matches: reducedMotion };
    },
    requestAnimationFrame(callback) {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { clearedTimers.add(id); timers.delete(id); },
  };

  vm.runInNewContext(easterEggSource, { document, window, Array, Date, WeakMap },
    { filename: "homepage-easter-eggs-inline.js" });

  function runFrame(timestamp) {
    const pending = [...frames.entries()];
    frames.clear();
    pending.forEach(([, callback]) => callback(timestamp));
  }

  function runTimer(id) {
    const timer = timers.get(id);
    if (!timer) return;
    timers.delete(id);
    timer.callback();
  }

  return {
    clearedTimers,
    copy,
    document,
    documentEvents,
    frames,
    glyphs: () => created.filter((element) => element.className === "calligraphy-glyph"),
    letter,
    playful,
    runFrame,
    runTimer,
    status,
    table,
    timers,
    toggle,
    top,
    get capturedPointer() { return capturedPointer; },
  };
}

test("homepage inline scripts parse", () => {
  inlineScripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `index-inline-${index}.js` }));
  });
});

test("every visit begins with an unskippable five-second memento screen", () => {
  const screen = elementMarkupById("opening-screen");
  assert.equal(
    visibleText(screen),
    "Loading TOP website Memento mori, ergo carpe diem. (Remember you must die, therefore seize the day)",
  );
  assert.match(screen, /<span\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bopening-progress\b)[^>]*\baria-hidden\s*=\s*["']true["'][^>]*>/i);
  assert.match(screen, /<p\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bopening-label\b)[^>]*>\s*Loading TOP website\s*<\/p>/i);
  assert.match(screen, /<p\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bopening-translation\b)[^>]*>\s*\(Remember you must die, therefore seize the day\)\s*<\/p>/i);
  assert.doesNotMatch(screen, /<(?:a|button|input|select|textarea)\b|\brole\s*=\s*["']button["']/i);

  const screenAt = openingTagById("opening-screen").index;
  const skipLinkAt = html.search(/<a\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bskip-link\b)/i);
  assert.ok(screenAt >= 0 && skipLinkAt > screenAt,
    "the loading screen must precede every interactive page control");

  const rules = cssDeclarations(".opening-screen");
  assert.match(rules, /position\s*:\s*fixed/i);
  assert.match(rules, /inset\s*:\s*0/i);
  assert.match(rules, /z-index\s*:\s*\d+/i);
  assert.doesNotMatch(rules, /animation\s*:/i,
    "CSS animation timing can be shortened by reduced-motion rules; release must use the 5000ms script");

  const progressRules = cssDeclarations(".opening-progress");
  assert.match(progressRules, /position\s*:\s*absolute/i);
  assert.match(progressRules, /top\s*:\s*0/i);
  assert.match(progressRules, /height\s*:\s*4px/i);
  const labelRules = cssDeclarations(".opening-label");
  assert.match(labelRules, /position\s*:\s*absolute/i);
  assert.match(labelRules, /top\s*:\s*20px/i);
  assert.match(labelRules, /left\s*:\s*22px/i);
  const progressFillRules = cssDeclarations(".opening-progress::after");
  assert.match(progressFillRules, /animation\s*:\s*opening-progress\s+5s\s+linear\s+both/i);
  assert.match(progressFillRules, /transform\s*:\s*translate3d\(-100%,\s*0,\s*0\)/i);
  assert.match(progressFillRules, /will-change\s*:\s*transform/i);
  assert.match(cssDeclarations(".opening-paused .opening-progress::after"), /animation-play-state\s*:\s*paused/i);
  assert.match(html, /animation\s*:\s*opening-progress\s+5s\s+linear\s+both!important/i,
    "the functional progress cue must remain smooth under reduced-motion settings");
  assert.doesNotMatch(html, /opening-progress\s+5s\s+steps/i,
    "the loading bar must never jump between discrete progress steps");
  assert.match(cssDeclarations(".opening-motto"), /white-space\s*:\s*nowrap/i);
  assert.match(cssDeclarations(".opening-translation"), /white-space\s*:\s*nowrap/i);
});

test("the full-width opening is TOP-only, centred, and precedes both sidebars", () => {
  const opening = elementMarkupById("opening-hero");
  assert.equal(visibleText(opening).replace(/^T O P\b/, "TOP"), "TOP Token • Optimisation • Protocol");
  assert.match(opening, /<h1\b(?=[^>]*\baria-label=["']TOP["'])[^>]*>\s*<span[^>]*>T<\/span><span[^>]*>O<\/span><span[^>]*>P<\/span>\s*<\/h1>/i);
  assert.match(opening, /<p\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bhero-expansion\b)(?=[^>]*\baria-label\s*=\s*["']Token Optimisation Protocol["'])[^>]*>[\s\S]*?<span>Token<\/span>[\s\S]*?<span\b[^>]*>•<\/span>[\s\S]*?<span>Optimisation<\/span>[\s\S]*?<span\b[^>]*>•<\/span>[\s\S]*?<span>Protocol<\/span>[\s\S]*?<\/p>/i);
  assert.doesNotMatch(opening, /\b(?:audience-rail|route-rail)\b/i);

  const mastheadAt = html.search(/<header\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bmasthead\b)/i);
  const openingAt = openingTagById("opening-hero").index;
  const letterAt = openingTagById("founders-letter").index;
  const audienceAt = html.search(/<aside\b(?=[^>]*\bclass\s*=\s*["'][^"']*\baudience-rail\b)/i);
  const routeMapAt = openingTagById("route-map-panel").index;
  assert.ok(mastheadAt >= 0 && openingAt > mastheadAt && letterAt > openingAt);
  assert.ok(audienceAt > letterAt && routeMapAt > letterAt,
    "neither explanatory sidebar may begin alongside the opening TOP or letter");

  const rules = cssDeclarations(".opening-hero");
  assert.match(rules, /text-align\s*:\s*center/i);
  assert.match(rules, /(?:width\s*:\s*100%|grid-column\s*:\s*1\s*\/\s*-1)/i);
  assert.match(cssDeclarations(".opening-hero-heading"), /width\s*:\s*min\(100%,\s*2\.12em\)/i);
  assert.match(cssDeclarations(".opening-hero h1"), /grid-template-columns\s*:\s*repeat\(3,\s*minmax\(0,1fr\)\)/i);
  assert.match(cssDeclarations(".opening-hero .hero-expansion"), /width\s*:\s*100%/i);
  assert.match(cssDeclarations(".opening-hero .hero-expansion"), /grid-template-columns\s*:\s*repeat\(3,\s*minmax\(0,1fr\)\)/i);
  assert.match(html, /span:nth-child\(2\)\{left:33\.333%\}/i);
  assert.match(html, /span:nth-child\(4\)\{left:66\.667%\}/i);
});

test("the founders' letter contains Adam's approved revised copy", () => {
  const expected = normaliseText(`
Dear reader,

We would like to open with a letter from the TOP team to illustrate our vision.

AI this AI that,

What the F*** is going on?!

If you’re using AI for your business,
especially if you’re not,

You’re probably behind the curve.

TOP is like the slingshot in David’s hand, helping you go toe to toe with Goliath.

AI is a massively powerful tool which can be used to accelerate your business:

We want to minimise the asymmetric information available to people like you,
so you can understand and leverage the inner workings of the black box of AI.

But we won’t stop there…

Once you’re up to speed, we will help implement cutting edge solutions to:

Make your AI agents work forecastable
Your spend trackable
Your workflow far more efficient
Your AI use understandable, auditable and far smarter.

If AI is compared to a car,
We make sure you’re not only at the wheel,
You’ve got a flashier whip than anyone on the block.

You won’t just be ahead of the curve…
They’ll be eating your dust.

Sincerely,
The TOP team.

Adam Hartley, Sam O'Connell, Chullain Lyons, Fionn Gavin et al.
  `);
  const letter = elementMarkupById("founders-letter");
  const letterText = visibleText(letter).replace(/\bD\s+ear reader,/, "Dear reader,");
  assert.ok(letterText.includes(expected), "the letter must contain the approved revised text");
  assert.match(letter, /so you can\s*<strong>understand<\/strong>\s*<em>and<\/em>\s*<strong>leverage<\/strong>\s*the inner workings of the black box of AI\./i);
  assert.match(letter, /<ul\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bletter-solutions\b)[^>]*>[\s\S]*?<li>Make your AI agents work forecastable<\/li>[\s\S]*?<li>Your spend trackable<\/li>[\s\S]*?<li>Your workflow far more efficient<\/li>[\s\S]*?<li>Your AI use understandable, auditable and far smarter\.<\/li>[\s\S]*?<\/ul>/i);
  assert.doesNotMatch(letterText, /\bTop is like the slingshot/);
  assert.doesNotMatch(letterText, /eating you’re dust/);
});

test("the desktop letter is restrained and uses two-dimensional spinning-top ornaments", () => {
  const letter = elementMarkupById("founders-letter");
  const tops = letter.match(/<button\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bmanuscript-top\b)(?=[^>]*\bdata-spin-top\b)[^>]*>/gi) || [];
  assert.equal(tops.length, 2);
  assert.match(letter, /<svg\b(?=[^>]*\bclass=["']manuscript-top-icon["'])[^>]*>/i);
  assert.match(letter, /\bmanuscript-top-left\b/);
  assert.match(letter, /\bmanuscript-top-right\b/);
  assert.match(cssDeclarations(".manuscript-letter"), /max-width\s*:\s*784px/i);
  assert.match(cssDeclarations(".letter-copy"), /max-width\s*:\s*576px/i);
  assert.match(cssDeclarations(".manuscript-top"), /height\s*:\s*54px/i);
  assert.match(html, /\.manuscript-letter\s*\{\s*padding\s*:\s*78px\s+clamp\(24px,8vw,54px\)\s+80px/i,
    "compact layouts must keep the ornament clear of the illuminated drop cap");
});

test("shadowed flourishes are real, accessible, tactile controls", () => {
  const letter = elementMarkupById("founders-letter");
  assert.match(letter, /<button\b(?=[^>]*\bdata-spin-top\b)(?=[^>]*\baria-label="Spin the upper-left top ornament")[^>]*>[\s\S]*?<svg\b[^>]*class="manuscript-top-icon"/i);
  assert.match(letter, /<button\b(?=[^>]*\bdata-spin-top\b)(?=[^>]*\baria-label="Spin the lower-right top ornament")[^>]*>[\s\S]*?<svg\b[^>]*class="manuscript-top-icon"/i);
  assert.match(letter, /<button\b(?=[^>]*\bid="letter-style-toggle")(?=[^>]*\baria-controls="letter-copy")(?=[^>]*\baria-pressed="false")(?=[^>]*\baria-label="Dear reader\. Transform the letter into calligraphy")[^>]*><span aria-hidden="true">D<\/span><\/button><span aria-hidden="true">ear reader,<\/span>/i);
  assert.doesNotMatch(letter, /<article\b[^>]*(?:role="button"|data-playful-press)/i,
    "the letter sheet itself must remain still and non-interactive");

  assert.match(html, /<button class="changing-landscape"[^>]*data-playful-press[^>]*>constantly changing<\/button>/i);
  assert.match(html, /<button class="micro-label"(?=[^>]*\bid="product-direction-label")(?=[^>]*\baria-controls="product-direction-table")[^>]*>00 - Product Direction \/ The Proposed Route<\/button>/i);
  assert.match(html, /<table class="direction-table"(?=[^>]*\bid="product-direction-table")(?=[^>]*\bdata-tactile-table\b)(?=[^>]*\baria-labelledby="product-direction-label")[^>]*>/i);
  assert.doesNotMatch(html, /<table\b[^>]*\btabindex=/i,
    "the title button is the keyboard control; the native table must retain unambiguous semantics");
  assert.match(html, /<caption class="visually-hidden">TOP's proposed product route, transport analogy and intended application<\/caption>/i);
  assert.doesNotMatch(html, /<table\b[^>]*\brole="button"/i);
  assert.doesNotMatch(html, /class="direction-table-button"/i,
    "the table must not be covered by a button overlay");

  assert.match(html, /addEventListener\('pointercancel',release\)/);
  assert.match(html, /addEventListener\('lostpointercapture',release\)/);
  assert.match(html, /setPointerCapture\(event\.pointerId\)/,
    "capturing the pointer ensures an outside release cannot leave the table depressed");
  assert.doesNotMatch(html, /table\.addEventListener\('key(?:down|up)'/,
    "button keyboard behavior must not be grafted onto an element announced as a table");
  assert.match(html, /replayTimers\?replayTimers\.get\(element\):element\.__topReplayTimer/);
  assert.match(html, /window\.clearTimeout\(previousTimer\)/,
    "a repeated easter-egg click must replace the older cleanup timer");
  assert.match(html, /Math\.floor\(\(\(timestamp-startedAt\)\*50\)\/1000\)/,
    "calligraphy must advance at 50 non-space characters per second");
  assert.match(html, /document\.addEventListener\('visibilitychange'/);
  assert.match(html, /closest\('\.visually-hidden'\)/,
    "the accessible salutation must not be split into decorative glyphs");
  assert.doesNotMatch(html, /setInterval\s*\(/);
  assert.match(cssDeclarations(".calligraphy-glyph.is-calligraphic"), /"Old English Text MT","Lucida Calligraphy","Apple Chancery","URW Chancery L",cursive/i);
  assert.match(cssDeclarations(".calligraphy-glyph::before"), /content\s*:\s*attr\(data-glyph\)/i);
  assert.match(html, /glyph\.setAttribute\('data-glyph',character\)/);
  assert.doesNotMatch(html, /glyph\.textContent=character/,
    "generated decorative glyphs must not duplicate the selectable letter text");
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)[\s\S]*?\.calligraphy-glyph\.is-calligraphic\{animation:none!important\}/i);
  assert.match(html, /@media\(max-width:480px\)[\s\S]*?\.manuscript-top\{width:44px;height:50px/i,
    "the interactive tops must keep a 44px minimum target on mobile");
});

test("tactile controls release captured pointers and replace stale replay timers", () => {
  const harness = runEasterEggHarness();

  harness.table.dispatch("pointerdown", { pointerId: 17 });
  assert.equal(harness.capturedPointer, 17);
  assert.equal(harness.table.classList.contains("is-pressed"), true);
  harness.table.dispatch("lostpointercapture");
  assert.equal(harness.table.classList.contains("is-pressed"), false);
  assert.equal(harness.table.listeners.keydown, undefined,
    "the semantic table must not impersonate a keyboard button");

  harness.playful.dispatch("click");
  const firstTimers = [...harness.timers.keys()];
  assert.equal(firstTimers.length, 2, "the control and its table each receive one replay timer");
  harness.playful.dispatch("click");
  firstTimers.forEach((id) => assert.equal(harness.clearedTimers.has(id), true));
  firstTimers.forEach((id) => harness.runTimer(id));
  assert.equal(harness.playful.classList.contains("is-popping"), true,
    "a stale timer must not truncate the newer replay");
  assert.equal(harness.table.classList.contains("is-popping"), true);
  [...harness.timers.keys()].forEach((id) => harness.runTimer(id));
  assert.equal(harness.playful.classList.contains("is-popping"), false);
  assert.equal(harness.table.classList.contains("is-popping"), false);
});

test("calligraphy advances at 50 glyphs per second and reverses cleanly mid-run", () => {
  const harness = runEasterEggHarness({ text: "ABCDE" });
  harness.toggle.dispatch("click");
  assert.equal(harness.glyphs().length, 5);
  assert.equal(harness.toggle.attrs["aria-pressed"], "mixed");
  assert.equal(harness.copy.attrs["aria-busy"], "true");

  harness.runFrame(0);
  harness.runFrame(19);
  assert.equal(harness.glyphs().filter((glyph) => glyph.classList.contains("is-calligraphic")).length, 0);
  harness.runFrame(20);
  assert.equal(harness.glyphs().filter((glyph) => glyph.classList.contains("is-calligraphic")).length, 1);
  harness.runFrame(40);
  assert.equal(harness.glyphs().filter((glyph) => glyph.classList.contains("is-calligraphic")).length, 2);

  harness.toggle.dispatch("click");
  harness.runFrame(1000);
  harness.runFrame(1020);
  assert.equal(harness.glyphs().filter((glyph) => glyph.classList.contains("is-calligraphic")).length, 1);
  harness.runFrame(1040);
  assert.equal(harness.glyphs().filter((glyph) => glyph.classList.contains("is-calligraphic")).length, 0);
  assert.equal(harness.toggle.attrs["aria-pressed"], "false");
  assert.equal(harness.copy.attrs["aria-busy"], "false");
  assert.equal(harness.letter.classList.contains("is-calligraphic"), false);
});

test("calligraphy pauses while hidden and reduced motion applies the final state immediately", () => {
  const harness = runEasterEggHarness({ text: "ABCDE" });
  harness.toggle.dispatch("click");
  harness.runFrame(0);
  harness.runFrame(40);
  assert.equal(harness.glyphs().filter((glyph) => glyph.classList.contains("is-calligraphic")).length, 2);

  harness.document.hidden = true;
  harness.documentEvents.visibilitychange();
  assert.equal(harness.frames.size, 0);
  harness.runFrame(10000);
  assert.equal(harness.glyphs().filter((glyph) => glyph.classList.contains("is-calligraphic")).length, 2);

  harness.document.hidden = false;
  harness.documentEvents.visibilitychange();
  harness.runFrame(10000);
  harness.runFrame(10020);
  assert.equal(harness.glyphs().filter((glyph) => glyph.classList.contains("is-calligraphic")).length, 3,
    "resuming must continue from the visible count rather than catch up hidden time");
  harness.runFrame(10060);
  assert.equal(harness.glyphs().filter((glyph) => glyph.classList.contains("is-calligraphic")).length, 5);
  assert.equal(harness.toggle.attrs["aria-pressed"], "true");
  assert.equal(harness.copy.attrs["aria-busy"], "false");

  const reduced = runEasterEggHarness({ reducedMotion: true, text: "ABCDE" });
  reduced.toggle.dispatch("click");
  assert.equal(reduced.frames.size, 0);
  assert.equal(reduced.glyphs().filter((glyph) => glyph.classList.contains("is-calligraphic")).length, 5);
  assert.equal(reduced.toggle.attrs["aria-pressed"], "true");
  assert.equal(reduced.copy.attrs["aria-busy"], "false");
});

test("only the opening business card receives the added desktop breathing room", () => {
  assert.match(cssDeclarations("#business .hero-lead"), /margin-top\s*:\s*64px/i);
  assert.match(cssDeclarations("#business .hero-analogy"), /margin-top\s*:\s*48px/i);
  assert.match(cssDeclarations("#business .hero-statement"), /margin-top\s*:\s*72px/i);
  assert.match(cssDeclarations("#business .direction-board"), /margin-top\s*:\s*96px/i);
  assert.match(cssDeclarations(".direction-board>.micro-label"), /margin-bottom\s*:\s*28px/i);
  assert.match(html, /#business \.direction-table th,\s*#business \.direction-table td\{padding:20px 18px\}/i);
});

test("the sidebar explanation is the threshold between the letter and prior homepage", () => {
  const letter = openingTagById("founders-letter");
  const introduction = elementMarkupById("sidebar-introduction");
  const introductionAt = openingTagById("sidebar-introduction").index;
  const introductionText = visibleText(introduction);
  const layoutAt = openingTagById("main-content").index;
  const audienceAt = html.search(/<aside\b(?=[^>]*\bclass\s*=\s*["'][^"']*\baudience-rail\b)/i);
  const routeMapAt = openingTagById("route-map-panel").index;

  assert.match(introduction, /<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bsidebar-cue-left\b)[^>]*>/i);
  assert.match(introduction, /<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bsidebar-cue-right\b)[^>]*>/i);
  assert.match(introductionText, /You are/);
  assert.match(introductionText, /(?:←|⟵|⇠|⬅)/);
  assert.match(introductionText, /Site Roadmap/);
  assert.match(introductionText, /(?:→|⟶|⇢|➡)/);
  assert.ok(layoutAt < letter.index && introductionAt > letter.index,
    "the handoff must sit inside the main grid immediately after the full-width letter");
  assert.ok(audienceAt > introductionAt && routeMapAt > introductionAt,
    "the left and right rails must start at the explained threshold");

  for (const id of ["business", "product-direction", "routes", "topos", "optimise",
    "historical-analyzer", "engineering", "partners", "roadmap"]) {
    assert.ok(openingTagById(id).index > introductionAt, `existing #${id} content must remain below the handoff`);
  }
});

test("homepage opens with Adam's approved TOP language", () => {
  const business = elementMarkupById("business");
  assert.doesNotMatch(business, /<h1\b|\bhero-expansion\b/i,
    "the TOP lockup belongs to the opening and must not be duplicated below the handoff");
  assert.match(
    html,
    /The AI landscape is <button class="changing-landscape"[^>]*>constantly changing<\/button>, TOP helps You keep two feet on the ground so You and Your Business stay ahead of the curve/,
  );
  assert.match(html, /TOP is being built as a centralised AI integrator, then optimiser for businesses\./);
  assert.match(
    html,
    /If work is transport, AI agents are cars, and TOP is the road system we are building to make traffic visible, and over time help it run better\. We want to give business owners insight into the black box that is artificial intelligence\./,
  );
  assert.match(html, /Forecastable, cheaper and smarter describe the intended route, not outcomes TOP has proved\./);
  assert.doesNotMatch(html, /The AI landscape never stops moving/i);
});

test("the transport analogy is centred without changing Adam's wording", () => {
  const business = elementMarkupById("business");
  assert.match(
    business,
    /<p\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bhero-analogy\b)[^>]*>[\s\S]*?If work is transport, AI agents are cars, and TOP is the road system we are building to make traffic visible, and over time help it run better\. We want to give business owners insight into the black box that is artificial intelligence\.[\s\S]*?<\/p>/,
  );
  assert.match(cssDeclarations(".hero-analogy"), /text-align\s*:\s*center/i);
});

test("the route-selector title is explicit and its panel uses the yellow signal", () => {
  const routes = elementMarkupById("routes");
  assert.match(
    routes,
    /<p\b(?=[^>]*\bclass\s*=\s*["'][^"']*\beyebrow\b)[^>]*>\s*01 - Route Selector\s*<\/p>/,
  );
  assert.doesNotMatch(routes, />\s*Route selector\s*\/\s*01\s*</i);

  const rules = cssDeclarations(".decision");
  assert.match(rules, /background\s*:\s*var\(--lemon\)/i);
  assert.doesNotMatch(rules, /background\s*:\s*var\(--signal\)/i);
});

test("British spelling is used in visible homepage language and metadata", () => {
  const pageText = visibleText(html);
  const metadata = [...html.matchAll(/<(?:title|meta)\b[^>]*>/gi)]
    .map((match) => decodeEntities(match[0]))
    .join(" ");
  const americanSpellings = /\b(?:optimization|optimizer|centralized|analyz(?:e|ed|er|ers|es|ing))\b/i;

  assert.doesNotMatch(pageText, americanSpellings);
  assert.doesNotMatch(metadata, americanSpellings);
  assert.match(pageText, /Token Optimisation Protocol/);
  assert.match(pageText, /centralised AI integrator, then optimiser/);
  assert.match(pageText, /historical analyser/i);
  assert.match(pageText, /Analyse past journeys/);
});

test("personal-site visual tokens and pressable controls remain explicit", () => {
  for (const token of [
    "--ink:#16140f",
    "--muted:#5f594e",
    "--line:#c9c0ad",
    "--paper:#fff9e8",
    "--desk:#ede8d9",
    "--wash:#f6efd9",
    "--signal:#ff6b2b",
    "--lemon:#ffe89a",
    "--blue:#a7d5f5",
    "--professional-blue:#235c88",
    "--green:#b9ddaf",
    "--red:#f2aa98",
    "--candle-green:#00b300",
    "--candle-red:#ed1b24",
  ]) {
    assert.match(html, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /\.site-frame\{[\s\S]*?border:1px solid var\(--ink\)[\s\S]*?background:var\(--paper\)[\s\S]*?box-shadow:-8px 8px 0 var\(--ink\)/);
  assert.match(html, /\.press-button\{[\s\S]*?border:2px solid var\(--ink\)[\s\S]*?border-radius:2px[\s\S]*?box-shadow:-5px 5px 0 var\(--ink\)/);
  assert.match(html, /@media\(hover:hover\) and \(pointer:fine\)\{[\s\S]*?\.press-button:hover\{[\s\S]*?box-shadow:-2px 2px 0 var\(--ink\)[\s\S]*?translate\(-3px,3px\)/);
  assert.match(html, /\.press-button:active\{[\s\S]*?box-shadow:none[\s\S]*?translate\(-5px,5px\)/);
  assert.match(
    html,
    /\.section\[tabindex="-1"\]:focus-visible,\s*\.product-card\[tabindex="-1"\]:focus-visible,\s*\.live-tool\[tabindex="-1"\]:focus-visible\{[^}]*outline:3px solid var\(--ink\);[^}]*outline-offset:-?\d+px/,
  );
  assert.doesNotMatch(html, /\[tabindex="-1"\]:focus\{[^}]*outline:none/);
  assert.match(html, /\.live-tool\{[\s\S]*?scroll-margin-top:var\(--anchor-offset\)/);
  assert.doesNotMatch(html, /backdrop-filter|border-radius:999|radial-gradient|mix-blend-mode/i);
});

test("the overhead map is replaced by a live clickable TOP route map", () => {
  assert.doesNotMatch(html, /class="network-figure"|class="map-frame"/);
  assert.match(
    html,
    /<aside\b(?=[^>]*\bclass\s*=\s*["'][^"']*\broute-rail\b)(?=[^>]*\bid\s*=\s*["']route-map-panel["'])(?=[^>]*\baria-label\s*=\s*["']Site roadmap["'])[^>]*>/i,
  );
  assert.match(
    html,
    /<nav\b(?=[^>]*\bclass\s*=\s*["'][^"']*\broute-map\b)(?=[^>]*\bid\s*=\s*["']route-map-nav["'])(?=[^>]*\baria-label\s*=\s*["']Live site roadmap["'])[^>]*>/i,
  );
  assert.match(
    html,
    /<a\b(?=[^>]*\bdata-route-map-link\s*=\s*["']business["'])(?=[^>]*\baria-current\s*=\s*["']location["'])[^>]*>/i,
  );
  for (const target of [
    "routes", "topos", "optimise", "icarus", "daedalus", "athena",
    "historical-analyzer", "engineering", "partners", "roadmap",
  ]) {
    assert.match(
      html,
      new RegExp(`<a\\b(?=[^>]*\\bhref\\s*=\\s*["']#${target}["'])(?=[^>]*\\bdata-route-map-link\\s*=\\s*["']${target}["'])[^>]*>`, "i"),
    );
  }
  for (const product of ["icarus", "daedalus", "athena"]) {
    assert.match(
      html,
      new RegExp(`<article\\b(?=[^>]*\\bid\\s*=\\s*["']${product}["'])(?=[^>]*\\bdata-route-map-section\\s*=\\s*["']${product}["'])[^>]*>`, "i"),
    );
  }
  assert.match(html, /<span\b(?=[^>]*\bclass\s*=\s*["'][^"']*\broute-car\b)(?=[^>]*\bid\s*=\s*["']route-car["'])(?=[^>]*\baria-hidden\s*=\s*["']true["'])[^>]*>/i);
  assert.match(html, /<button\b(?=[^>]*\bid\s*=\s*["']motion-toggle["'])(?=[^>]*\btype\s*=\s*["']button["'])(?=[^>]*\baria-pressed\s*=\s*["']false["'])(?=[^>]*\baria-label\s*=\s*["']Pause route-map animation["'])[^>]*>/i);
  assert.match(html, /\.route-node\[aria-current="location"\][\s\S]*?box-shadow:-4px 4px 0 var\(--ink\)/);
  assert.match(html, /\.motion-paused \.route-car\{animation-play-state:paused\}/);
});

test("product direction uses three main columns with stage badges", () => {
  assert.match(html, /<table\b(?=[^>]*\bclass="direction-table")(?=[^>]*\bid="product-direction-table")[^>]*>/);
  for (const heading of ["Name", "Analogy", "Application"]) {
    assert.match(html, new RegExp(`<th scope="col">${heading}</th>`));
  }
  assert.doesNotMatch(html, /\.direction-table thead\s*\{\s*display\s*:\s*none/i);
  assert.match(
    html,
    /\.direction-table thead\s*\{[^}]*position:absolute[^}]*clip:rect\(0,0,0,0\)[^}]*\}/,
  );
  for (const stage of ["Intranet / OS", "TOP 1", "TOP 2", "TOP 3"]) {
    assert.match(html, new RegExp(`<span class="stage-badge">${stage.replace("/", "\\/")}</span>`));
  }
  assert.match(html, /TopOS[\s\S]*?Roads and infrastructure[\s\S]*?The local infrastructure for your AI integration/);
  assert.match(html, /Icarus[\s\S]*?Taximeter \+ fuel gauge[\s\S]*?Make your AI spend forecastable/);
  assert.match(html, /Daedalus[\s\S]*?More efficient engine[\s\S]*?Make your AI use cheaper/);
  assert.match(html, /Athena[\s\S]*?Interactive sat-nav[\s\S]*?Make your AI use smarter/);
  assert.doesNotMatch(html, /Help make your AI use (?:cheaper|smarter)/);
});

test("business route selector sends Yes past TopOS and No to the infrastructure", () => {
  const questionAt = html.indexOf("Does your business use AI?");
  const yesAt = html.indexOf('href="#optimise" data-route="yes"');
  const noAt = html.indexOf('href="#topos" data-route="no"');
  const toposAt = html.indexOf('id="topos"');
  const optimiseAt = html.indexOf('id="optimise"');
  assert.ok(questionAt >= 0 && yesAt > questionAt && noAt > yesAt);
  assert.ok(toposAt > noAt && optimiseAt > toposAt,
    "TopOS must appear first in the document so the Yes route visibly skips it");
  assert.match(html, /Yes skips ahead\. No starts with the road infrastructure\./);
});

test("TopOS and the three optimisation layers use the approved transport analogies", () => {
  assert.match(html, /TopOS lays the roads\./);
  assert.match(html, /TopOS is the infrastructure\./);
  assert.match(html, /proposed local-first intranet road system/);
  for (const infrastructure of ["Roads", "Depots", "Junctions", "Control room"]) {
    assert.match(html, new RegExp(`<h3>${infrastructure}</h3>`));
  }
  assert.match(html, /<h3>Icarus<\/h3>[\s\S]*?Taximeter \+ fuel gauge/);
  assert.match(html, /<h3>Daedalus<\/h3>[\s\S]*?More efficient engine/);
  assert.match(html, /<h3>Athena<\/h3>[\s\S]*?Interactive satnav/);
});

test("maturity labels separate working software from the road map", () => {
  assert.match(html, /Icarus, Daedalus and Athena are working codenames\./);
  assert.match(html, /TopOS[\s\S]*?Concept/);
  assert.match(html, /Icarus[\s\S]*?In validation/);
  assert.match(html, /Daedalus[\s\S]*?Planned R&amp;D/);
  assert.match(html, /Athena[\s\S]*?Planned R&amp;D/);
  assert.match(html, /This shows past journeys\. It is not a pre-run forecast\./);
  assert.match(html, /It has not shipped or been benchmarked\./);
  assert.match(html, /TopOS is not yet built, shipped or validated\./);
});

test("the only live product route is the local historical analyzer", () => {
  const analyzerLinks = html.match(/href="\/analyze\/\?pilot=1"/g) || [];
  assert.ok(analyzerLinks.length >= 3, "the live analyzer should be reachable from each relevant audience route");
  assert.doesNotMatch(html, /href="\/analyze\/"/);
  assert.match(
    html,
    /<div(?=[^>]*\bclass="[^"]*\blive-tool\b[^"]*")(?=[^>]*\bid="historical-analyzer")(?=[^>]*\btabindex="-1")[^>]*>/,
  );
  assert.match(html, /file is analysed locally and is not sent to TOP/);
  assert.match(html, /does not require a developer account, a code change or an upload to TOP/);
  const auditClaim = html.match(/<li><strong>Audit<\/strong><span>([^<]+)<\/span><\/li>/);
  assert.ok(auditClaim, "the analyzer should retain a visible API-rate audit explanation");
  assert.match(auditClaim[1], /\bsupported\b/i);
  assert.match(auditClaim[1], /\bequivalent pay-as-you-go API rates\b/i);
  assert.match(auditClaim[1], /\b(?:when|where|only if)\b[^.]*\bexact\b[^.]*\bmodel\b[^.]*\btoken counts?\b/i);
  assert.match(auditClaim[1], /\bchecked rate\b/i);
  assert.doesNotMatch(
    auditClaim[1],
    /^See your past AI usage in equivalent pay-as-you-go API rates\.$/i,
  );
});

test("Google Calendar calls are truthful placeholders until a real schedule exists", () => {
  assert.match(html, /<button class="press-button" type="button" disabled>Book a TopOS call in Google Calendar<\/button>/);
  assert.match(html, /<button class="press-button" type="button" disabled>Book an Icarus pilot implementation call in Google Calendar<\/button>/);
  assert.match(html, /once the booking schedule is ready/i);
  assert.doesNotMatch(html, /cal\.com|cal\.eu|fresha|calendar\.google\.com/i);
});

test("audience navigation remains functional on desktop and mobile", () => {
  assert.match(html, /<main class="layout" id="main-content">/);
  assert.match(html, /aria-label="Main navigation"/);
  assert.match(html, /aria-label="Audience index"/);
  assert.match(html, /href="#business" data-audience-link="business" aria-current="page">Business operators<\/a>/);
  assert.match(html, /href="#engineering" data-audience-link="engineering">AI &amp; Engineering<\/a>/);
  assert.match(html, /href="#partners" data-audience-link="partners">Investors &amp; Partners<\/a>/);
  assert.match(html, /@media\(max-width:1120px\)\{[\s\S]*?\.audience-rail\{[\s\S]*?position:sticky/);
  assert.match(html, /@media\(max-width:1120px\)\{[\s\S]*?\.main-nav\{[\s\S]*?grid-column:1\/-1/);
  assert.match(html, /class="audience-scroll-cue" aria-hidden="true">More &rarr;<\/span>/);
  assert.match(html, /@media\(max-width:800px\)\{[\s\S]*?\.site-frame\{width:100%;margin:0;border:0;box-shadow:none\}/);
  assert.match(html, /\.signal-list li\{[\s\S]*?grid-template-columns:78px minmax\(0,1fr\)/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(html, /@media\(max-width:[^)]+\)\{[^}]*\.audience-rail\{[^}]*display:none/);
});

test("route choice, tactile panels and audience copy match the approved design", () => {
  assert.match(html, /class="press-button yes" href="#optimise" data-route="yes">Yes<\/a>/);
  assert.match(html, /class="press-button no" href="#topos" data-route="no">No<\/a>/);
  assert.match(html, /\.route-buttons \.yes\{background:var\(--candle-green\)\}/);
  assert.match(html, /\.route-buttons \.no\{background:var\(--candle-red\)\}/);
  assert.match(cssDeclarations("#partners"), /background\s*:\s*var\(--green\)/i);
  assert.match(html, /<h2 id="optimise-title">Measure the journey, <em>then<\/em> improve the traffic\.<\/h2>/);
  assert.match(html, /class="infrastructure-item tactile-panel"/);
  assert.match(html, /class="product-card tactile-panel"/);
  assert.doesNotMatch(html, /class="(?:infrastructure-item|product-card)[^"]*"[^>]+role="button"/);
  assert.match(html, /See the rules of the road\./);
  assert.match(html, /The wider system is explained above\./);
  assert.match(html, /<strong>Private<\/strong><span>Your selected history file stays on your machine and is not sent to TOP\.<\/span>/);
  assert.match(
    html,
    /<strong>Audit<\/strong><span>[^<]*\bsupported\b[^<]*\bequivalent pay-as-you-go API rates\b[^<]*\bexact\b[^<]*\bmodel\b[^<]*\btoken counts?\b[^<]*\bchecked rate\b[^<]*<\/span>/i,
  );
  assert.match(html, /We are early, and we are ambitious\./);
  assert.match(html, /The wider system lacks substantial commercial application\. But the plan is in place\./);
  assert.match(html, /We will not present roadworks as an open motorway\./);
  assert.match(html, /class="press-button professional"[^>]*>Talk to the founders<\/a>/);
});

test("compact value graph is interactive, accessible and explicitly illustrative", () => {
  assert.match(html, /<figure class="value-model tactile-panel" aria-labelledby="value-model-title">/);
  assert.match(html, /<title id="vm-chart-title">Illustrative AI cost and output value paths<\/title>/);
  assert.match(html, /<desc id="vm-chart-desc">[\s\S]*?This is not a customer result\.<\/desc>/);
  assert.match(html, /id="vm-scenario" type="range"[^>]+aria-describedby="vm-caption"/);
  assert.match(html, /These are made-up paths, not a customer result\./);
  assert.match(html, /Daedalus has not shipped or been benchmarked\./);
  assert.match(html, /TOP has not proved a saving or measured output value\./);
  for (const fn of ["vmScenarioAmount", "vmCostSlope", "vmValueSlope", "vmCostAt", "vmValueAt"]) {
    assert.match(html, new RegExp(`function ${fn}\\(`));
  }
});

test("future pages are labelled as a road map, not linked as though they exist", () => {
  for (const planned of [
    "About TOP",
    "FAQ + Help",
    "Contact",
    "Privacy + Security",
    "Team + Vision",
    "TOP desktop download",
  ]) {
    assert.match(html, new RegExp(planned.replace("+", "\\+")));
  }
  assert.doesNotMatch(html, /href="\/(?:about|faq|help|contact|privacy|security|download)(?:\/|")/i);
});

test("homepage has no third-party runtime or tracking", () => {
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(html, /<link[^>]+(?:stylesheet|preconnect)[^>]+https?:/i);
  assert.doesNotMatch(html, /fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|goatcounter/i);
});
