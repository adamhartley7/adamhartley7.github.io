"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start,
    `could not locate ${startMarker} through ${endMarker}`);
  return html.slice(start, end);
}

function initialPilotState(search) {
  const pilotFlow = { hidden: true };
  const resonanceStep = { hidden: false };
  const providerStep = { hidden: true };
  const heading = { textContent: "" };
  const subheading = { textContent: "" };
  let selectedMode = "";
  let selectedRoute = "";
  const context = {
    PILOT_MODE: false,
    URLSearchParams,
    document: {
      documentElement: { classList: { add() {} } },
      getElementById(id) {
        const elements = { pilotFlow, providerStep, resonanceStep };
        assert.ok(elements[id], `unexpected element ${id}`);
        return elements[id];
      },
      querySelector(selector) {
        if (selector === "header h1") return heading;
        if (selector === "header .sub") return subheading;
        throw new Error(`unexpected selector ${selector}`);
      },
    },
    selectRoute(route) { selectedRoute = route; },
    setMode(mode) { selectedMode = mode; },
    setJourney() {},
    window: { location: { search } },
  };
  vm.createContext(context);
  vm.runInContext(sourceBetween("function initPilot()", 'document.getElementById("pilotSourceChoices")'), context,
    { filename: "analyze/index.html" });
  context.initPilot();
  context.initDirectStart();
  return {
    mode: context.PILOT_MODE,
    hidden: pilotFlow.hidden,
    providerVisible: providerStep.hidden === false,
    resonanceHidden: resonanceStep.hidden === true,
    selectedMode,
    selectedRoute,
  };
}

function textOnly(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function buttonLabels(markup) {
  const actions = [];
  for (const match of markup.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    actions.push({ disabled: /\bdisabled\b/i.test(match[2]), label: textOnly(match[3]) });
  }
  for (const match of markup.matchAll(/<input\b([^>]*)>/gi)) {
    const label = /\b(?:value|aria-label)="([^"]*)"/i.exec(match[1]);
    if (label) actions.push({ disabled: /\bdisabled\b/i.test(match[1]), label: textOnly(label[1]) });
  }
  return actions;
}

function clipboardHarness(writeText) {
  let chooseHandler;
  let pickerClicks = 0;
  const chooseButton = {
    textContent: "Choose folder",
    addEventListener(type, handler) {
      assert.equal(type, "click");
      chooseHandler = handler;
    },
  };
  const elements = {
    pilotChooseFolder: chooseButton,
    pilotFolderPath: { textContent: "%USERPROFILE%\\.codex\\sessions" },
    pilotHistoryFolder: { click() { pickerClicks += 1; } },
    routea: { hidden: true },
  };
  const context = {
    PILOT_SOURCE: "codex",
    mode: "",
    navigator: { clipboard: { writeText } },
    pilotStatus() {},
    providerChosen: false,
    selectedRoute: "",
    setTimeout() {},
    document: {
      body: { appendChild() {}, removeChild() {} },
      createElement() {
        return {
          value: "",
          style: {},
          select() {},
          setAttribute() {},
        };
      },
      execCommand(command) {
        assert.equal(command, "copy");
        return false;
      },
      getElementById(id) {
        assert.ok(elements[id], `unexpected element ${id}`);
        return elements[id];
      },
    },
  };
  vm.createContext(context);
  const copySource = sourceBetween("function copyPlainText", 'document.getElementById("copyHistoryPath")');
  const pickerSource = sourceBetween(
    'document.getElementById("pilotChooseFolder").addEventListener',
    'document.getElementById("pilotHistoryFolder").addEventListener',
  );
  vm.runInContext(`${copySource}\n${pickerSource}`, context, { filename: "analyze/index.html" });
  assert.equal(typeof chooseHandler, "function", "the folder control must register one click handler");
  return {
    invoke() { return chooseHandler.call(chooseButton); },
    pickerClicks() { return pickerClicks; },
  };
}

