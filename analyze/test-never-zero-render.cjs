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

function renderedModelCosts(table) {
  const body = /<tbody>([\s\S]*?)<\/tbody>/i.exec(table);
  assert.ok(body, "rendered model table must have a body");
  const rows = Array.from(body[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)).map((row) => {
    const cells = Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi));
    assert.ok(cells.length >= 2, "each rendered model row must have a model and cost cell");
    return {
      model: plainText(cells[0][1]),
      usageCells: cells.slice(1, -1).map((cell) => plainText(cell[1])),
      cost: plainText(cells[cells.length - 1][1]),
    };
  });
  assert.ok(rows.length > 0, "rendered model table must have at least one model row");
  return rows;
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
    modelCosts: renderedModelCosts(surfaces.modelTable),
    surfaces,
    summary: surfaces.summary,
    table: surfaces.modelTable,
    tokenHelp: surfaces.tokenHelp,
  };
}

function expectedDisplayModel(model) {
  return plainText(context.safePublicModelLabel(model));
}

function hasVisibleUsageEvidence(row) {
  return row.usageCells.some((cell) => Array.from(cell.matchAll(/\d[\d,]*(?:\.\d+)?/g))
    .some((match) => Number(match[0].replace(/,/g, "")) > 0));
}

function neverZeroFailures(rendered, unpricedModels) {
  const failures = [];
  for (const model of unpricedModels) {
    const expected = expectedDisplayModel(model);
    const row = rendered.modelCosts.find((candidate) => candidate.model.toLowerCase() === expected.toLowerCase());
    if (!row) {
      failures.push(`the rendered table omitted unpriceable model "${expected}"`);
    } else {
      if (!/^unpriced$/i.test(row.cost)) {
        failures.push(`${expected} cost must be exactly "unpriced" (case-insensitive), received "${row.cost}"`);
      }
      if (!hasVisibleUsageEvidence(row)) {
        failures.push(`${expected} must retain a visible nonzero usage count when its cost is unpriced`);
      }
    }
  }
  if (!/\bunpriced\b/i.test(rendered.summary)) {
    failures.push('the user-visible summary must identify the unknown cost as "unpriced"');
  }
  const zeroMoneyPatterns = [
    /(?:US\$|\$|USD\s*|&#36;\s*)0(?!\.\d*[1-9]\d*)(?:\.0+)?(?!\d)/i,
    /0(?!\.\d*[1-9]\d*)(?:\.0+)?\s*USD\b/i,
  ];
  const zeroSurfaces = Object.entries(rendered.surfaces)
    .filter(([, value]) => zeroMoneyPatterns.some((pattern) => pattern.test(String(value))))
    .map(([name]) => name);
  if (zeroSurfaces.length) failures.push(`zero money appeared in user-visible surfaces: ${zeroSurfaces.join(", ")}`);
  return failures;
}

function assertNeverZeroContract(rendered, unpricedModels) {
  const failures = neverZeroFailures(rendered, unpricedModels);
  assert.equal(failures.length, 0, failures.join("\n"));
}

function hasPositiveMoney(value) {
  const match = /\$([0-9]+(?:\.[0-9]+)?)/.exec(value);
  return Boolean(match) && Number(match[1]) > 0;
}

function assertModelsHaveNoKnownRate(result) {
  const models = Object.keys(result.by || {});
  assert.ok(models.length > 0, "the synthetic source must expose at least one model row");
  for (const model of models) {
    assert.equal(context.priceKeyFor(model), null,
      `${model} must remain unmatched instead of inheriting a known model rate`);
  }
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

function mixedClaudeCodeResult() {
  const known = {
    type: "assistant",
    sessionId: "session-known",
    timestamp: "2026-07-19T00:00:00Z",
    requestId: "request-known",
    message: {
      id: "message-known",
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 1_000_000,
        output_tokens: 100_000,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
  const unknown = {
    type: "assistant",
    sessionId: "session-unknown",
    timestamp: "2026-07-19T00:01:00Z",
    requestId: "request-unknown",
    message: {
      id: "message-unknown",
      model: "claude-opus-9-9",
      usage: {
        input_tokens: 8,
        output_tokens: 12,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 4,
      },
    },
  };
  return context.parseClaudeCode([JSON.stringify(known), JSON.stringify(unknown)]);
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

function chatGptResult(model = "gpt-9.9-future") {
  return context.parseOpenAI([JSON.stringify([{
    id: "conversation-1",
    default_model_slug: model,
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
          metadata: { model_slug: model },
        },
      },
    },
  }])]);
}

function codexResult(model = "codex-future-9") {
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
      payload: { model },
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

function mixedCursorResult(unknownModel) {
  return context.parseCursor([[
    CURSOR_HEADER,
    "2026-07-19T00:00:00Z,On-Demand,claude-sonnet-4-6,No,100,80,10,20,130,1.25",
    `2026-07-19T00:01:00Z,On-Demand,${unknownModel},No,10,8,4,12,26,`,
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

function mixedCopilotResult() {
  const header = [
    "date", "product", "sku", "quantity", "unit_type", "applied_cost_per_quantity",
    "gross_amount", "discount_amount", "net_amount", "organization", "cost_center_name",
    "model", "username",
  ].join(",");
  const known = [
    "2026-07-19", "copilot", "copilot_premium_request", "2", "requests", "", "", "", "0.20",
    "org", "cost-center", "Claude Sonnet 4.5", "user",
  ].join(",");
  const unknown = [
    "2026-07-19", "copilot", "copilot_ai_credit", "3", "ai-credits", "", "", "", "",
    "org", "cost-center", "Gemini 9.9 Pro", "user",
  ].join(",");
  return context.parseCopilot([[header, known, unknown].join("\n")]);
}

test("Claude Code never-zero render contract", () => {
  const result = claudeCodeResult();
  assertModelsHaveNoKnownRate(result);
  const rendered = renderResult(result);
  assert.match(rendered.summary, /Total AI usage: 26 tokens\./);
  assert.match(rendered.summary, /8 sent, 12 returned, 2 cache added, 4 cache reused/);
  assertNeverZeroContract(rendered, Object.keys(result.by));
});

test("Claude Chat never-zero render contract", () => {
  const result = claudeChatResult();
  assertModelsHaveNoKnownRate(result);
  const rendered = renderResult(result);
  assert.match(rendered.summary, /Rough text-only estimate from selected file: about 5 tokens\./);
  assert.match(rendered.summary, /about 2 sent, about 3 returned/);
  assertNeverZeroContract(rendered, Object.keys(result.by));
});

test("ChatGPT never-zero render contract", () => {
  const result = chatGptResult();
  assertModelsHaveNoKnownRate(result);
  const rendered = renderResult(result);
  assert.match(rendered.summary, /Rough text-only estimate from selected file: about 5 tokens\./);
  assert.match(rendered.summary, /about 2 sent, about 3 returned/);
  assertNeverZeroContract(rendered, Object.keys(result.by));
});

test("Codex never-zero render contract", () => {
  const result = codexResult();
  assertModelsHaveNoKnownRate(result);
  const rendered = renderResult(result);
  assert.match(rendered.summary, /Total AI usage: 20 tokens\./);
  assert.match(rendered.summary, /6 sent, 12 returned, 0 cache added, 2 cache reused/);
  assertNeverZeroContract(rendered, Object.keys(result.by));
});

test("Cursor never-zero render contract", () => {
  const result = cursorResult("gemini-9.9-pro");
  assertModelsHaveNoKnownRate(result);
  const rendered = renderResult(result);
  assert.match(rendered.summary, /Total AI usage: 26 tokens\./);
  assert.match(rendered.summary, /8 sent, 12 returned, 2 cache added, 4 cache reused/);
  assertNeverZeroContract(rendered, Object.keys(result.by));
});

test("Cursor Composer never-zero render contract", () => {
  const result = cursorResult("composer-9.9");
  assertModelsHaveNoKnownRate(result);
  const rendered = renderResult(result);
  assert.match(rendered.summary, /Total AI usage: 26 tokens\./);
  assert.match(rendered.summary, /8 sent, 12 returned, 2 cache added, 4 cache reused/);
  assertNeverZeroContract(rendered, Object.keys(result.by));
});

test("GitHub Copilot never-zero render contract", () => {
  const result = copilotResult();
  assertModelsHaveNoKnownRate(result);
  const rendered = renderResult(result);
  assert.match(rendered.table, /<th>Premium requests<\/th><th>AI credits<\/th>/);
  assert.match(rendered.summary, /Premium requests recorded: 2\./);
  assert.match(rendered.summary, /AI credits recorded: 3\./);
  // Copilot exports expose metered requests and credits, not tokens. Keep that limitation visible.
  assert.match(rendered.tokenHelp, /not tokens[\s\S]*instead of token counts/i);
  assert.doesNotMatch(rendered.table, /text sent to the AI|text returned by the AI/i);
  assertNeverZeroContract(rendered, Object.keys(result.by));
});

test("mixed priced and unpriceable reports keep every unknown row explicitly unpriced", () => {
  const cases = [
    { name: "Claude Code", result: mixedClaudeCodeResult(), unknown: ["claude-opus-9-9"] },
    { name: "Cursor", result: mixedCursorResult("gemini-9.9-pro"), unknown: ["gemini-9.9-pro"] },
    { name: "Cursor Composer", result: mixedCursorResult("composer-9.9"), unknown: ["composer-9.9"] },
    { name: "GitHub Copilot", result: mixedCopilotResult(), unknown: ["Gemini 9.9 Pro"] },
  ];
  const failures = [];
  for (const sourceCase of cases) {
    const rendered = renderResult(sourceCase.result);
    if (!rendered.modelCosts.some((row) => hasPositiveMoney(row.cost))) {
      failures.push(`${sourceCase.name}: fixture did not reach the mixed priced and unpriceable render path`);
    }
    for (const failure of neverZeroFailures(rendered, sourceCase.unknown)) {
      failures.push(`${sourceCase.name}: ${failure}`);
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("known models from sources without billed cost remain explicitly unpriced with usage visible", () => {
  const model = "gpt-5.6-sol";
  assert.ok(context.priceKeyFor(model), "fixture must use a model with a checked reference rate");
  const cases = [
    { name: "ChatGPT", result: chatGptResult(model) },
    { name: "Codex", result: codexResult(model) },
  ];
  const failures = [];
  for (const sourceCase of cases) {
    const rendered = renderResult(sourceCase.result);
    for (const failure of neverZeroFailures(rendered, [model])) {
      failures.push(`${sourceCase.name}: ${failure}`);
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});
