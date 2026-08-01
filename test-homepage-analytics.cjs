"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const analyzerHtml = fs.readFileSync(new URL("analyze/index.html", `file://${__dirname}/`), "utf8");
const dashboardHtml = fs.readFileSync(new URL("dashboard/index.html", `file://${__dirname}/`), "utf8");
const dashboardWorker = fs.readFileSync(new URL("dashboard/sw.js", `file://${__dirname}/`), "utf8");
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1]);
const signalSource = inlineScripts.find((source) => source.includes("initHomepageLoadSignal"));
const goatCounterSource = inlineScripts.find((source) => source.includes("initGoatCounterReloadTracking"));

assert.ok(signalSource, "the homepage load-signal script should exist");
assert.ok(goatCounterSource, "the manual GoatCounter reload script should exist");

function runSignal({ origin = "https://tokenoptimisationprotocol.org", fetchImpl } = {}) {
  const calls = [];
  const request = fetchImpl || ((url, options) => {
    calls.push({
      options: JSON.parse(JSON.stringify(options)),
      url,
    });
    return Promise.resolve({ ok: true });
  });
  const window = {
    fetch: request,
    location: { origin },
  };
  vm.runInNewContext(signalSource, { window }, { filename: "homepage-load-signal.js" });
  return calls;
}

function runGoatCounterLoad() {
  const listeners = {};
  const calls = [];
  const window = {
    addEventListener(type, listener, options) {
      listeners[type] = { listener, options };
    },
  };
  vm.runInNewContext(goatCounterSource, { window }, { filename: "goatcounter-reload-tracking.js" });
  const settings = JSON.parse(JSON.stringify(window.goatcounter));
  window.goatcounter.count = (options) => calls.push(JSON.parse(JSON.stringify(options)));
  listeners.DOMContentLoaded.listener();
  return { calls, listeners, settings };
}

test("homepage analytics scripts parse and only GoatCounter is loaded externally", () => {
  for (const [index, source] of inlineScripts.entries()) {
    assert.doesNotThrow(() => new vm.Script(source), `inline script ${index + 1} should parse`);
  }

  const external = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
  assert.equal(external.length, 1);
  assert.equal(external[0][1], "https://gc.zgo.at/count.v5.js");
  assert.match(external[0][0], /data-goatcounter="https:\/\/adamhartley7\.goatcounter\.com\/count"/);
  assert.match(external[0][0], /data-goatcounter-settings='\{"no_onload":true,"no_events":true\}'/);
  assert.match(external[0][0], /\bdefer\b/);
  assert.match(external[0][0], /crossorigin="anonymous"/);
  assert.match(external[0][0], /integrity="sha384-atnOLvQb9t\+jTSipvd75X2yginT4PjVbqDdlJAmxMm\+wYElFmeR6EmLP5bYeoRVQ"/);
});

test("GoatCounter manually counts every fresh root document with sessions disabled", () => {
  const first = runGoatCounterLoad();
  assert.deepEqual(first.settings, { no_onload: true, no_events: true });
  assert.deepEqual(first.calls, [{
    path: "/",
    title: "TOP | Token Optimisation Protocol",
    no_session: true,
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(first.listeners.DOMContentLoaded.options)), { once: true });

  const reload = runGoatCounterLoad();
  assert.equal(reload.calls.length, 1,
    "a reload creates a fresh document and should issue a fresh no-session count");
});

test("each production document load sends one fixed privacy-minimal notification signal", () => {
  const calls = runSignal();
  assert.deepEqual(calls, [{
    url: "https://events.tokenoptimisationprotocol.org/v1/homepage-view",
    options: {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      keepalive: true,
    },
  }]);

  const secondDocument = runSignal();
  assert.equal(secondDocument.length, 1,
    "a fresh document created by reloading should send another signal");
  assert.equal(new URL(calls[0].url).search, "");
  assert.equal(Object.hasOwn(calls[0].options, "body"), false);
  assert.equal(Object.hasOwn(calls[0].options, "headers"), false);
  assert.doesNotMatch(JSON.stringify(calls), /pathname|search|hash|title|user.?agent|screen|cookie/i);
});

test("preview and local origins never send production notifications", () => {
  for (const origin of [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://adamhartley7.github.io",
    "https://example.com",
  ]) {
    assert.equal(runSignal({ origin }).length, 0, `${origin} should stay silent`);
  }
});

test("notification failure never blocks or breaks the homepage", async () => {
  assert.doesNotThrow(() => runSignal({ fetchImpl() { throw new Error("offline"); } }));

  let rejectionHandled = false;
  assert.doesNotThrow(() => runSignal({
    fetchImpl() {
      return {
        catch(handler) {
          rejectionHandled = true;
          handler(new Error("rejected"));
        },
      };
    },
  }));
  assert.equal(rejectionHandled, true);
});

test("the root CSP allows only the two approved analytics endpoints", () => {
  const csp = /<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/i.exec(html);
  assert.ok(csp, "root homepage should declare a CSP");
  assert.match(csp[1], /script-src 'self' 'unsafe-inline' https:\/\/gc\.zgo\.at/);
  assert.match(csp[1], /connect-src https:\/\/adamhartley7\.goatcounter\.com https:\/\/events\.tokenoptimisationprotocol\.org/);
  assert.match(csp[1], /object-src 'none'/);
  assert.match(csp[1], /base-uri 'none'/);
  assert.doesNotMatch(csp[1], /\*/);
});

test("tracking disclosure is explicit and private local tools remain uninstrumented", () => {
  assert.match(html, /counts every load, including reloads, with GoatCounter and uses no visitor cookies or browser storage/i);
  assert.match(html, /generic load signal through Cloudflare for an ntfy alert/i);
  assert.match(html, /contains no page contents, referrer, query string or file data/i);

  assert.doesNotMatch(analyzerHtml, /goatcounter|events\.tokenoptimisationprotocol\.org|initHomepageLoadSignal/i);
  assert.match(analyzerHtml, /connect-src 'none'/i,
    "the local analyzer must keep its no-network boundary");
});

test("the public dashboard exposes no ntfy destination and does not claim the analyzer is tracked", () => {
  assert.doesNotMatch(dashboardHtml, /https:\/\/ntfy\.sh\/|subscribe to topic/i);
  assert.match(dashboardHtml, /homepage loads, including reloads; analyzer excluded/i);
  assert.match(dashboardHtml, /Homepage alerts use private ntfy routing/i);
  assert.match(dashboardWorker, /top-dash-v2/,
    "the dashboard cache must rotate after removing the exposed destination");
});
