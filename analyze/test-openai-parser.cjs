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
  id: "gpt-conversation-1",
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
const duplicateResult = context.parseOpenAI([JSON.stringify(fixture), JSON.stringify(fixture)]);
assert.equal(duplicateResult.sessions, 1, "a copied ChatGPT export must not double the same conversation ID");
assert.equal(duplicateResult.turns, 2);
assert.equal(duplicateResult.duplicateRecords, 1);
const olderOpenAI = JSON.parse(JSON.stringify(fixture));
olderOpenAI[0].mapping = { user: fixture[0].mapping.user };
const oldThenNewOpenAI = context.parseOpenAI([JSON.stringify(olderOpenAI), JSON.stringify(fixture)]);
const newThenOldOpenAI = context.parseOpenAI([JSON.stringify(fixture), JSON.stringify(olderOpenAI)]);
assert.equal(oldThenNewOpenAI.turns, 2, "the more complete ChatGPT snapshot must win");
assert.deepEqual(JSON.parse(JSON.stringify(oldThenNewOpenAI.by)), JSON.parse(JSON.stringify(newThenOldOpenAI.by)), "ChatGPT totals must not depend on file order");

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
  uuid: "claude-conversation-1",
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
const duplicateClaudeResult = context.parseChat([JSON.stringify(claudeFixture), JSON.stringify(claudeFixture)]);
assert.equal(duplicateClaudeResult.sessions, 1, "a copied Claude Chat export must not double the same conversation UUID");
assert.equal(duplicateClaudeResult.turns, 3);
assert.equal(duplicateClaudeResult.duplicateRecords, 1);
const olderClaude = JSON.parse(JSON.stringify(claudeFixture));
olderClaude[0].chat_messages = olderClaude[0].chat_messages.slice(0, 1);
const oldThenNewClaude = context.parseChat([JSON.stringify(olderClaude), JSON.stringify(claudeFixture)]);
const newThenOldClaude = context.parseChat([JSON.stringify(claudeFixture), JSON.stringify(olderClaude)]);
assert.equal(oldThenNewClaude.turns, 3, "the more complete Claude snapshot must win");
assert.deepEqual(JSON.parse(JSON.stringify(oldThenNewClaude.by)), JSON.parse(JSON.stringify(newThenOldClaude.by)), "Claude totals must not depend on file order");
const newerClaudeWithBothFields = JSON.parse(JSON.stringify(olderClaude));
newerClaudeWithBothFields[0].chat_messages.push({ sender: "assistant", text: "123456789012", content: { unsupported: "ignore this field" } });
const bothFieldsResult = context.parseChat([JSON.stringify(olderClaude), JSON.stringify(newerClaudeWithBothFields)]);
assert.equal(bothFieldsResult.turns, 2, "dedupe quality must use the same Claude text fallback as the parser");

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