test("the canonical analyzer route opens the guided chooser and keeps an explicit advanced escape", () => {
  const canonical = initialPilotState("");
  assert.equal(canonical.mode, true, "plain /analyze/ must enter guided mode for a stranger");
  assert.equal(canonical.hidden, false, "the guided source chooser must be visible on plain /analyze/");

  const fullLink = /class="pilot-full-link"[\s\S]*?<a\s+href="([^"]+)"/i.exec(html);
  assert.ok(fullLink, "guided mode must keep an explicit link to the advanced analyzer");
  const advancedUrl = new URL(fullLink[1], "https://adamhartley7.github.io/analyze/");
  const advanced = initialPilotState(advancedUrl.search);
  assert.equal(advanced.mode, false, "the advanced-analyzer link must deliberately leave guided mode");
  assert.equal(advanced.hidden, true, "the explicit advanced route must expose the existing analyzer instead");

  for (const [entry, expectedMode] of [["chat", "chat"], ["openai", "openai"]]) {
    const link = new RegExp(`data-pilot-entry="${entry}"\\s+href="([^"]+)"`, "i").exec(html);
    assert.ok(link, `${entry} must have a guided source link`);
    const url = new URL(link[1], "https://adamhartley7.github.io/analyze/");
    const state = initialPilotState(url.search);
    assert.equal(state.selectedMode, expectedMode, `${entry} must still select its source flow`);
    assert.equal(state.selectedRoute, "a", `${entry} must still reach local analysis`);
    assert.equal(state.providerVisible, true, `${entry} must expose the provider step`);
    assert.equal(state.resonanceHidden, true, `${entry} must not fall back to the survey gate`);
  }
});

test("the local-only terminal offers an artifact without a named remote-delivery action", () => {
  const rail = sourceBetween('id="pilotShareRail"', 'id="pilotStepper"');
  const finalShare = sourceBetween('id="shareWithTop"', "</section>");
  const labels = buttonLabels(`${rail}\n${finalShare}`);
  const localActions = labels.filter((button) =>
    !button.disabled && /\b(?:download|copy)\b/i.test(button.label));
  assert.ok(localActions.length > 0,
    "a stranger must be able to keep or copy the locally generated artifact");

  const remoteActions = labels.filter((button) =>
    /\b(?:submit|send|deliver|upload|email)\b/i.test(button.label) ||
    (/\bshare\b/i.test(button.label) && /\b(?:TOP(?: team)?|Adam|Sam)\b/i.test(button.label)));
  assert.deepEqual(remoteActions.map((button) => button.label), [],
    "a no-network analyzer must not present a named remote-delivery action");

  const terminalText = textOnly(`${rail}\n${finalShare}`);
  const namedDelivery = /(?:submit|send|deliver|upload|email)[\s\S]{0,90}\b(?:TOP|Adam|Sam)\b|\b(?:TOP|Adam|Sam)\b[\s\S]{0,90}(?:submit|send|deliver|upload|email)/i;
  assert.doesNotMatch(terminalText, namedDelivery,
    "the local terminal copy must not promise delivery to TOP, Adam, or Sam");
});

test("the folder flow keeps separate deliberate controls for copy and picker access", () => {
  const folderPanel = sourceBetween('id="pilotFolderPanel"', 'id="pilotCursorPanel"');
  const labels = buttonLabels(folderPanel).filter((button) => !button.disabled).map((button) => button.label);
  assert.ok(labels.some((label) => /\bcopy\b/i.test(label)),
    "the folder path must have a deliberate copy control");
  assert.ok(labels.some((label) => /\b(?:choose|open|select)\b/i.test(label)),
    "the folder picker must remain reachable through a separate deliberate control");
});

test("the folder picker does not race an unresolved clipboard operation", async () => {
  let resolveClipboard;
  const pendingClipboard = new Promise((resolve) => { resolveClipboard = resolve; });
  const harness = clipboardHarness(() => pendingClipboard);
  harness.invoke();
  await Promise.resolve();
  assert.equal(harness.pickerClicks(), 0,
    "the folder picker must stay closed while the address copy is unresolved");
  resolveClipboard();
});

test("the folder picker stays closed when clipboard and fallback copy both fail", async () => {
  const harness = clipboardHarness(() => Promise.reject(new Error("clipboard permission denied")));
  const result = harness.invoke();
  if (result && typeof result.then === "function") await result;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.pickerClicks(), 0,
    "a failed address copy must not hide the instructions behind an opened folder picker");
});
