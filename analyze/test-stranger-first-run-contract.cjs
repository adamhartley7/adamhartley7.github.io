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

function namedDeliveryPromise(value) {
  const text = textOnly(String(value).replace(/<\/(?:p|li|h[1-6]|button|div|section)>/gi, ". "));
  const patterns = [
    /\b(?:TOP|Adam|Sam)(?:'s team)?\s+(?:can|will|may|does|is\s+(?:going|ready)\s+to)\s+(?:submit|send|deliver|upload|email|share)\b/gi,
    /\b(?:TOP|Adam|Sam)(?:'s team)?\s+(?:submits?|sends?|delivers?|uploads?|emails?|shares?)\b/gi,
    /\b(?:submits?|sends?|delivers?|uploads?|emails?|shares?)\s+(?:the|this|your|my|our|a\s+)?[^.!?]{0,60}\b(?:to|with)\s+(?:TOP|Adam|Sam)\b/gi,
    /\b(?:is|are|was|were)\s+(?:submitted|sent|delivered|uploaded|emailed|shared)[^.!?]{0,60}\b(?:to|with)\s+(?:TOP|Adam|Sam)\b/gi,
    /\b(?:will|can|may)\s+be\s+(?:submitted|sent|delivered|uploaded|emailed)[^.!?]{0,60}\b(?:to|with)\s+(?:TOP|Adam|Sam)\b/gi,
    /\b(?:accepted|queued|ready)\s+for\s+delivery[^.!?]{0,60}\b(?:to\s+)?(?:TOP|Adam|Sam)\b/gi,
    /\b(?:TOP|Adam|Sam)(?:'s team)?\s+(?:(?:will|can|may)\s+)?(?:receives?|gets?)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, match.index - 100), match.index);
      const clause = before.split(/[.!?;,]|\b(?:but|however|and|while|although|though|yet)\b/i).pop();
      if (!/\b(?:not|never|nothing|no|cannot|can't|won't|doesn't|didn't|do not|don't|without)\b/i.test(clause)) {
        return match[0];
      }
    }
  }
  return "";
}

function eventRegistrationSource(id) {
  const marker = `document.getElementById("${id}").addEventListener("click",`;
  const start = html.indexOf(marker);
  const end = html.indexOf("});", start);
  assert.ok(start >= 0 && end > start, `could not locate the ${id} click registration`);
  return html.slice(start, end + 3);
}

function controlLabelById(markup, id) {
  const match = new RegExp(`<(?:button|a)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/(?:button|a)>`, "i").exec(markup);
  return match ? textOnly(match[1]) : "";
}

function folderControlHarness(buttonId, writeText) {
  let controlHandler;
  let pickerClicks = 0;
  let clipboardWrites = 0;
  const controlButton = {
    textContent: "Choose folder",
    addEventListener(type, handler) {
      assert.equal(type, "click");
      controlHandler = handler;
    },
  };
  const elements = {
    [buttonId]: controlButton,
    pilotFolderPath: { textContent: "%USERPROFILE%\\.codex\\sessions" },
    pilotHistoryFolder: { click() { pickerClicks += 1; } },
    routea: { hidden: true },
  };
  const context = {
    PILOT_SOURCE: "codex",
    mode: "",
    navigator: { clipboard: { writeText(text) { clipboardWrites += 1; return writeText(text); } } },
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
  const handlerSource = eventRegistrationSource(buttonId);
  vm.runInContext(`${copySource}\n${handlerSource}`, context, { filename: "analyze/index.html" });
  assert.equal(typeof controlHandler, "function", `${buttonId} must register one click handler`);
  return {
    invoke() { return controlHandler.call(controlButton); },
    clipboardWrites() { return clipboardWrites; },
    pickerClicks() { return pickerClicks; },
  };
}

function folderCopyControlId() {
  return /\bid="pilotCopyFolderPath"/i.test(html) ? "pilotCopyFolderPath" : "pilotChooseFolder";
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
  assert.ok(namedDeliveryPromise("TOP can send this report to Adam."));
  assert.ok(namedDeliveryPromise("TOP sends this report to Adam."));
  assert.ok(namedDeliveryPromise("TOP does not store prompts and sends the report to Adam."));
  assert.ok(namedDeliveryPromise("Submit this report to Sam."));
  assert.ok(namedDeliveryPromise("The report is submitted to TOP."));
  assert.ok(namedDeliveryPromise("The report is not stored locally and is submitted to TOP."));
  assert.ok(namedDeliveryPromise("Adam receives the report."));
  assert.equal(namedDeliveryPromise("Nothing is submitted to TOP."), "");
  assert.equal(namedDeliveryPromise("Do not submit this report to TOP."), "");
  assert.equal(namedDeliveryPromise("The report is not submitted to TOP."), "");
  assert.equal(namedDeliveryPromise("TOP does not receive the report."), "");

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

  assert.equal(namedDeliveryPromise(`${rail}\n${finalShare}`), "",
    "the local terminal copy must not promise delivery to TOP, Adam, or Sam");
});

test("the folder flow keeps separate deliberate controls for copy and picker access", () => {
  const folderPanel = sourceBetween('id="pilotFolderPanel"', 'id="pilotCursorPanel"');
  assert.match(controlLabelById(folderPanel, "pilotCopyFolderPath"), /\bcopy\b/i,
    "the folder path must have a deliberate copy control");
  assert.match(controlLabelById(folderPanel, "pilotChooseFolder"), /\b(?:choose|open|select)\b/i,
    "the folder picker must remain reachable through a separate deliberate control");
});

test("the folder picker does not race an unresolved clipboard operation", async () => {
  let resolveClipboard;
  const pendingClipboard = new Promise((resolve) => { resolveClipboard = resolve; });
  const harness = folderControlHarness(folderCopyControlId(), () => pendingClipboard);
  harness.invoke();
  await Promise.resolve();
  assert.equal(harness.pickerClicks(), 0,
    "the folder picker must stay closed while the address copy is unresolved");
  resolveClipboard();
});

test("the folder picker stays closed when clipboard and fallback copy both fail", async () => {
  const harness = folderControlHarness(folderCopyControlId(), () => Promise.reject(new Error("clipboard permission denied")));
  const result = harness.invoke();
  if (result && typeof result.then === "function") await result;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.pickerClicks(), 0,
    "a failed address copy must not hide the instructions behind an opened folder picker");
});

test("the separate folder-picker control opens exactly once without touching the clipboard", async () => {
  const harness = folderControlHarness("pilotChooseFolder", () => Promise.resolve());
  const result = harness.invoke();
  if (result && typeof result.then === "function") await result;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.pickerClicks(), 1, "one deliberate picker click must open the folder chooser once");
  assert.equal(harness.clipboardWrites(), 0,
    "the picker control must not depend on a clipboard permission or asynchronous copy");
});
