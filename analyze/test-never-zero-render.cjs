const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function makeElement() {
  return {
    hidden: false,
    textContent: "",
    innerHTML: "",
    value: "",
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild() {},
    closest() { return null; },
    focus() {},
    getAttribute() { return null; },
    removeAttribute() {},
    scrollIntoView() {},
    setAttribute() {},
  };
}

const elements = new Proxy(Object.create(null), {
  get(target, key) {
    if (!target[key]) target[key] = makeElement();
    return target[key];
  },
});

const document = {
  documentElement: makeElement(),
  addEventListener() {},
  createElement: makeElement,
  createElementNS: makeElement,
  getElementById(id) { return elements[id]; },
  querySelector() { return elements.__query; },
  querySelectorAll() { return []; },
};

const context = {
  Array,
  Date,
  Intl,
  JSON,
  Map,
  Math,
  Number,
  Object,
  RegExp,
  Set,
  String,
  URL,
  clearTimeout() {},
  console,
  document,
  isNaN,
  navigator: {},
  parseFloat,
  parseInt,
  setTimeout() {},
  window: {
    addEventListener() {},
    location: { hash: "" },
  },
};

context.LAST_RESULT = null;
context.PILOT_MODE = false;
context.lastSummary = "";
vm.createContext(context);

function loadSlice(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `could not locate ${startMarker} through ${endMarker}`);
  vm.runInContext(html.slice(start, end), context, { filename: "analyze/index.html" });
}

// Load the real pricing, parser, render-helper, and render code. No browser or network API is used.
loadSlice("var PRICING_CHECKED=", "// value-model state");
loadSlice("function createClaudeCodeAccumulator", "function splitCSV");
loadSlice("function splitCSV", "function estTokens");
loadSlice("function estTokens", "// ---------- render ----------");
loadSlice("function resolveCostRow", "function pilotMonthLabel");
loadSlice("function pilotMonthLabel", "function render(res)");
loadSlice("function render(res)", "// ---------- your value model");

// Keep the harness on the standard report path. These functions do not affect the cost cells under test.
context.PILOT_MODE = false;
context.renderValueModel = () => {};
context.revealStandardPostReport = () => {};

function resetElements() {
  for (const element of Object.values(elements)) {
    element.hidden = false;
    element.textContent = "";
    element.innerHTML = "";
    element.value = "";
    element.style = {};
  }
}

function plainText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function firstModelCost(table) {
  const body = /<tbody>([\s\S]*?)<\/tbody>/i.exec(table);
  assert.ok(body, "rendered model table must have a body");
  const row = /<tr>([\s\S]*?)<\/tr>/i.exec(body[1]);
  assert.ok(row, "rendered model table must have a model row");
  const cells = Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi));
  assert.ok(cells.length, "rendered model row must have cells");
  return plainText(cells[cells.length - 1][1]);
}

function renderResult(result) {
  resetElements();
  context.render(result);
  const surfaces = {
    cards: elements.cards.innerHTML,
    modelTable: elements.modeltable.innerHTML,
    summary: elements.summary.value,
    cursorBreakdown: elements.cursorBreakdown.textContent,
    copilotBreakdown: elements.copilotBreakdown.textContent,
    includedUsage: elements.includedUsage.textContent,
    tokenHelp: elements.tokenhelp.textContent,
  };
  return {
    cost: firstModelCost(surfaces.modelTable),
    surfaces,
    summary: surfaces.summary,
    table: surfaces.modelTable,
    tokenHelp: surfaces.tokenHelp,
  };
}

function assertNeverZeroContract(rendered) {
  const failures = [];
  if (!/^unpriced$/i.test(rendered.cost)) {
    failures.push(`model cost must be exactly "unpriced" (case-insensitive), received "${rendered.cost}"`);
  }
  if (!/\bunpriced\b/i.test(rendered.summary)) {
    failures.push('the user-visible summary must identify the unknown cost as "unpriced"');
  }
  const zeroSurfaces = Object.entries(rendered.surfaces)
    .filter(([, value]) => /\$0\.00(?!\d)/.test(String(value)))
    .map(([name]) => name);
  if (zeroSurfaces.length) failures.push(`$0.00 appeared in user-visible surfaces: ${zeroSurfaces.join(", ")}`);
  assert.equal(failures.length, 0, failures.join("\n"));
}

function claudeCodeResult() {
  const record = {
    type: "assistant",
    sessionId: "session-1",
    timestamp: "2026-07-19T00:00:00Z",
    message: {
      id: "message-1",
      model: "claude-opus-9-9",
      usage: {
        input_tokens: 8,
        output_tokens: 12,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 4,
      },
    },
  };
  return context.parseClaudeCode([JSON.stringify(record)]);
}

function claudeChatResult() {
  return context.parseChat([JSON.stringify([{
    uuid: "conversation-1",
    chat_messages: [
      { sender: "human", text: "12345678" },
      { sender: "assistant", text: "123456789012" },
    ],
  }])]);
}

