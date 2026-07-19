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
const WAIT_STEP_MS = 50;
const WAIT_ATTEMPTS = 300;

if (typeof WebSocket !== "function") {
  throw new Error("This browser test requires Node.js 22 or newer for its built-in WebSocket client");
}

function jsonLine(value) {
  return JSON.stringify(value);
}

const CASES = [
  {
    name: "Claude Code file input reaches the rendered local report",
    mode: "cc",
    fileName: "synthetic-claude-code.jsonl",
    content: jsonLine({
      type: "assistant",
      sessionId: "synthetic-session-claude-code",
      timestamp: "2026-07-19T10:00:00Z",
      requestId: "synthetic-request-claude-code",
      message: {
        id: "synthetic-message-claude-code",
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 30,
        },
      },
    }),
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
    content: JSON.stringify([{
      uuid: "synthetic-claude-chat-conversation",
      name: "Synthetic Claude Chat conversation",
      chat_messages: [
        { sender: "human", text: "12345678" },
        { sender: "assistant", text: "123456789012" },
      ],
    }]),
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
    content: JSON.stringify([{
      id: "synthetic-chatgpt-conversation",
      title: "Synthetic ChatGPT conversation",
      create_time: 1784455200,
      default_model_slug: "gpt-5.6-sol",
      mapping: {
        root: { id: "root", parent: null, children: ["user"], message: null },
        user: {
          id: "user",
          parent: "root",
          children: ["assistant"],
          message: {
            author: { role: "user" },
            create_time: 1784455200,
            content: { content_type: "text", parts: ["12345678"] },
          },
        },
        assistant: {
          id: "assistant",
          parent: "user",
          children: [],
          message: {
            author: { role: "assistant" },
            create_time: 1784455260,
            content: { content_type: "text", parts: ["123456789012"] },
            metadata: { model_slug: "gpt-5.6-sol" },
          },
        },
      },
    }]),
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
    content: [
      jsonLine({
        timestamp: "2026-07-19T11:00:00Z",
        type: "turn_context",
        payload: { model: "gpt-5.6-sol" },
      }),
      jsonLine({
        timestamp: "2026-07-19T11:00:01Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 20,
              output_tokens: 30,
              reasoning_output_tokens: 5,
              total_tokens: 130,
            },
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 20,
              output_tokens: 30,
              reasoning_output_tokens: 5,
              total_tokens: 130,
            },
          },
        },
      }),
    ].join("\n"),
    expectedKind: "Codex local session logs",
    expectedFlags: { codex: true, cursor: false, copilot: false, chatProvider: "", topSource: "" },
    evidence: [
      ["reportScope", /recorded token counters found in the selected Codex files/i],
      ["cards", /130 tokens/i],
      ["cards", /Not in these files/i],
      ["modelTable", /gpt-5\.6-sol/i],
      ["modelTable", /Not in files/i],
      ["summary", /Where this came from: Codex local session logs\./i],
      ["summary", /Total AI usage: 130 tokens\./i],
    ],
  },
  {
    name: "Cursor usage CSV reaches the rendered local report",
    mode: "cursor",
    fileName: "synthetic-cursor-usage.csv",
    content: [
      "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost",
      "2026-07-19T12:00:00.000Z,On-Demand,claude-4.5-sonnet,No,120,100,30,20,170,1.25",
    ].join("\n"),
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
    content: [
      "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost",
      "2026-07-19T12:30:00.000Z,On-Demand,composer-1,No,120,100,30,20,170,0.05",
    ].join("\n"),
    expectedKind: "Cursor usage CSV",
    expectedFlags: { codex: false, cursor: true, copilot: false, chatProvider: "", topSource: "cursor" },
    evidence: [
      ["reportScope", /rows found in the selected Cursor usage export/i],
      ["cards", /Cost as billed by Cursor/i],
      ["cards", /\$0\.05/i],
      ["cards", /170 tokens/i],
      ["modelTable", /composer-1/i],
      ["cursorBreakdown", /Composer, Cursor's own agent model: 170 tokens/i],
      ["summary", /Composer, Cursor's own agent model: 170 tokens, 1 usage events, recorded cost \$0\.05\./i],
    ],
  },
  {
    name: "GitHub Copilot usage CSV reaches the rendered metering report",
    mode: "copilot",
    fileName: "synthetic-github-copilot-usage.csv",
    content: [
      "date,product,sku,quantity,unit_type,applied_cost_per_quantity,gross_amount,discount_amount,net_amount,organization,cost_center_name,model,username",
      "2026-07-19,copilot,copilot_premium_request,12,requests,0.04,0.48,0.08,0.40,synthetic-org,synthetic-center,Claude Sonnet 4.5,synthetic-user",
      "2026-07-19,copilot,copilot_ai_credit,25,ai-credits,0.01,0.25,0,0.25,synthetic-org,synthetic-center,Claude Sonnet 4.5,synthetic-user",
    ].join("\n"),
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
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
  const fixturePath = path.join(temporaryRoot, sourceCase.fileName);
  fs.writeFileSync(fixturePath, sourceCase.content, "utf8");

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
    await removeTemporaryTree(temporaryRoot);
  }
}

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

    assert.deepEqual(output.runtimeErrors, [], "the browser page must raise no runtime errors");
    assert.deepEqual(output.consoleErrors, [], "the browser page must log no console errors");
    assert.ok(output.pageRequests.length >= 1, "the browser must record the local analyzer navigation");
    for (const url of output.pageRequests) {
      const protocol = new URL(url).protocol;
      assert.ok(protocol === "file:" || protocol === "data:", `analyzer attempted a non-local request: ${url}`);
    }
  });
}
