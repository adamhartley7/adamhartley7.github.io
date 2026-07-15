const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const start = html.indexOf("function estTokens");
const end = html.indexOf("// ---------- render ----------", start);
assert.ok(start >= 0 && end > start, "could not locate chat parsers");

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const fixture = [{
  title: "Test conversation",
  create_time: 1784073600,
  default_model_slug: "gpt-test-model",
  mapping: {
    root: { id: "root", message: null },
    user: {
      id: "user",
      message: {
        author: { role: "user" },
        create_time: 1784073600,
        content: { content_type: "text", parts: ["12345678"] },
      },
    },
    assistant: {
      id: "assistant",
      message: {
        author: { role: "assistant" },
        create_time: 1784073660,
        content: { content_type: "text", parts: ["123456789012"] },
        metadata: { model_slug: "gpt-test-model" },
      },
    },
    tool: {
      id: "tool",
      message: {
        author: { role: "tool" },
        content: { content_type: "text", parts: ["must not be counted"] },
      },
    },
  },
}];

const result = context.parseOpenAI([JSON.stringify(fixture)]);
assert.equal(result.sessions, 1);
assert.equal(result.turns, 2, "only user and assistant messages should count");
assert.equal(result.days, 1);
assert.equal(result.by["gpt-test-model"].inp, 2);
assert.equal(result.by["gpt-test-model"].out, 3);
assert.equal(result.chatExport, true);
assert.match(result.estimateReason, /no billed token or ChatGPT subscription cost data/);

console.log("TOP Analyzer OpenAI export parser tests passed");
