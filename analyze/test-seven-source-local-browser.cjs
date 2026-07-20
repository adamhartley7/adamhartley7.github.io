"use strict";

/*
 * Local browser integration gate for the seven analyzer source paths.
 *
 * Each case creates one content-free synthetic file, opens analyze/index.html
 * from file:// in a fresh Chromium profile, selects the source, and supplies
 * the fixture through the real #file input. This exercises FileReader,
 * handle(), run(), the source parser, finishParsedResult(), and render().
 *
 * Page network APIs and non-file requests are blocked before analyzer code
 * runs. The HTTP and WebSocket traffic used by this test process to control
 * its own headless browser is Chrome DevTools Protocol traffic, not analyzer
 * page traffic. No development server is started or stopped.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const PAGE_PATH = path.join(__dirname, "index.html");
const FIXTURE_ROOT = path.join(__dirname, "fixtures", "seven-source");
const FIXTURE_MANIFEST = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, "manifest.json"), "utf8"));
const WAIT_STEP_MS = 50;
const WAIT_ATTEMPTS = 300;

if (typeof WebSocket !== "function") {
  throw new Error("This browser test requires Node.js 22 or newer for its built-in WebSocket client");
}

const CASES = [
  {
    name: "Claude Code file input reaches the rendered local report",
    mode: "cc",
    fileName: "synthetic-claude-code.jsonl",
    fixtureFile: "claude-code.jsonl",
    expectedKind: "Claude Code",
    expectedFlags: { codex: false, cursor: false, copilot: false, chatProvider: "", topSource: "" },
    evidence: [
      ["reportScope", /supported usage records found in the selected Claude Code files/i],
      ["cards", /160 tokens/i],
      ["modelTable", /claude-opus-4-8/i],
      ["summary", /Where this came from: Claude Code\./i],
      ["summary", /Total AI usage: 160 tokens\./i],
    ],
  },
  {
    name: "Claude Chat conversations export reaches the rendered local report",
    mode: "chat",
    query: "?start=chat",
    fileName: "conversations.json",
    fixtureFile: "claude-chat.json",
    expectedKind: "Claude Chat conversation export",
    expectedFlags: { codex: false, cursor: false, copilot: false, chatProvider: "Claude Chat", topSource: "" },
    evidence: [
      ["reportScope", /conversation records and visible text inside the file you selected/i],
      ["cards", /about 5 tokens/i],
      ["modelTable", /claude\.ai \(est\.\)/i],
      ["summary", /Where this came from: Claude Chat conversation export\./i],
      ["summary", /Rough text-only estimate from selected file: about 5 tokens\./i],
    ],
  },
  {
    name: "ChatGPT conversations export reaches the rendered local report",
    mode: "openai",
    query: "?start=openai",
    fileName: "conversations.json",
    fixtureFile: "chatgpt.json",
    expectedKind: "ChatGPT conversation export",
    expectedFlags: { codex: false, cursor: false, copilot: false, chatProvider: "ChatGPT", topSource: "" },
    evidence: [
      ["reportScope", /conversation records and visible text inside the file you selected/i],
      ["cards", /about 5 tokens/i],
      ["modelTable", /gpt-5\.6-sol/i],
      ["summary", /Where this came from: ChatGPT conversation export\./i],
      ["summary", /Rough text-only estimate from selected file: about 5 tokens\./i],
    ],
  },
  {
    name: "Codex rollout file input reaches the rendered local report",
    mode: "codex",
    fileName: "rollout-synthetic-codex.jsonl",
    fixtureFile: "codex.jsonl",
    expectedKind: "Codex local session logs",
    expectedFlags: { codex: true, cursor: false, copilot: false, chatProvider: "", topSource: "" },
    evidence: [
      ["reportScope", /recorded model token traffic found in the selected Codex files/i],
      ["cards", /130 tokens/i],
      ["modelTable", /gpt-5\.6-sol[\s\S]*80[\s\S]*30/i],
      ["summary", /Where this came from: Codex local session logs\./i],
      ["summary", /Total model token traffic: 130 tokens\./i],
      ["summary", /Actual Codex cost: Unpriced/i],
      ["summary", /Base-rate API equivalent: \$0\.0013/i],
      ["summary", /not your Codex bill/i],
    ],
  },
  {
    name: "Cursor usage CSV reaches the rendered local report",
    mode: "cursor",
    fileName: "synthetic-cursor-usage.csv",
    fixtureFile: "cursor.csv",
    expectedKind: "Cursor usage CSV",
    expectedFlags: { codex: false, cursor: true, copilot: false, chatProvider: "", topSource: "cursor" },
    evidence: [
      ["reportScope", /rows found in the selected Cursor usage export/i],
      ["cards", /Cost as billed by Cursor/i],
      ["cards", /\$1\.25/i],
      ["cards", /170 tokens/i],
      ["modelTable", /claude-4\.5-sonnet/i],
      ["cursorBreakdown", /Other AI versions: 170 tokens/i],
      ["summary", /Where this came from: Cursor usage CSV\./i],
    ],
  },
  {
    name: "Cursor Composer CSV reaches the rendered Composer breakdown",
    mode: "cursor",
    fileName: "synthetic-cursor-composer-usage.csv",
    fixtureFile: "cursor-composer.csv",
    expectedKind: "Cursor usage CSV",
    expectedFlags: { codex: false, cursor: true, copilot: false, chatProvider: "", topSource: "cursor" },
    evidence: [
      ["reportScope", /rows found in the selected Cursor usage export/i],
      ["cards", /Cost as billed by Cursor/i],
      ["cards", /\$0\.05/i],
      ["cards", /170 tokens/i],
      ["modelTable", /composer-1/i],
      ["cursorBreakdown", /Composer, Cursor's own agent model: 170 tokens/i],
      ["summary", /Composer, Cursor's own agent model: 170 tokens, 1 usage event, recorded cost \$0\.05\./i],
    ],
  },
  {
    name: "GitHub Copilot usage CSV reaches the rendered metering report",
    mode: "copilot",
    fileName: "synthetic-github-copilot-usage.csv",
    fixtureFile: "github-copilot.csv",
    expectedKind: "GitHub Copilot usage report",
    expectedFlags: { codex: false, cursor: false, copilot: true, chatProvider: "", topSource: "copilot" },
    evidence: [
      ["reportScope", /rows found in the selected GitHub Copilot usage report/i],
      ["cards", /Cost as billed by GitHub/i],
      ["cards", /\$0\.65/i],
      ["cards", /AI credits recorded25/i],
      ["cards", /Premium requests recorded12/i],
      ["modelTable", /Claude Sonnet 4\.5/i],
      ["copilotBreakdown", /Premium requests recorded: 12/i],
      ["copilotBreakdown", /AI credits recorded: 25/i],
      ["summary", /Where this came from: GitHub Copilot usage report\./i],
    ],
  },
];

assert.equal(FIXTURE_MANIFEST.schema_version, "top.synthetic-fixtures.v1");
assert.deepEqual(
  Object.keys(FIXTURE_MANIFEST.fixtures).sort(),
  CASES.map((sourceCase) => sourceCase.fixtureFile).sort(),
  "the synthetic manifest must name exactly one fixture for every source journey",
);

function browserPath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome or Edge is required, or set CHROME_PATH");
  return found;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${url} returned ${response.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(1000, () => request.destroy(new Error("CDP endpoint timeout")));
  });
}

async function waitForJson(url, attempts = 100) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await getJson(url);
    } catch (error) {
      lastError = error;
    }
    await delay(WAIT_STEP_MS);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.events.get(message.method) || [];
      listeners.forEach((listener) => listener(message.params || {}));
    });
    this.socket.addEventListener("close", () => {
      const error = new Error("CDP socket closed");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  on(method, listener) {
    const listeners = this.events.get(method) || [];
    listeners.push(listener);
    this.events.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || "browser evaluation failed";
    throw new Error(detail);
  }
  return result.result.value;
}

async function waitForAnalyzer(client) {
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
    const ready = await evaluate(client, `
      document.readyState === "complete"
      && typeof handle === "function"
      && typeof run === "function"
      && typeof render === "function"
      && !!document.getElementById("file")
    `);
    if (ready) return;
    await delay(WAIT_STEP_MS);
  }
  throw new Error("analyzer page did not become ready");
}

async function captureCanonicalEntry(client) {
  return evaluate(client, `(() => {
    const visible = (element) => !!element
      && !element.hidden
      && getComputedStyle(element).display !== "none"
      && getComputedStyle(element).visibility !== "hidden"
      && (typeof element.checkVisibility !== "function"
        || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      && element.getClientRects().length > 0;
    const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const advanced = document.querySelector(".pilot-full-link a");
    const choices = Array.from(document.querySelectorAll("#pilotSourceChoices .pilot-choice"));
    return {
      location: location.href,
      pilotMode: typeof PILOT_MODE === "boolean" ? PILOT_MODE : null,
      pilotClass: document.documentElement.classList.contains("pilot-mode"),
      pilotFlowVisible: visible(document.getElementById("pilotFlow")),
      sourceStepVisible: visible(document.getElementById("pilotSourceStep")),
      legacyGateVisible: visible(document.getElementById("resonanceStep")),
      sourceChoices: choices.map((element) => clean(element.textContent)),
      visibleSourceChoices: choices.filter(visible).map((element) => clean(element.textContent)),
      advancedVisible: visible(advanced),
      advancedHref: advanced ? advanced.getAttribute("href") || "" : "",
    };
  })()`);
}

async function dispatchPointerClick(client, selector, replacementHref = "") {
  const selectorLiteral = JSON.stringify(selector);
  const hrefLiteral = JSON.stringify(replacementHref);
  const target = await evaluate(client, `(() => {
    const control = document.querySelector(${selectorLiteral});
    if (!control) return { found: false };
    if (${hrefLiteral}) control.setAttribute("href", ${hrefLiteral});
    control.scrollIntoView({ block: "center", inline: "center" });
    const rect = control.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      found: true,
      x,
      y,
      hasArea: rect.width > 0 && rect.height > 0,
      receivesPointer: !!hit && (hit === control || control.contains(hit)),
    };
  })()`);
  assert.equal(target.found, true, `guided control not found for ${selector}`);
  assert.equal(target.hasArea, true, `guided control has no clickable area for ${selector}`);
  assert.equal(target.receivesPointer, true, `guided control is blocked from pointer input for ${selector}`);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1,
  });
}

async function waitForGuidedDestination(client, expectedSearch) {
  let lastState = null;
  let lastError = null;
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
    try {
      lastState = await evaluate(client, `(() => ({
        search: location.search,
        ready: document.readyState === "complete"
          && typeof handle === "function"
          && !!document.getElementById("file"),
      }))()`);
      if (lastState.search === expectedSearch && lastState.ready) return;
    } catch (error) {
      lastError = error;
    }
    await delay(WAIT_STEP_MS);
  }
  throw lastError || new Error(`guided destination did not load: ${JSON.stringify(lastState)}`);
}

function guidedAnalyzerTarget(href) {
  assert.doesNotMatch(href, /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i,
    "guided browser-chat links must use a relative analyzer destination");
  const target = new URL(href, "https://local.test/analyze/");
  assert.equal(target.origin, "https://local.test",
    "guided browser-chat links must be same-origin before local test mapping");
  assert.equal(target.pathname, "/analyze/", "guided browser-chat links must stay on the analyzer route");
  return target;
}

assert.throws(
  () => guidedAnalyzerTarget("https://local.test/analyze/?start=chat"),
  /relative analyzer destination/,
  "an absolute web URL must not be masked by the local browser-test mapping",
);

async function exerciseGuidedSource(client, source) {
  const sourceLiteral = JSON.stringify(source);
  const before = await evaluate(client, `(() => {
    const source = ${sourceLiteral};
    const visible = (element) => !!element
      && !element.hidden
      && getComputedStyle(element).display !== "none"
      && getComputedStyle(element).visibility !== "hidden"
      && (typeof element.checkVisibility !== "function"
        || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      && element.getClientRects().length > 0;
    const selector = source === "chat" || source === "openai"
      ? '[data-pilot-entry="' + source + '"]'
      : '[data-pilot-source="' + source + '"]';
    const control = document.querySelector("#pilotSourceChoices " + selector);
    if (!control) return { found: false, source, selector };
    return {
      found: true,
      source,
      selector,
      visible: visible(control),
      tagName: control.tagName,
      text: String(control.textContent || "").replace(/\\s+/g, " ").trim(),
      href: control.getAttribute("href") || "",
    };
  })()`);
  if (!before.found) return { before, after: null };

  if (before.tagName === "A") {
    const target = guidedAnalyzerTarget(before.href);
    const localDestination = pathToFileURL(PAGE_PATH).href + target.search;
    await dispatchPointerClick(client, before.selector, localDestination);
    await waitForGuidedDestination(client, target.search);
    const after = await evaluate(client, `(() => {
      const visible = (element) => !!element
        && !element.hidden
        && getComputedStyle(element).display !== "none"
        && getComputedStyle(element).visibility !== "hidden"
        && (typeof element.checkVisibility !== "function"
          || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
        && element.getClientRects().length > 0;
      const file = document.getElementById("file");
      const chooser = document.getElementById("drop");
      return {
        mode: typeof mode === "string" ? mode : "",
        selectedRoute: typeof selectedRoute === "string" ? selectedRoute : "",
        routeVisible: visible(document.getElementById("routea")),
        providerVisible: visible(document.getElementById("providerStep")),
        fileChooserVisible: visible(chooser) && !!file && !file.disabled && chooser.contains(file),
      };
    })()`);
    return { before, after, destination: target.pathname + target.search };
  }

  await dispatchPointerClick(client, before.selector);
  const after = await evaluate(client, `(() => {
    const source = ${sourceLiteral};
    const visible = (element) => !!element
      && !element.hidden
      && getComputedStyle(element).display !== "none"
      && getComputedStyle(element).visibility !== "hidden"
      && (typeof element.checkVisibility !== "function"
        || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      && element.getClientRects().length > 0;
    const folderMethod = document.querySelector('#pilotMethodChoices [data-pilot-method="folder"]');
    return {
      mode: typeof mode === "string" ? mode : "",
      pilotSource: typeof PILOT_SOURCE === "string" ? PILOT_SOURCE : "",
      sourceStepVisible: visible(document.getElementById("pilotSourceStep")),
      methodStepVisible: visible(document.getElementById("pilotMethodStep")),
      methodChoicesVisible: visible(document.getElementById("pilotMethodChoices")),
      folderMethodVisible: visible(folderMethod),
      folderMethodEnabled: !!folderMethod && !folderMethod.matches(":disabled")
        && folderMethod.getAttribute("aria-disabled") !== "true" && !folderMethod.closest("[inert]"),
      cursorPanelVisible: visible(document.getElementById("pilotCursorPanel")),
      copilotPanelVisible: visible(document.getElementById("pilotCopilotPanel")),
    };
  })()`);
  if (source === "cc" || source === "codex") {
    await dispatchPointerClick(client, '#pilotMethodChoices [data-pilot-method="folder"]');
    const folderState = await evaluate(client, `(() => {
      const visible = (element) => !!element
        && !element.hidden
        && getComputedStyle(element).display !== "none"
        && getComputedStyle(element).visibility !== "hidden"
        && (typeof element.checkVisibility !== "function"
          || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
        && element.getClientRects().length > 0;
      const chooser = document.getElementById("pilotChooseFolder");
      return {
        folderPanelVisible: visible(document.getElementById("pilotFolderPanel")),
        folderChooserVisible: visible(chooser),
        folderChooserEnabled: !!chooser && !chooser.matches(":disabled")
          && chooser.getAttribute("aria-disabled") !== "true" && !chooser.closest("[inert]"),
      };
    })()`);
    Object.assign(after, folderState);
  }
  return { before, after, destination: "" };
}

async function selectSource(client, sourceCase) {
  const modeLiteral = JSON.stringify(sourceCase.mode);
  return evaluate(client, `(() => {
    const targetMode = ${modeLiteral};
    if (targetMode !== "chat" && targetMode !== "openai") {
      const resonanceChoice = document.querySelector("#resonanceChoices .resonance-choice");
      if (!resonanceChoice) throw new Error("resonance choice not found");
      resonanceChoice.click();
      document.getElementById("resonanceContinue").click();

      if (targetMode === "cc") {
        document.querySelector('#tabs [data-provider="claude"]').click();
        document.querySelector('#claudeSources [data-mode="cc"]').click();
      } else {
        const sourceButton = document.querySelector('#tabs [data-mode="' + targetMode + '"]');
        if (!sourceButton) throw new Error("source button not found for " + targetMode);
        sourceButton.click();
      }
      document.querySelector('.routepick[data-route="a"]').click();
    }
    return {
      selectedMode: typeof mode === "string" ? mode : "",
      selectedRoute: typeof selectedRoute === "string" ? selectedRoute : "",
      routeVisible: !document.getElementById("routea").hidden,
      accept: document.getElementById("file").getAttribute("accept") || "",
    };
  })()`);
}

async function setFileInput(client, fixturePath) {
  await client.send("DOM.enable");
  const { root } = await client.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "#file",
  });
  assert.ok(nodeId, "the analyzer #file input must exist");
  // DOM.setFileInputFiles fires the native change event. The analyzer then
  // clears the input deliberately so selecting the same file can work again.
  // Dispatching another change here would therefore create an empty retry.
  await client.send("DOM.setFileInputFiles", { nodeId, files: [fixturePath] });
  return { count: 1, name: path.basename(fixturePath) };
}

async function waitForReport(client) {
  let lastState = null;
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
    lastState = await evaluate(client, `(() => {
      const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const errorNode = document.getElementById("err");
      const output = document.getElementById("out");
      const percent = clean(document.getElementById("analysisProgressPercent").textContent);
      const error = clean(errorNode.textContent);
      return {
        done: typeof LAST_RESULT === "object" && LAST_RESULT !== null
          && output.style.display === "block" && percent === "100%",
        error: error && getComputedStyle(errorNode).display !== "none" ? error : "",
        percent,
        status: clean(document.getElementById("fileStatus").textContent),
      };
    })()`);
    if (lastState.error) throw new Error(lastState.error);
    if (lastState.done) return lastState;
    await delay(WAIT_STEP_MS);
  }
  throw new Error(`report did not complete: ${JSON.stringify(lastState)}`);
}

async function captureReport(client) {
  return evaluate(client, `(() => {
    const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const text = (id) => clean(document.getElementById(id)?.textContent);
    const result = typeof LAST_RESULT === "object" && LAST_RESULT ? LAST_RESULT : {};
    const output = document.getElementById("out");
    const route = document.getElementById("routea");
    const progress = document.getElementById("analysisProgress");
    const track = document.getElementById("analysisProgressTrack");
    const pilotMetrics = document.getElementById("pilotMetrics");
    const visiblePilotMetrics = pilotMetrics
      ? Array.from(pilotMetrics.children).filter((element) => !element.hidden && getComputedStyle(element).display !== "none")
      : [];
    return {
      mode: typeof mode === "string" ? mode : "",
      kind: String(result.kind || ""),
      codex: result.codex === true,
      cursor: result.cursor === true,
      copilot: result.copilot === true,
      chatProvider: String(result.chatProvider || ""),
      topSource: String(result.topSource || ""),
      routeVisible: !route.hidden && getComputedStyle(route).display !== "none",
      reportVisible: output.style.display === "block" && getComputedStyle(output).display !== "none",
      progressVisible: !progress.hidden && getComputedStyle(progress).display !== "none",
      progressPercent: text("analysisProgressPercent"),
      progressAriaNow: track.getAttribute("aria-valuenow"),
      status: text("fileStatus"),
      error: text("err"),
      reportScope: text("reportScope"),
      cards: text("cards"),
      modelTable: text("modeltable"),
      cursorBreakdown: text("cursorBreakdown"),
      copilotBreakdown: text("copilotBreakdown"),
      summary: String(document.getElementById("summary").value || ""),
      pilotApiEquivalent: text("pilotQuickApiEquivalent"),
      pilotApiMetricHidden: document.getElementById("pilotQuickApiMetric")?.hidden ?? true,
      pilotMetricsHaveApiEquivalent: pilotMetrics?.classList.contains("has-api-equivalent") ?? false,
      pilotMetricWidths: visiblePilotMetrics.map((element) => element.getBoundingClientRect().width),
    };
  })()`);
}

async function stopOwnedBrowser(browser) {
  if (!browser || !browser.pid || browser.exitCode !== null) return;
  const exited = new Promise((resolve) => browser.once("exit", resolve));
  browser.kill();
  await Promise.race([exited, delay(2000)]);
  if (browser.exitCode === null) {
    browser.kill("SIGKILL");
    await Promise.race([exited, delay(2000)]);
  }
}

async function removeTemporaryTree(target) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      return;
    } catch (error) {
      lastError = error;
      if (!error || !["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
      await delay(100);
    }
  }
  throw lastError || new Error(`Could not remove temporary tree ${target}`);
}

async function runCase(sourceCase) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "top-analyzer-seven-source-"));
  const profile = path.join(temporaryRoot, "browser-profile");
  fs.mkdirSync(profile);
  const fixturePath = sourceCase.fileName ? path.join(temporaryRoot, sourceCase.fileName) : "";
  if (fixturePath) {
    assert.match(sourceCase.fixtureFile, /^[a-z0-9-]+\.(?:csv|json|jsonl)$/,
      "each source journey must name one checked-in synthetic fixture");
    const checkedInFixture = path.resolve(FIXTURE_ROOT, sourceCase.fixtureFile);
    assert.ok(checkedInFixture.startsWith(`${path.resolve(FIXTURE_ROOT)}${path.sep}`),
      "a source fixture must stay inside analyze/fixtures/seven-source");
    assert.ok(fs.existsSync(checkedInFixture), `missing checked-in source fixture: ${sourceCase.fixtureFile}`);
    const fixtureText = fs.readFileSync(checkedInFixture, "utf8");
    const declaration = FIXTURE_MANIFEST.fixtures[sourceCase.fixtureFile];
    assert.deepEqual(
      { synthetic: declaration?.synthetic, contains_real_user_data: declaration?.contains_real_user_data },
      { synthetic: true, contains_real_user_data: false },
      `${sourceCase.fixtureFile} must be declared synthetic and free of real user data`,
    );
    assert.doesNotMatch(fixtureText, /(?:[A-Z]:\\Users\\|\/Users\/|\/home\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
      `${sourceCase.fixtureFile} must contain no home path or email address`);
    fs.copyFileSync(checkedInFixture, fixturePath);
  }

  const port = await getFreePort();
  const browser = spawn(browserPath(), [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--allow-file-access-from-files",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-domain-reliability",
    "--disable-features=MediaRouter,OptimizationHints,Translate",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  const browserStarted = new Promise((resolve, reject) => {
    browser.once("spawn", resolve);
    browser.once("error", reject);
  });

  let client;
  try {
    await browserStarted;
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("headless browser created no page target");

    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.open();
    const pageRequests = [];
    const runtimeErrors = [];
    const consoleErrors = [];
    client.on("Network.requestWillBeSent", ({ request }) => pageRequests.push(request.url));
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      runtimeErrors.push(exceptionDetails.exception?.description || exceptionDetails.text || "runtime exception");
    });
    client.on("Runtime.consoleAPICalled", ({ type, args }) => {
      if (type !== "error" && type !== "assert") return;
      consoleErrors.push((args || []).map((argument) => argument.value ?? argument.description ?? "").join(" "));
    });

    await client.send("Network.enable");
    await client.send("Network.setBlockedURLs", { urls: ["http://*", "https://*", "ws://*", "wss://*"] });
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        globalThis.fetch = function () { throw new Error("fixture blocks fetch"); };
        globalThis.XMLHttpRequest = function () { throw new Error("fixture blocks XMLHttpRequest"); };
        globalThis.WebSocket = function () { throw new Error("fixture blocks WebSocket"); };
        globalThis.EventSource = function () { throw new Error("fixture blocks EventSource"); };
        if (globalThis.navigator) {
          Object.defineProperty(globalThis.navigator, "sendBeacon", {
            configurable: true,
            value: function () { throw new Error("fixture blocks sendBeacon"); },
          });
        }
      `,
    });

    const pageUrl = pathToFileURL(PAGE_PATH).href + (sourceCase.query || "");
    const navigation = await client.send("Page.navigate", { url: pageUrl });
    assert.equal(navigation.errorText, undefined, "the local analyzer page must load");
    await waitForAnalyzer(client);
    if (sourceCase.guidedSource) {
      const guided = await exerciseGuidedSource(client, sourceCase.guidedSource);
      return { guided, pageRequests, runtimeErrors, consoleErrors };
    }
    if (sourceCase.entryOnly) {
      const entry = await captureCanonicalEntry(client);
      return { entry, pageRequests, runtimeErrors, consoleErrors };
    }
    const setup = await selectSource(client, sourceCase);
    const selectedFile = await setFileInput(client, fixturePath);
    await waitForReport(client);
    const report = await captureReport(client);

    return { setup, selectedFile, report, pageRequests, runtimeErrors, consoleErrors };
  } finally {
    if (client) {
      try {
        await Promise.race([client.send("Browser.close"), delay(1000)]);
      } catch (error) {
        // Browser.close commonly closes the socket before its reply is observed.
      }
      client.close();
    }
    await stopOwnedBrowser(browser);
    // Chrome can report its parent process closed while a short-lived profile helper still owns a
    // Windows file handle. Yield once before the asynchronous retry loop removes the owned tree.
    await delay(250);
    await removeTemporaryTree(temporaryRoot);
  }
}

function registerSevenSourceTests() {
  for (const sourceCase of CASES) {
    test(sourceCase.name, { concurrency: false, timeout: 45_000 }, async () => {
      const output = await runCase(sourceCase);

      assert.equal(output.setup.selectedMode, sourceCase.mode, "source selection must set the expected mode");
      assert.equal(output.setup.selectedRoute, "a", "the integration path must use the rendered-report route");
      assert.equal(output.setup.routeVisible, true, "the file-input route must be visible before reading");
      assert.equal(output.selectedFile.count, 1, "the browser must receive exactly one synthetic file");
      assert.equal(output.selectedFile.name, sourceCase.fileName);

      assert.equal(output.report.mode, sourceCase.mode);
      assert.equal(output.report.kind, sourceCase.expectedKind);
      for (const [key, value] of Object.entries(sourceCase.expectedFlags)) {
        assert.equal(output.report[key], value, `${sourceCase.name}: unexpected ${key}`);
      }
      assert.equal(output.report.routeVisible, true);
      assert.equal(output.report.reportVisible, true, "the generated report must be visibly rendered");
      assert.equal(output.report.progressVisible, true, "completed progress must remain visible");
      assert.equal(output.report.progressPercent, "100%");
      assert.equal(output.report.progressAriaNow, "100");
      assert.match(output.report.status, /Report ready from 1 file opened only on this device\./i);
      assert.equal(output.report.error, "");

      for (const [field, pattern] of sourceCase.evidence) {
        assert.match(output.report[field], pattern, `${sourceCase.name}: missing ${field} evidence`);
      }

      if (sourceCase.mode === "codex") {
        assert.equal(output.report.pilotApiEquivalent, "$0.0013");
        assert.equal(output.report.pilotApiMetricHidden, false);
        assert.equal(output.report.pilotMetricsHaveApiEquivalent, true);
        assert.equal(output.report.pilotMetricWidths.length, 4,
          "Codex must render four visible headline metrics");
        assert.ok(Math.max(...output.report.pilotMetricWidths) - Math.min(...output.report.pilotMetricWidths) < 1,
          "the four Codex headline metrics must have equal visual width");
      }

      assert.deepEqual(output.runtimeErrors, [], "the browser page must raise no runtime errors");
      assert.deepEqual(output.consoleErrors, [], "the browser page must log no console errors");
      assert.ok(output.pageRequests.length >= 1, "the browser must record the local analyzer navigation");
      for (const url of output.pageRequests) {
        const protocol = new URL(url).protocol;
        assert.ok(protocol === "file:" || protocol === "data:", `analyzer attempted a non-local request: ${url}`);
      }
    });
  }
}

if (require.main === module || path.resolve(process.argv[1] || "") === path.resolve(__filename)) {
  registerSevenSourceTests();
}

module.exports = { runCase };