function chatGptResult() {
  return context.parseOpenAI([JSON.stringify([{
    id: "conversation-1",
    default_model_slug: "gpt-9.9-future",
    mapping: {
      user: {
        message: {
          author: { role: "user" },
          content: { parts: ["12345678"] },
        },
      },
      assistant: {
        message: {
          author: { role: "assistant" },
          content: { parts: ["123456789012"] },
          metadata: { model_slug: "gpt-9.9-future" },
        },
      },
    },
  }])]);
}

function codexResult() {
  const usage = {
    input_tokens: 8,
    cached_input_tokens: 2,
    output_tokens: 12,
    reasoning_output_tokens: 3,
    total_tokens: 20,
  };
  return context.parseCodex([[
    JSON.stringify({
      timestamp: "2026-07-19T00:00:00Z",
      type: "turn_context",
      payload: { model: "codex-future-9" },
    }),
    JSON.stringify({
      timestamp: "2026-07-19T00:00:01Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: usage, last_token_usage: usage },
      },
    }),
  ].join("\n")]);
}

const CURSOR_HEADER = "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";

function cursorResult(model) {
  return context.parseCursor([[
    CURSOR_HEADER,
    `2026-07-19T00:00:00Z,On-Demand,${model},No,10,8,4,12,26,`,
  ].join("\n")]);
}

function copilotResult() {
  const header = [
    "date", "product", "sku", "quantity", "unit_type", "applied_cost_per_quantity",
    "gross_amount", "discount_amount", "net_amount", "organization", "cost_center_name",
    "model", "username",
  ].join(",");
  const premiumRequest = [
    "2026-07-19", "copilot", "copilot_premium_request", "2", "requests", "", "", "", "",
    "org", "cost-center", "Gemini 9.9 Pro", "user",
  ].join(",");
  const aiCredits = [
    "2026-07-19", "copilot", "copilot_ai_credit", "3", "ai-credits", "", "", "", "",
    "org", "cost-center", "Gemini 9.9 Pro", "user",
  ].join(",");
  return context.parseCopilot([[header, premiumRequest, aiCredits].join("\n")]);
}

test("Claude Code never-zero render contract", () => {
  const rendered = renderResult(claudeCodeResult());
  assert.match(rendered.summary, /Total AI usage: 26 tokens\./);
  assert.match(rendered.summary, /8 sent, 12 returned, 2 cache added, 4 cache reused/);
  assertNeverZeroContract(rendered);
});

test("Claude Chat never-zero render contract", () => {
  const rendered = renderResult(claudeChatResult());
  assert.match(rendered.summary, /Rough text-only estimate from selected file: about 5 tokens\./);
  assert.match(rendered.summary, /about 2 sent, about 3 returned/);
  assertNeverZeroContract(rendered);
});

test("ChatGPT never-zero render contract", () => {
  const rendered = renderResult(chatGptResult());
  assert.match(rendered.summary, /Rough text-only estimate from selected file: about 5 tokens\./);
  assert.match(rendered.summary, /about 2 sent, about 3 returned/);
  assertNeverZeroContract(rendered);
});

test("Codex never-zero render contract", () => {
  const rendered = renderResult(codexResult());
  assert.match(rendered.summary, /Total AI usage: 20 tokens\./);
  assert.match(rendered.summary, /6 sent, 12 returned, 0 cache added, 2 cache reused/);
  assertNeverZeroContract(rendered);
});

test("Cursor never-zero render contract", () => {
  const rendered = renderResult(cursorResult("gemini-9.9-pro"));
  assert.match(rendered.summary, /Total AI usage: 26 tokens\./);
  assert.match(rendered.summary, /8 sent, 12 returned, 2 cache added, 4 cache reused/);
  assertNeverZeroContract(rendered);
});

test("Cursor Composer never-zero render contract", () => {
  const rendered = renderResult(cursorResult("composer-9.9"));
  assert.match(rendered.summary, /Total AI usage: 26 tokens\./);
  assert.match(rendered.summary, /8 sent, 12 returned, 2 cache added, 4 cache reused/);
  assertNeverZeroContract(rendered);
});

test("GitHub Copilot never-zero render contract", () => {
  const rendered = renderResult(copilotResult());
  assert.match(rendered.table, /<th>Premium requests<\/th><th>AI credits<\/th>/);
  assert.match(rendered.summary, /Premium requests recorded: 2\./);
  assert.match(rendered.summary, /AI credits recorded: 3\./);
  // Copilot exports expose metered requests and credits, not tokens. Keep that limitation visible.
  assert.match(rendered.tokenHelp, /not tokens[\s\S]*instead of token counts/i);
  assert.doesNotMatch(rendered.table, /text sent to the AI|text returned by the AI/i);
  assertNeverZeroContract(rendered);
});
