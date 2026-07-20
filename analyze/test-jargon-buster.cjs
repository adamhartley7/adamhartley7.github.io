const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

// ---------------------------------------------------------------------------
// Placement. The plain-language entry point must be near the top of the page and
// visible in BOTH the pilot flow and the ordinary analyzer, so it sits inside
// .flow-shell as a sibling of both, not inside either one.
// ---------------------------------------------------------------------------
const shellStart = html.indexOf('<div class="flow-shell">');
const busterStart = html.indexOf('<details class="jargon-buster"');
const pilotStart = html.indexOf('<section class="pilot-flow" id="pilotFlow"');
const resonanceStart = html.indexOf('<section class="resonance-step" id="resonanceStep"');
assert.ok(shellStart >= 0 && busterStart > shellStart,
  "the jargon buster must live inside the flow shell");
assert.ok(busterStart < pilotStart && busterStart < resonanceStart,
  "the jargon buster must precede both the pilot flow and the ordinary analyzer, so it shows in both modes");

// The pilot-mode stylesheet hides a fixed list of ids. If the buster ever matches
// one of those selectors it would silently vanish for exactly the audience it
// was built for: the visitor arriving on the recruited-tester deep link.
const pilotHideRule = html.match(/\.pilot-mode #resonanceStep[^}]*\{display:none!important\}/g) || [];
assert.ok(pilotHideRule.length > 0, "the pilot-mode hide rule must still be found for this check to mean anything");
for (const rule of pilotHideRule) {
  assert.doesNotMatch(rule, /jargon|#jargonBusterDetails/,
    "the jargon buster must not be hidden in pilot mode");
}

// The summary is the whole point: it has to read as an offer of help, in the
// founder's own words, and it has to be one collapsed line so it never pushes the
// source-choice grid below the fold.
assert.match(html, /<summary>Too much technical jargon\? Not sure how this helps you\?<\/summary>/,
  "the visible invitation must name the problem in plain words");

// The landing page already carried a jargon-buster, but its only route in was a
// button labelled "Explain TOP to me", which does not tell a confused visitor that
// it is for them. A plain-language signpost now sits in the hero. It must not add a
// second copy control or a sixth analyzer deep link, both of which are count-pinned
// by test-homepage-experience.cjs.
const home = fs.readFileSync(new URL("../index.html", `file://${__dirname}/`), "utf8");
assert.match(home, /class="hero-jargon"><a href="#explain">Too much technical jargon\? Not sure how this helps you\?<\/a>/,
  "the landing hero must signpost the explainer in the visitor's own words");
// Placement is pinned tightly on purpose. "Somewhere in the hero" is not good
// enough: a visitor who is already lost will not scroll past the emblem to find
// the thing that would have unconfused them. It must sit immediately under the
// two call-to-action buttons.
const ctaEndAt = home.indexOf('href="#explain">Explain TOP to me</a>');
const heroJargonAt = home.indexOf('<p class="hero-jargon">');
const stageAt = home.indexOf('<div class="stage reveal">');
assert.ok(ctaEndAt >= 0 && heroJargonAt > ctaEndAt && heroJargonAt < stageAt,
  "the signpost must sit between the hero buttons and the product stage");
const betweenCtaAndSignpost = home.slice(home.indexOf("</a>", ctaEndAt) + 4, heroJargonAt);
assert.match(betweenCtaAndSignpost, /^\s*<\/div>\s*$/,
  "nothing may be inserted between the call-to-action buttons and the signpost, or it stops being the next thing a lost visitor reads");
assert.equal((home.match(/id="copyTopExplainer"/g) || []).length, 1,
  "the landing page must still expose exactly one explainer-copy control");
assert.equal((home.match(/href="\/analyze\/\?pilot=1"/g) || []).length, 5,
  "the signpost must not add or remove an analyzer deep link");
// A hero child with no flex order jumps to the top of the mobile stack, above the h1.
assert.match(home, /@media\(max-width:640px\)\{[\s\S]*?\.hero-jargon\{order:4/,
  "the signpost must be ordered in the mobile hero stack, not left to default to the top");

// ---------------------------------------------------------------------------
// Extract the exact prompt text that the copy button puts on the clipboard.
// ---------------------------------------------------------------------------
const promptOpen = html.indexOf('<textarea class="jargon-prompt" id="jargonPrompt" readonly>');
assert.ok(promptOpen >= 0, "the copied prompt must be visible in the page as readonly text");
const promptBodyStart = html.indexOf(">", promptOpen) + 1;
const promptBodyEnd = html.indexOf("</textarea>", promptBodyStart);
assert.ok(promptBodyEnd > promptBodyStart, "the prompt textarea must be closed");
const prompt = html.slice(promptBodyStart, promptBodyEnd);

// A static prompt needs no escaping only while it stays free of markup characters.
// If someone later edits raw <, > or & into it, this fails and points at the fix.
assert.doesNotMatch(prompt, /[<>&]/,
  "the prompt must contain no markup characters, so the readonly textarea needs no escaping");

const promptLines = prompt.split("\n").map((line) => line.trim()).filter(Boolean);
assert.ok(promptLines.length > 15, "the prompt must be substantial enough to be self-contained");

function negated(line) {
  return /\b(?:do not|does not|never|no network request|not uploaded|rather than|cannot)\b/i.test(line);
}
function linesMatching(pattern) {
  return promptLines.filter((line) => pattern.test(line));
}

// ---------------------------------------------------------------------------
// NO NETWORK INSTRUCTION.
// The prompt must be answerable from its own text. An agent told to go and look
// something up is an agent that can be pointed somewhere hostile, and it also
// makes the answer depend on a page the user has not read.
// ---------------------------------------------------------------------------
assert.doesNotMatch(prompt, /https?:\/\//i, "the prompt must contain no URL");
assert.doesNotMatch(prompt, /\bwww\.|\.org\b|\.com\b|\.io\b/i, "the prompt must contain no bare domain either");
assert.doesNotMatch(prompt, /\bcurl\b|\bwget\b|\bnpm\b|\bnpx\b|\bgit clone\b/i,
  "the prompt must not name a command that reaches the network");

const networkVerbs = /\b(?:browse|visit|look ?up|search|download|navigate|retrieve|open a web page|web search)\b/i;
for (const line of linesMatching(networkVerbs)) {
  assert.ok(negated(line),
    `every mention of going online must be a prohibition, but this line is not: ${JSON.stringify(line)}`);
}
assert.ok(
  promptLines.some((line) => /do not open a web page/i.test(line) && /run a command/i.test(line)),
  "the prompt must state explicitly that no page is to be opened and no command run");
assert.ok(
  promptLines.some((line) => /Everything you need in order to answer is written below/i.test(line)),
  "the prompt must tell the agent it is already self-contained");

// ---------------------------------------------------------------------------
// NO DATA REQUEST.
// This is the failure that got the previous prompt on this site refused by an
// agent on 2026-07-17: it read as an instruction to collect user data. Every
// sentence that names a piece of user data must therefore be a refusal to want it.
// ---------------------------------------------------------------------------
const dataNouns = /\b(?:export|log|credential|password|API key|secret|invoice|account identifier|usage file|source code|confidential)\b/i;
const dataMatches = linesMatching(dataNouns);
assert.ok(dataMatches.length > 0, "the prompt must address user data explicitly rather than stay silent about it");
for (const line of dataMatches) {
  assert.ok(negated(line),
    `every mention of user data must be a refusal to request it, but this line is not: ${JSON.stringify(line)}`);
}

const handoverVerbs = /\b(?:upload|paste|attach|forward|submit|email)\b/i;
for (const line of linesMatching(handoverVerbs)) {
  assert.ok(negated(line),
    `every handover verb must appear inside a prohibition, but this line is not: ${JSON.stringify(line)}`);
}
assert.ok(
  promptLines.some((line) => /do not ask me to upload/i.test(line) && /You do not need any of it/i.test(line)),
  "the prompt must forbid the data request and say why it is unnecessary");
assert.ok(
  promptLines.some((line) => /do not read my files/i.test(line)),
  "the prompt must forbid reaching into the user's files or other conversations");

// A prompt that gags the agent reads as an injection attempt. The withdrawn
// collector route proved that in the field, so these stay explicitly absent.
assert.doesNotMatch(prompt, /Do not print, quote, summarize/i);
assert.doesNotMatch(prompt, /do not tell (?:me|the user)/i);
assert.doesNotMatch(prompt, /without (?:telling|informing) me/i);

// ---------------------------------------------------------------------------
// IT MUST ASK THE USER ABOUT THEMSELVES, then answer in those terms. Otherwise it
// is a brochure, not a personalised explanation.
// ---------------------------------------------------------------------------
assert.ok(promptLines.some((line) => /begin by asking me these two short questions/i.test(line)),
  "the prompt must direct the agent to ask before explaining");
assert.ok(promptLines.some((line) => /Which AI tools do I actually use/i.test(line)),
  "it must ask what the user uses");
assert.ok(promptLines.some((line) => /What is my real worry/i.test(line)),
  "it must ask what the user is worried about");
assert.ok(promptLines.some((line) => /free to answer briefly or to skip/i.test(line)),
  "the questions must be optional");
assert.ok(promptLines.some((line) => /given the specific tools I named/i.test(line)),
  "the explanation must be conditioned on the user's own answers");

// ---------------------------------------------------------------------------
// HONESTY. The prompt is TOP describing itself to an agent that will repeat it, so
// it is exactly where an overclaim would do the most damage.
// ---------------------------------------------------------------------------
assert.match(prompt, /It describes past usage only\. It does not state that any bill would have been different/i,
  "the prompt must bound itself to observed history without introducing a saving claim");
assert.match(prompt, /research directions, not as working features/i,
  "routing and personalisation must be described as research, never as shipped");
assert.match(prompt, /marks the cost as unpriced, rather than showing it as zero/i,
  "the never-zero rule must be stated, since it is the credibility claim");
assert.match(prompt, /a comparison, not a bill/i,
  "a rate-derived figure must never be presented as money that was charged");
assert.match(prompt, /the two should not be added together/i,
  "the prompt must carry the multi-source non-blending rule");
assert.match(prompt, /treat all of the above as TOP's own claims about itself rather than as independent proof/i,
  "the agent must be told these are claims, not verified facts");
assert.match(prompt, /say so plainly\. I would rather hear that than a sales pitch/i,
  "the prompt must invite a negative verdict");
assert.doesNotMatch(prompt, /\b\d{1,3}(?:\.\d+)?\s?% (?:accurate|accuracy)/i,
  "no accuracy figure may be asserted");
assert.doesNotMatch(prompt, /\bsavings?\b|\bsaving\b|\bsave (?:you|me|up to)\b/i,
  "saving language must not appear, including in a negative disclaimer");

// The seven supported sources must be named, or the agent cannot tell the user
// whether their own tools are covered.
for (const source of ["Claude Code", "Claude Chat", "ChatGPT", "Codex", "Cursor", "Cursor Composer", "GitHub Copilot"]) {
  assert.ok(prompt.indexOf(source) >= 0, `${source} must be named among the supported sources`);
}

// ---------------------------------------------------------------------------
// The copy control. Behaviour is verified across every clipboard branch, because
// a copy button that silently fails is worse than no button: the visitor pastes
// stale clipboard content into their assistant and gets a nonsense answer.
// ---------------------------------------------------------------------------
const scriptStart = html.indexOf("(function initJargonBuster");
const scriptEnd = html.indexOf("})();", scriptStart);
assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "the copy behaviour must be isolated and testable");
const busterScript = html.slice(scriptStart, scriptEnd + 5);

assert.doesNotMatch(busterScript, /fetch\s*\(|XMLHttpRequest|sendBeacon|window\.open|localStorage/,
  "copying a public prompt must not create a network call, a handoff or a stored record");

function makeHarness({ clipboard = "missing", execCopy = true, secure = true } = {}) {
  const listeners = {};
  const classes = new Set();
  const calls = { execCopy: 0, writeText: [] };

  const document = {
    activeElement: null,
    body: {
      appendChild(field) { field.parentNode = this; },
    },
    execCommand(command) {
      calls.execCopy += 1;
      assert.equal(command, "copy");
      return execCopy;
    },
    createElement(tagName) {
      assert.equal(tagName, "textarea");
      return {
        value: "",
        style: {},
        setAttribute() {},
        select() { document.activeElement = this; },
        remove() { if (document.activeElement === this) document.activeElement = document.body; },
      };
    },
    getElementById(id) { return elements[id] || null; },
  };

  const button = {
    textContent: "Copy the prompt",
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    addEventListener(type, handler) { listeners[type] = handler; },
    focus() { document.activeElement = button; },
  };
  const promptField = {
    value: `  ${prompt}\n  `,
    selected: false,
    focus() { document.activeElement = promptField; },
    select() { promptField.selected = true; },
  };
  const status = { textContent: "Copies only the text shown below." };
  const details = { open: false };
  const elements = {
    copyJargonPrompt: button,
    jargonPrompt: promptField,
    jargonStatus: status,
    jargonBusterDetails: details,
  };

  const navigator = {};
  if (clipboard === "partial") navigator.clipboard = {};
  if (clipboard === "success") {
    navigator.clipboard = { writeText(text) { calls.writeText.push(text); return Promise.resolve(); } };
  }
  if (clipboard === "reject") {
    navigator.clipboard = {
      writeText(text) { calls.writeText.push(text); return Promise.reject(new Error("simulated denial")); },
    };
  }

  vm.runInNewContext(busterScript, {
    document,
    navigator,
    window: { isSecureContext: secure },
    Promise,
    clearTimeout() {},
    setTimeout() { return 1; },
  }, { filename: "jargon-buster-inline.js" });

  return { button, promptField, status, details, document, listeners, calls };
}

async function activate(harness) {
  harness.button.focus();
  assert.equal(typeof harness.listeners.click, "function", "the copy button must have a click handler");
  harness.listeners.click();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  const native = makeHarness({ clipboard: "success" });
  await activate(native);
  assert.deepEqual(native.calls.writeText, [prompt],
    "the clipboard must receive the exact prompt the user was shown, and nothing else");
  assert.equal(native.calls.execCopy, 0);
  assert.equal(native.button.textContent, "Prompt copied");
  assert.equal(native.button.classList.contains("copied"), true);
  assert.match(native.status.textContent, /^Copied\./);
  assert.equal(native.document.activeElement, native.button,
    "focus must return to the invoking button");

  const partial = makeHarness({ clipboard: "partial", execCopy: true });
  await activate(partial);
  assert.equal(partial.calls.execCopy, 1,
    "a partial Clipboard API must fall back instead of throwing");
  assert.equal(partial.button.textContent, "Prompt copied");
  assert.equal(partial.document.activeElement, partial.button);

  const rejected = makeHarness({ clipboard: "reject", execCopy: true });
  await activate(rejected);
  assert.equal(rejected.calls.writeText.length, 1);
  assert.equal(rejected.calls.execCopy, 1);
  assert.equal(rejected.button.textContent, "Prompt copied");
  assert.equal(rejected.document.activeElement, rejected.button);

  const manual = makeHarness({ clipboard: "reject", execCopy: false });
  await activate(manual);
  assert.equal(manual.details.open, true, "a blocked copy must reveal the prompt rather than fail silently");
  assert.equal(manual.promptField.selected, true);
  assert.equal(manual.document.activeElement, manual.promptField);
  assert.match(manual.status.textContent, /^Automatic copy was blocked\./);
  assert.equal(manual.button.textContent, "Copy the prompt",
    "a failed copy must not claim that copying succeeded");

  const insecure = makeHarness({ clipboard: "success", execCopy: true, secure: false });
  await activate(insecure);
  assert.deepEqual(insecure.calls.writeText, [],
    "an insecure context must not call the asynchronous Clipboard API");
  assert.equal(insecure.calls.execCopy, 1);
  assert.equal(insecure.document.activeElement, insecure.button);

  console.log("TOP analyzer jargon-buster tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
