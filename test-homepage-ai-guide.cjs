const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const scriptStart = html.indexOf("(function initTopExplainer");
const scriptEnd = html.indexOf("})();", scriptStart);
assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "explainer script must exist");
const explainerSource = html.slice(scriptStart, scriptEnd + 5);

function makeHarness({ clipboard = "missing", execCopy = true, secure = true } = {}) {
  const listeners = {};
  const classes = new Set();
  const calls = { execCopy: 0, writeText: [] };

  const document = {
    activeElement: null,
    body: {
      appendChild(field) {
        field.parentNode = this;
      },
    },
    execCommand(command) {
      calls.execCopy += 1;
      assert.equal(command, "copy");
      return execCopy;
    },
    createElement(tagName) {
      assert.equal(tagName, "textarea");
      const field = {
        value: "",
        style: {},
        setAttribute() {},
        select() {
          this.selected = true;
          document.activeElement = this;
        },
        remove() {
          if (document.activeElement === this) document.activeElement = document.body;
        },
      };
      return field;
    },
    getElementById(id) {
      return elements[id] || null;
    },
  };

  const button = {
    textContent: "Copy explainer prompt",
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    addEventListener(type, handler) { listeners[type] = handler; },
    focus() { document.activeElement = button; },
  };
  const prompt = {
    value: "  public prompt text\n  ",
    selected: false,
    focus() { document.activeElement = prompt; },
    select() { prompt.selected = true; },
  };
  const status = { textContent: "Copies visible text only." };
  const details = { open: false };
  const elements = {
    copyTopExplainer: button,
    topExplainerPrompt: prompt,
    topExplainerStatus: status,
    topExplainerDetails: details,
  };

  const navigator = {};
  if (clipboard === "partial") navigator.clipboard = {};
  if (clipboard === "success") {
    navigator.clipboard = {
      writeText(text) {
        calls.writeText.push(text);
        return Promise.resolve();
      },
    };
  }
  if (clipboard === "reject") {
    navigator.clipboard = {
      writeText(text) {
        calls.writeText.push(text);
        return Promise.reject(new Error("simulated denial"));
      },
    };
  }

  vm.runInNewContext(explainerSource, {
    document,
    navigator,
    window: { isSecureContext: secure },
    Promise,
    clearTimeout() {},
    setTimeout() { return 1; },
  }, { filename: "top-explainer-inline.js" });

  return { button, prompt, status, details, document, listeners, calls };
}

async function activate(harness) {
  harness.button.focus();
  assert.equal(typeof harness.listeners.click, "function", "copy button must have a click handler");
  harness.listeners.click();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  const native = makeHarness({ clipboard: "success" });
  await activate(native);
  assert.deepEqual(native.calls.writeText, ["public prompt text"]);
  assert.equal(native.calls.execCopy, 0);
  assert.equal(native.button.textContent, "Prompt copied");
  assert.equal(native.button.classList.contains("copied"), true);
  assert.match(native.status.textContent, /^Copied\./);
  assert.equal(native.document.activeElement, native.button);

  const partial = makeHarness({ clipboard: "partial", execCopy: true });
  await activate(partial);
  assert.equal(partial.calls.execCopy, 1,
    "a partial Clipboard API must fall back instead of throwing");
  assert.equal(partial.button.textContent, "Prompt copied");
  assert.equal(partial.document.activeElement, partial.button,
    "successful fallback must restore focus to the invoking button");

  const rejected = makeHarness({ clipboard: "reject", execCopy: true });
  await activate(rejected);
  assert.equal(rejected.calls.writeText.length, 1);
  assert.equal(rejected.calls.execCopy, 1);
  assert.equal(rejected.button.textContent, "Prompt copied");
  assert.equal(rejected.document.activeElement, rejected.button);

  const manual = makeHarness({ clipboard: "reject", execCopy: false });
  await activate(manual);
  assert.equal(manual.details.open, true);
  assert.equal(manual.prompt.selected, true);
  assert.equal(manual.document.activeElement, manual.prompt);
  assert.match(manual.status.textContent, /^Automatic copy was blocked\./);
  assert.equal(manual.button.textContent, "Copy explainer prompt",
    "manual fallback must not claim that copying succeeded");

  const insecure = makeHarness({ clipboard: "success", execCopy: true, secure: false });
  await activate(insecure);
  assert.deepEqual(insecure.calls.writeText, [],
    "an insecure context must not call the asynchronous Clipboard API");
  assert.equal(insecure.calls.execCopy, 1);
  assert.equal(insecure.document.activeElement, insecure.button);

  console.log("TOP homepage AI-guide runtime branch tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
