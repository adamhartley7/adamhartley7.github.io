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
assert.equal(context.detectConversationMode([JSON.stringify(fixture)]), "openai");
assert.equal(result.sessions, 1);
assert.equal(result.turns, 2, "only user and assistant messages should count");
assert.equal(result.days, 1);
assert.equal(result.by["gpt-test-model"].inp, 2);
assert.equal(result.by["gpt-test-model"].out, 3);
assert.equal(result.chatExport, true);
assert.match(result.estimateReason, /no billed token or ChatGPT subscription cost data/);

const branchedFixture = [{
  current_node: "assistant-new",
  default_model_slug: "gpt-test-model",
  mapping: {
    root: { id: "root", parent: null, children: ["user"], message: null },
    user: { id: "user", parent: "root", children: ["assistant-old", "assistant-new"], message: { author: { role: "user" }, content: { parts: ["12345678"] } } },
    "assistant-old": { id: "assistant-old", parent: "user", children: [], message: { author: { role: "assistant" }, content: { parts: ["this abandoned answer must not count"] } } },
    "assistant-new": { id: "assistant-new", parent: "user", children: [], message: { author: { role: "assistant" }, content: { parts: ["123456789012"] } } },
  },
}];
const branchedResult = context.parseOpenAI([JSON.stringify(branchedFixture)]);
assert.equal(branchedResult.turns, 2, "only the visible ChatGPT branch should count");
assert.equal(branchedResult.by["gpt-test-model"].inp, 2);
assert.equal(branchedResult.by["gpt-test-model"].out, 3);

const claudeFixture = [{
  name: "Claude conversation",
  chat_messages: [
    { sender: "human", text: "12345678" },
    { sender: "assistant", text: "123456789012" },
    { sender: "assistant", content: { text: "12345678" } },
    { sender: "system", text: "must not count" },
    { sender: "assistant", text: "" },
    { sender: "assistant", content: { unsupported: "must not become NaN" } },
  ],
}];
assert.equal(context.detectConversationMode([JSON.stringify(claudeFixture)]), "chat");
const claudeResult = context.parseChat([JSON.stringify(claudeFixture)]);
assert.equal(claudeResult.sessions, 1);
assert.equal(claudeResult.turns, 3, "only supported nonempty human and assistant messages should count");
assert.equal(claudeResult.by["claude.ai (est.)"].inp, 2);
assert.equal(claudeResult.by["claude.ai (est.)"].out, 5);
assert.equal(claudeResult.ignoredMessages, 3);
assert.equal(claudeResult.chatProvider, "Claude Chat");

const projectFixture = [{ name: "Project metadata", docs: [{ title: "not a conversation" }] }];
assert.equal(context.detectConversationMode([JSON.stringify(projectFixture)]), "");
const invalidClaude = context.parseChat([JSON.stringify(projectFixture)]);
assert.equal(invalidClaude.sessions, 0, "project objects must not count as conversations");
assert.equal(invalidClaude.turns, 0);

assert.equal(
  context.detectConversationMode([JSON.stringify(claudeFixture), JSON.stringify(fixture)]),
  "mixed",
  "mixed Claude Chat and ChatGPT exports must fail closed",
);

console.log("TOP Analyzer OpenAI export parser tests passed");
