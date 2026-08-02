"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const technicalHtml = fs.readFileSync(new URL("how-top-works/index.html", `file://${__dirname}/`), "utf8");
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

test("a direct visit begins with an unskippable five-second memento screen", () => {
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
    "release timing must remain controlled by the opening script");

  const progressRules = cssDeclarations(".opening-progress");
  assert.match(progressRules, /position\s*:\s*absolute/i);
  assert.match(progressRules, /top\s*:\s*0/i);
  assert.match(progressRules, /height\s*:\s*4px/i);
  const labelRules = cssDeclarations(".opening-label");
  assert.match(labelRules, /position\s*:\s*absolute/i);
  assert.match(labelRules, /top\s*:\s*20px/i);
  assert.match(labelRules, /left\s*:\s*22px/i);
  const progressFillRules = cssDeclarations(".opening-progress::after");
  assert.match(cssDeclarations(":root"), /--opening-duration\s*:\s*5s/i);
  assert.match(cssDeclarations("html.opening-reload"), /--opening-duration\s*:\s*3s/i);
  assert.match(progressFillRules, /animation\s*:\s*opening-progress\s+var\(--opening-duration,\s*5s\)\s+linear\s+both/i);
  assert.match(progressFillRules, /transform\s*:\s*translate3d\(-100%,\s*0,\s*0\)/i);
  assert.match(progressFillRules, /will-change\s*:\s*transform/i);
  assert.match(cssDeclarations(".opening-paused .opening-progress::after"), /animation-play-state\s*:\s*paused/i);
  assert.match(html, /animation\s*:\s*opening-progress\s+var\(--opening-duration,\s*5s\)\s+linear\s+both!important/i,
    "the functional progress cue must remain smooth under reduced-motion settings");
  assert.doesNotMatch(html, /opening-progress\s+var\(--opening-duration,\s*5s\)\s+steps/i,
    "the loading bar must never jump between discrete progress steps");
  assert.match(html, /requiredWait\s*=\s*isReload\s*\?\s*3000\s*:\s*5000/i,
    "reloads should use three seconds while direct visits retain five");
  assert.match(html, /classList\.add\(['"]opening-reload['"]\)/i,
    "reloads should be marked before paint so the progress duration matches");
  assert.match(cssDeclarations(".opening-motto"), /white-space\s*:\s*nowrap/i);
  assert.match(cssDeclarations(".opening-translation"), /white-space\s*:\s*nowrap/i);
  assert.match(html, /window\.location\.hash===['"]#from-how-top-works['"]/i);
  assert.match(cssDeclarations("html.opening-return .opening-screen"), /visibility\s*:\s*hidden/i);
  assert.match(cssDeclarations("html.opening-return .opening-screen"), /pointer-events\s*:\s*none/i);
});

test("the full-width opening is TOP-only, centred, and precedes the summary", () => {
  const opening = elementMarkupById("opening-hero");
  assert.equal(visibleText(opening).replace(/^T O P\b/, "TOP"), "TOP Token • Optimisation • Protocol");
  assert.match(opening, /<h1\b(?=[^>]*\baria-label=["']TOP["'])[^>]*>\s*<span[^>]*>T<\/span><span[^>]*>O<\/span><span[^>]*>P<\/span>\s*<\/h1>/i);
  assert.match(opening, /<p\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bhero-expansion\b)(?=[^>]*\baria-label\s*=\s*["']Token Optimisation Protocol["'])[^>]*>[\s\S]*?<span>Token<\/span>[\s\S]*?<span\b[^>]*>•<\/span>[\s\S]*?<span>Optimisation<\/span>[\s\S]*?<span\b[^>]*>•<\/span>[\s\S]*?<span>Protocol<\/span>[\s\S]*?<\/p>/i);
  assert.doesNotMatch(opening, /\b(?:audience-rail|route-rail)\b/i);

  const mastheadAt = html.search(/<header\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bmasthead\b)/i);
  const openingAt = openingTagById("opening-hero").index;
  const letterAt = openingTagById("founders-letter").index;
  const glanceAt = openingTagById("top-at-a-glance").index;
  assert.ok(mastheadAt >= 0 && openingAt > mastheadAt && letterAt > openingAt);
  assert.ok(glanceAt > letterAt, "TOP at a glance must follow the founders' letter");

  const rules = cssDeclarations(".opening-hero");
  assert.match(rules, /text-align\s*:\s*center/i);
  assert.match(rules, /(?:width\s*:\s*100%|grid-column\s*:\s*1\s*\/\s*-1)/i);
  assert.match(cssDeclarations(".opening-hero-heading"), /width\s*:\s*min\(100%,\s*2\.75em\)/i);
  assert.match(cssDeclarations(".opening-hero h1"), /grid-template-columns\s*:\s*repeat\(3,\s*minmax\(0,1fr\)\)/i);
  assert.match(cssDeclarations(".opening-hero h1 span"), /width\s*:\s*max-content/i);
  assert.match(cssDeclarations(".opening-hero h1 span"), /justify-self\s*:\s*center/i);
  assert.match(cssDeclarations(".opening-hero h1 span"), /text-align\s*:\s*center/i);
  assert.match(cssDeclarations(".opening-hero .hero-expansion"), /width\s*:\s*100%/i);
  assert.match(cssDeclarations(".opening-hero .hero-expansion"), /grid-template-columns\s*:\s*repeat\(3,\s*minmax\(0,1fr\)\)/i);
  assert.match(html, /span:nth-child\(2\)\{left:calc\(33\.333%\s*-\s*1\.205em\)\}/i);
  assert.match(html, /span:nth-child\(4\)\{left:calc\(66\.667%\s*\+\s*\.605em\)\}/i);
  assert.match(html, /@media\(max-width:480px\)[\s\S]*?span:nth-child\(2\)\{left:calc\(33\.333%\s*-\s*1\.11em\)\}/i);
  assert.match(html, /@media\(max-width:480px\)[\s\S]*?span:nth-child\(4\)\{left:calc\(66\.667%\s*\+\s*\.55em\)\}/i);
  assert.match(html, /@media\(max-width:800px\)[\s\S]*?\.opening-hero-heading\{font-size:clamp\(102px,33\.5vw,230px\)\}/i);
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

We want to minimise the asymmetric information available to small and medium sized enterprises,
so you can understand and leverage the inner workings of the black box of AI.

The current AI market asks you to choose between cost and privacy. The cheaper, easier ways to use AI can come with another price: control of your data.

TOP aims to balance the scales, so using powerful AI at a lower cost does not mean giving up control of what belongs to you.

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
  assert.match(letter, /The current AI market asks you to choose between cost and privacy\./i);
  assert.match(letter, /TOP aims to balance the scales, so using powerful AI at a lower cost does not mean giving up control of what belongs to you\./i);
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

  assert.match(html, /<button class="brand-mark"[^>]*data-playful-press[^>]*aria-label="Press the TOP mark"[^>]*>T<\/button>/i);

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
  assert.match(html, /@font-face\{[\s\S]*?font-family:"Grenze Gotisch"[\s\S]*?GrenzeGotisch-Variable\.ttf[\s\S]*?font-weight:100 900[\s\S]*?font-display:swap/i);
  assert.match(cssDeclarations(".calligraphy-glyph.is-calligraphic"), /font-family\s*:\s*var\(--letter-calligraphy\)/i);
  assert.match(cssDeclarations(".manuscript-letter.is-calligraphic .calligraphy-source"), /position\s*:\s*static!important/i);
  assert.match(cssDeclarations(".manuscript-letter.is-calligraphic .calligraphy-source"), /font-family\s*:\s*var\(--letter-calligraphy\)/i);
  assert.match(cssDeclarations(".manuscript-letter.is-calligraphic .calligraphy-visual"), /display\s*:\s*none/i);
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

test("the chosen calligraphy font is self-hosted with its licence", () => {
  assert.equal(fs.existsSync(new URL("assets/fonts/grenze-gotisch/GrenzeGotisch-Variable.ttf", `file://${__dirname}/`)), true);
  assert.equal(fs.existsSync(new URL("assets/fonts/grenze-gotisch/OFL.txt", `file://${__dirname}/`)), true);
  assert.match(fs.readFileSync(new URL("ASSET-CREDITS.md", `file://${__dirname}/`), "utf8"), /Grenze Gotisch typeface[\s\S]*?SIL Open Font License 1\.1/i);
});

test("TOP at a glance preserves Adam's supplied wording and keeps the full route visible", () => {
  const glance = elementMarkupById("top-at-a-glance");
  const visibleBlocks = [...glance.matchAll(/<(?:h2|p)\b[^>]*>([\s\S]*?)<\/(?:h2|p)>/gi)]
    .map((match) => normaliseText(match[1].replace(/<[^>]+>/g, "")));

  assert.deepEqual(visibleBlocks, [
    `TOP at a glance:`,
    `TOP is trying to help companies use AI without creating an expensive, confusing mess.`,
    `Powerful models are already easy to access. The harder questions are practical: what work should an agent do, what information may it see, who checks the result, and what will the work cost?`,
    `Arguably most importantly: who is in control of my data?`,
    `TOP aims to answer these questions clearly and concisely.`,
    `Our #1 long term goal is to hand back control of data to the people. We are working night and day to achieve this goal.`,
    `Privacy and security are our two core tenets.`,
    `For ease of understanding, we like to break these complex concepts down using digestible analogies. The analogy we found most fitting is Transport.`,
    `AI agents are cars. Some companies are still “travelling" (working) by horseback and even by foot. We don’t make the cars, the multi-billion dollar AI companies do (Anthropic, OpenAI etc.).`,
    `However, a company and its cars still needs roads, maps, keys, traffic rules, a depot (TopOS) and a way to forecast and measure fuel (token) consumption (Icarus). TOP is being built as that surrounding system.`,
    `Our immediate focus is TopOS: the infrastructure the cars need to be far more effective at travelling (doing work). The desktop app is in development and aims to be the centralised data hub for your business, utilising cutting edge inter-agentic communication to reduce operational friction. We aim for it to be the most private and secure option on the market, and understand there is a lot of ground to cover before we reach this goal.`,
    `In parallel, our main and more unique focus' are TOP 1, 2 and 3.`,
    `TOP 1 = Icarus, unique algorithmic models (like a taxi-meter) that predict how much fuel (tokens) a trip (AI job) will cost (in dollars, as this is how current API billing works). Using AI at an enterprise level today is like getting into a taxi with no metre. You get slapped with the bill only once you reach the destination.`,
    `TOP 2 = Daedalus, a far more efficient engine which will get you to your destination (complete the job) at a significantly lower cost (hybrid, multimodal engine that utilises more cost effective AI models which will still complete the task without a significant reduction in output quality). You don't need to take out your Ferrari on the school run, but you might want it for a client meeting. We help you make an informed decision, to save you a lot of money. Commercial efficacy is yet to be quantified and is user specific. Current estimates sit at 20% - 50% conservatively.`,
    `TOP 3 = Athena, essentially a smarter, interactive SatNav which helps you create a smart, bulletproof route (plan for the work you want to do) which will get you to your destination (fulfil your goal / the job) smarter, using less fuel (tokens and thus dollars). Crucially, Athena also ensures you actually reach your destination (complete the job you outlined), because the cars (AI agents) are great, but still need a driver at the wheel so they don’t waste your money looping around roundabouts or deviating from the optimal route to the destination which you’ve set out for them).`,
  ]);

  assert.match(glance, /<strong>who is in control of my data\?<\/strong>/);
  assert.match(glance, /<strong>AI agents<\/strong>/);
  assert.match(glance, /<strong>TOP 1 = Icarus<\/strong>/);
  assert.match(glance, /<strong>TOP 2 = Daedalus<\/strong>/);
  assert.match(glance, /<strong>TOP 3 = Athena<\/strong>/);
  assert.match(glance, /<em>a lot<\/em>/);
  assert.doesNotMatch(glance, /<details\b|\saria-expanded\s*=|\shidden(?:\s|=|>)/i,
    "the all-visible route must not hide Adam's copy behind disclosure controls");
  assert.match(cssDeclarations(".top-at-a-glance"), /grid-column\s*:\s*1\s*\/\s*-1/i);
  assert.match(cssDeclarations(".glance-road"), /position\s*:\s*relative/i);
});

test("TOP at a glance now leads directly to the explicit technical gateway", () => {
  const main = elementMarkupById("main-content");
  const glanceAt = openingTagById("top-at-a-glance").index;
  const gatewayAt = openingTagById("next-step").index;

  assert.ok(gatewayAt > glanceAt, "the gateway must follow TOP at a glance");
  assert.match(main, /<section\b(?=[^>]*\bclass="technical-gateway")(?=[^>]*\bid="next-step")[^>]*>/i);
  assert.match(main, /<h2 id="next-step-title">Where would you like to go next\?<\/h2>/);
  assert.doesNotMatch(main, /Each route says what is on the other side|Nothing technical is hidden inside a vague dropdown/i);
  assert.doesNotMatch(main, /<select\b|<details\b/i,
    "the primary onward routes must remain visible");

  const gateway = elementMarkupById("next-step");
  assert.match(gateway, /href="\/how-top-works\/"[\s\S]*?>\s*<strong>Explore how TOP works<\/strong>/i);
  assert.match(gateway, /href="\/how-top-works\/#privacy-security"[\s\S]*?>\s*<strong>Privacy and security<\/strong>/i);
  assert.match(gateway, /href="mailto:adam1hartley@gmail\.com\?subject=TOP%20enquiry"[\s\S]*?>\s*<strong>Talk to the TOP team<\/strong>/i);
  assert.equal((gateway.match(/class="technical-gateway-link"/g) || []).length, 3);
  assert.equal((gateway.match(/class="technical-gateway-choice"/g) || []).length, 3);

  const gatewayLinks = [...gateway.matchAll(/<a\b(?=[^>]*\bclass="technical-gateway-link")[^>]*>[\s\S]*?<\/a>/gi)]
    .map((match) => match[0]);
  assert.equal(gatewayLinks.length, 3);
  for (const link of gatewayLinks) {
    assert.doesNotMatch(link, /Recommended|A call will be very worth your precious time/i,
      "recommendation notes must sit below the tile and its shadow, not inside the link");
  }

  assert.match(gateway, /<a\b(?=[^>]*href="\/how-top-works\/")[^>]*>[\s\S]*?<\/a>\s*<p class="technical-gateway-note">Recommended<\/p>/i);
  assert.match(gateway, /<a\b(?=[^>]*href="\/how-top-works\/#privacy-security")[^>]*>[\s\S]*?<\/a>\s*<p class="technical-gateway-note">Highly Recommended<\/p>/i);
  assert.match(gateway, /<a\b(?=[^>]*href="mailto:adam1hartley@gmail\.com\?subject=TOP%20enquiry")[^>]*>[\s\S]*?<\/a>\s*<p class="technical-gateway-note">A call will be very worth your precious time\. We won't waste it, we'll save it\.<\/p>/i);

  for (const legacyId of [
    "sidebar-introduction", "business", "product-direction", "routes", "topos",
    "optimise", "historical-analyzer", "engineering", "partners", "roadmap",
    "route-map-panel",
  ]) {
    assert.doesNotMatch(main, new RegExp(`\\bid=["']${legacyId}["']`, "i"),
      `homepage main must not retain the old #${legacyId} section`);
  }
});

test("the public homepage stops after the gateway rather than continuing into dense technical copy", () => {
  const main = elementMarkupById("main-content");
  const sectionIds = [...main.matchAll(/<section\b[^>]*\bid=["']([^"']+)["']/gi)]
    .map((match) => match[1]);
  assert.deepEqual(sectionIds, ["opening-hero", "founders-letter", "top-at-a-glance", "next-step"]);
  assert.doesNotMatch(main, /Does your business use AI\?|made-up paths|Illustrative AI cost and output value paths/i);
  assert.match(html, /<a href="\/how-top-works\/">How TOP works<\/a>/i);
  assert.match(html, /<a href="\/how-top-works\/#privacy-security">Privacy &amp; security<\/a>/i);
});

test("the gateway remains tactile, direct and responsive", () => {
  assert.match(cssDeclarations(".technical-gateway"), /grid-column\s*:\s*1\s*\/\s*-1/i);
  assert.match(cssDeclarations(".technical-gateway"), /background\s*:\s*var\(--lemon\)/i);
  assert.match(cssDeclarations(".technical-gateway-links"), /grid-template-columns\s*:\s*repeat\(3,minmax\(0,1fr\)\)/i);
  assert.match(cssDeclarations(".technical-gateway-choice"), /gap\s*:\s*22px/i);
  assert.match(cssDeclarations(".technical-gateway-link"), /border\s*:\s*2px solid var\(--ink\)/i);
  assert.match(cssDeclarations(".technical-gateway-link"), /box-shadow\s*:\s*-7px 7px 0 var\(--ink\)/i);
  assert.match(cssDeclarations(".technical-gateway-note"), /text-align\s*:\s*center/i);
  assert.match(html, /@media\(max-width:800px\)[\s\S]*?\.technical-gateway-links\{grid-template-columns:1fr/i);
  assert.match(html, /@media\(max-width:480px\)[\s\S]*?\.technical-gateway-link\{min-height:118px/i);
});

test("generated manuscript assets and replacement fonts are absent from the restored homepage", () => {
  assert.doesNotMatch(html, /assets\/manuscript\/|Eagle Lake|UnifrakturCook/i);
  assert.equal(fs.existsSync(new URL("assets/manuscript/", `file://${__dirname}/`)), false);
  assert.equal(fs.existsSync(new URL("assets/fonts/eagle-lake/", `file://${__dirname}/`)), false);
  assert.equal(fs.existsSync(new URL("assets/fonts/unifrakturcook/", `file://${__dirname}/`)), false);
});

test("British spelling remains consistent across the homepage and technical layer", () => {
  const publicText = visibleText(html) + " " + visibleText(technicalHtml);
  const metadata = [...(html + technicalHtml).matchAll(/<(?:title|meta)\b[^>]*>/gi)]
    .map((match) => decodeEntities(match[0]))
    .join(" ");
  const americanSpellings = /\b(?:optimization|optimizer|centralized|analyz(?:e|ed|er|ers|es|ing))\b/i;

  assert.doesNotMatch(publicText, americanSpellings);
  assert.doesNotMatch(metadata, americanSpellings);
  assert.match(publicText, /Token Optimisation Protocol/);
  assert.match(publicText, /centralised data hub/);
  assert.match(publicText, /historical analyser/i);
});

test("the separate technical layer exists and the homepage keeps the live analyser reachable", () => {
  assert.match(technicalHtml, /<title>How TOP works \| Token Optimisation Protocol<\/title>/);
  assert.match(technicalHtml, /<link rel="canonical" href="https:\/\/tokenoptimisationprotocol\.org\/how-top-works\/">/);
  assert.ok((html.match(/href="\/analyze\/\?pilot=1"/g) || []).length >= 2);
  assert.doesNotMatch(html, /href="\/analyze\/"/);
});
test("homepage tracking is limited to approved reload counting and a generic load signal", () => {
  const externalScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
  assert.equal(externalScripts.length, 1);
  assert.equal(externalScripts[0][1], "https://gc.zgo.at/count.v5.js");
  assert.match(externalScripts[0][0], /data-goatcounter="https:\/\/adamhartley7\.goatcounter\.com\/count"/i);
  assert.match(externalScripts[0][0], /data-goatcounter-settings='\{"no_onload":true,"no_events":true\}'/i);
  assert.match(html, /window\.goatcounter\.count\(\{[\s\S]*?path:'\/'[\s\S]*?no_session:true/);
  assert.doesNotMatch(html, /<link[^>]+(?:stylesheet|preconnect)[^>]+https?:/i);
  assert.equal((html.match(/window\.fetch\s*\(/g) || []).length, 1);
  assert.doesNotMatch(html, /XMLHttpRequest|sendBeacon|localStorage|sessionStorage/i);
  assert.match(html, /generic load signal through Cloudflare for an ntfy alert/i);
});
