"use strict";

/*
 * Reproducibility gate for the shipped browser path, not an accuracy test.
 * It loads /forecast from file:// in a fresh Chromium profile, blocks page
 * network APIs and non-file requests, feeds generated .jsonl files through
 * the individual-file input and FileReader path in a 320px viewport, and
 * repeats three times. A valid synthetic .txt decoy must be filtered out.
 *
 * Deliberate limits: Chromium only; no OS dialog, folder picker or drop
 * traversal; one generic "misc" archetype; tiny synthetic chronology; no
 * real user data.
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");

const RUNS = 3;
const PAGE_PATH = path.join(__dirname, "index.html");
const EXPECTED_CORE = {
  layout: { inner_width: 320, no_horizontal_overflow: true },
  sessions_seen: 33,
  priced_sessions_used: 32,
  split: { fit: 19, calibration: 7, test: 6 },
  // hits 0 of 6 held-out tasks. The page shows that count and states no coverage rate, because
  // six held-out tasks cannot support one. coverage_pct is the internal statistic, read straight
  // off BT.stats and never rendered as a claim.
  task_only_backtest: {
    hits: 0,
    coverage_pct: 0,
    median_relative_error_pct: 54.439844458083
  },
  turn_count_backtest: {
    hits: 0,
    coverage_pct: 0,
    median_relative_error_pct: 54.439844458083
  },
  task_only_quote_usd: {
    p10: 0.004848828292,
    p50: 0.010110795261,
    p90: 0.021083068868
  },
  turn_count_quote_usd: {
    p10: 0.014546484877,
    p50: 0.030332385784,
    p90: 0.063249206604
  }
};

function browserPath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome or Edge is required (or set CHROME_PATH)");
  return found;
}

function makeFixture() {
  const texts = [];
  // 32 priced sessions, deliberately above the 30-completed-task cold-start gate, so this
  // reproducibility run still exercises the path where a band IS emitted. Below the gate the
  // page correctly produces no priors at all, which is covered by the cold-start refusal suite.
  for (let index = 1; index <= 32; index += 1) {
    const id = String(index).padStart(2, "0");
    const sessionId = `synthetic-session-${id}`;
    const project = index % 2 === 0 ? "/synthetic/project-b" : "/synthetic/project-a";
    const base = {
      sessionId,
      cwd: project,
      timestamp: new Date(Date.UTC(2026, 0, 1, 12) + (index - 1) * 86400000).toISOString()
    };
    const rows = [
      {
        ...base,
        type: "user",
        message: { content: `Synthetic fixture task ${id}` }
      },
      {
        ...base,
        type: "assistant",
        requestId: `synthetic-request-${id}`,
        message: {
          id: `synthetic-message-${id}`,
          model: "claude-sonnet-4-5-20260101",
          usage: {
            input_tokens: 800 + index * 75,
            output_tokens: 120 + index * 13,
            cache_creation_input_tokens: index * 20,
            cache_read_input_tokens: index * 110
          }
        }
      }
    ];
    texts.push(rows.map((row) => JSON.stringify(row)).join("\n"));
  }

  // This thirty-third session must remain visible as usage, but must be excluded
  // from cost fitting because its synthetic model has no configured price.
  texts.push([
    JSON.stringify({
      type: "user",
      sessionId: "synthetic-session-unpriced",
      cwd: "/synthetic/project-c",
      timestamp: "2026-02-02T12:00:00.000Z",
      message: { content: "Synthetic fixture task unpriced" }
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "synthetic-session-unpriced",
      cwd: "/synthetic/project-c",
      timestamp: "2026-02-02T12:00:00.000Z",
      requestId: "synthetic-request-unpriced",
      message: {
        id: "synthetic-message-unpriced",
        model: "synthetic-unpriced-model",
        usage: {
          input_tokens: 900,
          output_tokens: 90,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 70
        }
      }
    })
  ].join("\n"));
  return texts;
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
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.setTimeout(1000, () => request.destroy(new Error("CDP endpoint timeout")));
  });
}

async function waitForJson(url, attempts = 80) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await getJson(url); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
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
  }

  on(method, listener) {
    const listeners = this.events.get(method) || [];
    listeners.push(listener);
    this.events.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || "browser evaluation failed";
    throw new Error(detail);
  }
  return result.result.value;
}

async function waitForReady(client) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await evaluate(client,
      "document.readyState === 'complete' && typeof window.Forecaster === 'object' && typeof window.run === 'function'");
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("forecast page did not become ready");
}

async function waitForFixture(client) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await evaluate(client,
      "typeof SESSIONS !== 'undefined' && Array.isArray(SESSIONS) && SESSIONS.length === 33 && BT && BT.ok === true");
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("forecast fixture did not finish through the file-input path");
}

async function stopBrowser(browser) {
  if (browser.exitCode !== null) return;
  const exited = new Promise((resolve) => browser.once("exit", resolve));
  browser.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 2000))
  ]);
  if (browser.exitCode === null) {
    browser.kill("SIGKILL");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
  }
}

async function removeProfile(profile) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      return;
    } catch (error) {
      lastError = error;
      if (!error || !["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error(`Could not remove browser profile ${profile}`);
}

async function runOnce(runNumber, texts) {
  const port = await getFreePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `top-forecast-browser-${runNumber}-`));
  const fixturePaths = [
    path.join(profile, "synthetic-part-a.jsonl"),
    path.join(profile, "synthetic-part-b.jsonl")
  ];
  fs.writeFileSync(fixturePaths[0], texts.slice(0, 7).join("\n"), "utf8");
  fs.writeFileSync(fixturePaths[1], texts.slice(7).join("\n"), "utf8");
  const decoyPath = path.join(profile, "synthetic-ignore.txt");
  fs.writeFileSync(decoyPath, [
    JSON.stringify({
      type: "user",
      sessionId: "synthetic-session-decoy",
      cwd: "/synthetic/project-decoy",
      timestamp: "2026-01-14T12:00:00.000Z",
      message: { content: "This valid record must be ignored because its file is not .jsonl" }
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "synthetic-session-decoy",
      cwd: "/synthetic/project-decoy",
      timestamp: "2026-01-14T12:00:00.000Z",
      requestId: "synthetic-request-decoy",
      message: {
        id: "synthetic-message-decoy",
        model: "claude-sonnet-4-5-20260101",
        usage: { input_tokens: 999999, output_tokens: 999999 }
      }
    })
  ].join("\n"), "utf8");
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
    "about:blank"
  ], { stdio: "ignore", windowsHide: true });

  let client;
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("headless browser created no page target");
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.open();

    const requests = [];
    const pageErrors = [];
    client.on("Network.requestWillBeSent", ({ request }) => requests.push(request.url));
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      pageErrors.push(exceptionDetails.exception?.description || exceptionDetails.text);
    });

    await client.send("Network.enable");
    await client.send("Network.setBlockedURLs", {
      urls: ["http://*", "https://*", "ws://*", "wss://*"]
    });
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 320,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        globalThis.fetch = function () { throw new Error("fixture blocks fetch"); };
        globalThis.XMLHttpRequest = function () { throw new Error("fixture blocks XMLHttpRequest"); };
        globalThis.WebSocket = function () { throw new Error("fixture blocks WebSocket"); };
        if (globalThis.navigator) {
          Object.defineProperty(globalThis.navigator, "sendBeacon", {
            configurable: true,
            value: function () { throw new Error("fixture blocks sendBeacon"); }
          });
        }
      `
    });

    const navigation = await client.send("Page.navigate", { url: pathToFileURL(PAGE_PATH).href });
    assert.equal(navigation.errorText, undefined, "the local forecast page must load");
    await waitForReady(client);

    await client.send("DOM.enable");
    const { root } = await client.send("DOM.getDocument", { depth: -1 });
    const { nodeId: fileInputNodeId } = await client.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#file"
    });
    assert.ok(fileInputNodeId, "the individual .jsonl file input must exist");
    await client.send("DOM.setFileInputFiles", {
      nodeId: fileInputNodeId,
      files: [...fixturePaths, decoyPath]
    });
    const selectedFileCount = await evaluate(client, `(() => {
      const input = document.getElementById("file");
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return input.files.length;
    })()`);
    assert.equal(selectedFileCount, 3,
      "the browser fixture must present two .jsonl files and one non-.jsonl decoy");
    await waitForFixture(client);

    const browserResult = await evaluate(client, `(() => {
      document.getElementById("qdesc").value = "Synthetic fixture next task";
      document.getElementById("qproj").value = "/synthetic/project-a";
      document.getElementById("qturns").value = "3";
      document.getElementById("qbtn").click();

      const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const round = (value) => Number(value.toFixed(12));
      const taskOnly = Forecaster.forecast({
        archetype: Forecaster.classifyArchetype("Synthetic fixture next task"),
        project: "/synthetic/project-a"
      }, QP, "description");
      const turnCount = Forecaster.forecast({
        archetype: Forecaster.classifyArchetype("Synthetic fixture next task"),
        project: "/synthetic/project-a",
        turn_count: 3
      }, QP, "oracle");

      return {
        layout: {
          inner_width: window.innerWidth,
          no_horizontal_overflow:
            document.documentElement.scrollWidth <= document.documentElement.clientWidth
        },
        sessions_seen: SESSIONS.length,
        priced_sessions_used: BT.usable.length,
        split: { fit: BT.nFit, calibration: BT.nCalib, test: BT.nTest },
        task_only_backtest: {
          hits: BT.stats.description.hits,
          coverage_pct: round(BT.stats.description.coverage),
          median_relative_error_pct: round(BT.stats.description.medErr)
        },
        turn_count_backtest: {
          hits: BT.stats.oracle.hits,
          coverage_pct: round(BT.stats.oracle.coverage),
          median_relative_error_pct: round(BT.stats.oracle.medErr)
        },
        task_only_quote_usd: {
          p10: round(taskOnly.p10), p50: round(taskOnly.p50), p90: round(taskOnly.p90)
        },
        turn_count_quote_usd: {
          p10: round(turnCount.p10), p50: round(turnCount.p50), p90: round(turnCount.p90)
        },
        unpriced_warning: clean(document.getElementById("unpricedwarn").textContent),
        quote_cards: clean(document.getElementById("qcards").textContent),
        quote_note: clean(document.getElementById("qnote").textContent),
        summary_sha256: "PENDING"
      };
    })()`);

    const summary = await evaluate(client, "document.getElementById('summary').value");
    browserResult.summary_sha256 = crypto.createHash("sha256").update(summary).digest("hex");

    assert.equal(pageErrors.length, 0, `run ${runNumber} raised browser errors`);
    assert.equal(browserResult.layout.no_horizontal_overflow, true,
      "the forecast page must not overflow horizontally at 320px");
    assert.ok(requests.length >= 2, "the local HTML and forecaster script must both load");
    assert.ok(requests.every((url) => url.startsWith("file:")),
      `run ${runNumber} attempted a non-file request: ${requests.join(", ")}`);
    assert.equal(browserResult.sessions_seen, 33);
    assert.equal(browserResult.priced_sessions_used, 32,
      "the session with an unknown price must fail closed and stay out of fitting");
    assert.match(browserResult.unpriced_warning, /synthetic-unpriced-model/);
    assert.match(browserResult.unpriced_warning, /excluded from cost/);
    // The band that this run does emit must carry the history behind it, and neither the cards
    // nor the note may put a coverage rate on a six-task held-out split.
    assert.match(browserResult.quote_cards, /Based on 32 completed tasks of your history/,
      "an emitted band must show the history count it was fitted on");
    assert.match(browserResult.quote_cards, /0 of 6 inside the band/,
      "the held-out evidence must travel with the band as a raw count");
    assert.match(browserResult.quote_cards, /too few held-out tasks to state a coverage rate/i,
      "six held-out tasks cannot support a coverage rate and the page must say so");
    assert.doesNotMatch(browserResult.quote_cards, /coverage rate of/i,
      "no coverage rate may be stated from this split");
    for (const quote of [browserResult.task_only_quote_usd, browserResult.turn_count_quote_usd]) {
      assert.ok(Number.isFinite(quote.p10) && Number.isFinite(quote.p50) && Number.isFinite(quote.p90));
      assert.ok(quote.p10 <= quote.p50 && quote.p50 <= quote.p90,
        "forecast bands must remain ordered");
    }

    return {
      ...browserResult,
      local_requests: [...new Set(requests)].map((url) => path.basename(new URL(url).pathname)).sort()
    };
  } finally {
    if (client) {
      try { await client.send("Browser.close"); } catch (error) { /* socket may close before reply */ }
      client.close();
    }
    await stopBrowser(browser);
    await removeProfile(profile);
  }
}

