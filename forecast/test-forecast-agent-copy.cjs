"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1]).join("\n");
const start = script.indexOf('document.getElementById("copyagent").addEventListener');
const end = script.indexOf('document.getElementById("copybtn")', start);
assert.ok(start >= 0 && end > start, "agent-prompt copy handler must remain independently testable");
const source = script.slice(start, end);

function makeHarness({ clipboard = "missing", execCopy = true, secure = true } = {}) {
  const calls = { writes: [], exec: 0, selected: false };
  let clickHandler;
  const document = { activeElement: null };
  const prompt = {
    textContent: "SAFE AGENT PROMPT",
    focus() { document.activeElement = prompt; },
  };
  const button = {
    textContent: "Copy agent prompt",
    addEventListener(type, handler) {
      assert.equal(type, "click");
      clickHandler = handler;
    },
    focus() { document.activeElement = button; },
  };
  const status = { textContent: "Copies only the prompt shown above." };
  const elements = { agentcmd: prompt, copyagent: button, "agentcopy-status": status };
  document.getElementById = (id) => elements[id] || null;
  document.createRange = () => ({ selectNodeContents(node) { assert.equal(node, prompt); } });
  document.execCommand = (command) => {
    calls.exec += 1;
    assert.equal(command, "copy");
    return execCopy;
  };

  const selection = {
    removeAllRanges() {},
    addRange() { calls.selected = true; },
  };
  const navigator = {};
  if (clipboard === "partial") navigator.clipboard = {};
  if (clipboard === "success") {
    navigator.clipboard = {
      writeText(value) { calls.writes.push(value); return Promise.resolve(); },
    };
  }
  if (clipboard === "reject") {
    navigator.clipboard = {
      writeText(value) { calls.writes.push(value); return Promise.reject(new Error("denied")); },
    };
  }

  vm.runInNewContext(source, {
    document,
    navigator,
    window: { isSecureContext: secure, getSelection: () => selection },
    setTimeout() { return 1; },
  }, { filename: "forecast-agent-copy.js" });
  return { button, prompt, status, document, calls, clickHandler };
}

async function activate(harness) {
  harness.button.focus();
  harness.clickHandler.call(harness.button);
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  const native = makeHarness({ clipboard: "success" });
  await activate(native);
  assert.deepEqual(native.calls.writes, ["SAFE AGENT PROMPT"]);
  assert.equal(native.calls.exec, 0);
  assert.equal(native.button.textContent, "Agent prompt copied");
  assert.match(native.status.textContent, /^Copied\./);
  assert.equal(native.document.activeElement, native.button);

  const partial = makeHarness({ clipboard: "partial", execCopy: true });
  await activate(partial);
  assert.equal(partial.calls.exec, 1);
  assert.equal(partial.calls.selected, true);
  assert.equal(partial.button.textContent, "Agent prompt copied");
  assert.equal(partial.document.activeElement, partial.button);

  const rejected = makeHarness({ clipboard: "reject", execCopy: false });
  await activate(rejected);
  assert.deepEqual(rejected.calls.writes, ["SAFE AGENT PROMPT"]);
  assert.equal(rejected.calls.exec, 1);
  assert.equal(rejected.calls.selected, true);
  assert.equal(rejected.document.activeElement, rejected.prompt);
  assert.match(rejected.status.textContent, /^Automatic copy was blocked\./);
  assert.equal(rejected.button.textContent, "Copy agent prompt");

  const insecure = makeHarness({ clipboard: "success", execCopy: true, secure: false });
  await activate(insecure);
  assert.deepEqual(insecure.calls.writes, []);
  assert.equal(insecure.calls.exec, 1);

  console.log("TOP forecast agent-prompt copy runtime branch tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