(async () => {
  const texts = makeFixture();
  const outputs = [];
  for (let runNumber = 1; runNumber <= RUNS; runNumber += 1) {
    outputs.push(await runOnce(runNumber, texts));
  }
  assert.deepStrictEqual(outputs[1], outputs[0], "clean browser repeat 2 diverged from repeat 1");
  assert.deepStrictEqual(outputs[2], outputs[0], "clean browser repeat 3 diverged from repeat 1");
  const core = Object.fromEntries(Object.keys(EXPECTED_CORE).map((key) => [key, outputs[0][key]]));
  assert.deepStrictEqual(core, EXPECTED_CORE,
    "the synthetic browser forecast changed from its recorded deterministic baseline");

  const inputRecord = {
    fixture_sha256: crypto.createHash("sha256").update(texts.join("\u0000")).digest("hex"),
    synthetic_sessions: 33,
    priced_sessions: 32,
    unpriced_sessions: 1,
    priced_model: "claude-sonnet-4-5-20260101",
    unpriced_model: "synthetic-unpriced-model",
    projects: ["/synthetic/project-a", "/synthetic/project-b", "/synthetic/project-c"],
    timestamps: ["2026-01-01T12:00:00.000Z", "2026-02-02T12:00:00.000Z"],
    priced_token_formula_by_index_1_to_32: {
      input: "800 + index * 75",
      output: "120 + index * 13",
      cache_creation: "index * 20",
      cache_read: "index * 110"
    },
    quote: {
      description: "Synthetic fixture next task",
      project: "/synthetic/project-a",
      expected_turns: 3
    }
  };
  process.stdout.write(`${JSON.stringify({ input: inputRecord, runs: outputs }, null, 2)}\n`);
  process.stdout.write("TOP forecast local synthetic browser fixture passed 3 identical clean runs\n");
})().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
