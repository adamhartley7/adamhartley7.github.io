const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

assert.match(html, /Nothing is submitted automatically\./);
assert.match(html, /Direct server delivery is not live yet\./);
assert.match(html, /id="shareConsent"/);
assert.match(html, /id="openEmailDraft" disabled/);
assert.doesNotMatch(html, /oconns89@/i, "collaborator addresses must not be published in client source");
assert.doesNotMatch(html, /colin[^\s"']*@/i, "collaborator addresses must not be published in client source");

const start = html.indexOf("var MAILTO_SAFE_LIMIT");
const end = html.indexOf("function updateEmailDraftState", start);
assert.ok(start >= 0 && end > start, "could not locate local email-draft helpers");

const context = { encodeURIComponent };
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const modelStart = html.indexOf("function safePublicModelLabel");
const modelEnd = html.indexOf("function pricingDetailsHTML", modelStart);
assert.ok(modelStart >= 0 && modelEnd > modelStart, "could not locate shareable model-label sanitizer");
vm.runInContext(html.slice(modelStart, modelEnd), context);
assert.equal(context.safePublicModelLabel("claude-opus-4-8"), "claude-opus-4-8");
assert.equal(context.safePublicModelLabel("claude-3-opus-20240229"), "claude-3-opus-20240229");
assert.equal(context.safePublicModelLabel("claude-3-5-sonnet-20241022"), "claude-3-5-sonnet-20241022");
assert.equal(context.safePublicModelLabel("claude-3-5-haiku-20241022"), "claude-3-5-haiku-20241022");
assert.equal(context.safePublicModelLabel("deepseek-v4-pro"), "deepseek-v4-pro");
assert.equal(context.safePublicModelLabel("claude-PRIVATE_PROJECT_NAME"), "Unrecognized AI version");
assert.equal(context.safePublicModelLabel("C:\\Users\\Adam\\private-model"), "Unrecognized AI version");
assert.equal(context.safePublicModelLabel("<img src=x onerror=alert(1)>"), "Unrecognized AI version");

assert.deepEqual(
  [...context.parseRecipientList("adam@example.com; sam@example.org, colin@example.net")],
  ["adam@example.com", "sam@example.org", "colin@example.net"],
);
assert.deepEqual([...context.parseRecipientList("not-an-email")], []);
assert.deepEqual([...context.parseRecipientList("a@example.com,b@example.com,c@example.com,d@example.com")], [],
  "the local draft must remain bounded to three deliberately entered recipients");
assert.deepEqual([...context.parseRecipientList("victim@example.com\r\nBcc:other@example.com")], [],
  "header injection must fail closed");

const report = "TOP Usage Summary\nInput: 10\nOutput: 20\nCache added: 30\nCache reused: 40";
const url = context.buildMailDraftUrl(["adam@example.com", "sam@example.org"], report);
assert.match(url, /^mailto:/);
assert.ok(url.includes(encodeURIComponent(report)), "the reviewed report must be the draft body");
assert.ok(!url.includes("\r") && !url.includes("\n"), "the URL must encode line breaks");
assert.ok(context.MAILTO_SAFE_LIMIT < 8191, "the mailto guard must stay below the Windows and Outlook URL boundary");
assert.ok(context.buildMailDraftUrl(["adam@example.com"], "x".repeat(8000)).length > context.MAILTO_SAFE_LIMIT,
  "a large report must cross the fallback threshold instead of being handed to the mail client");
assert.match(html, /TOP cannot tell whether it opened or was delivered/,
  "mailto handoff must not claim that a draft actually opened");
assert.match(html, /copyPlainText\(sharePackage,this,"Exact Summary Copied"\)\.then/,
  "the share status must wait for a confirmed clipboard result");

const copyStart = html.indexOf("function copyPlainText");
const copyEnd = html.indexOf("document.getElementById(\"copyHistoryPath\")", copyStart);
assert.ok(copyStart >= 0 && copyEnd > copyStart, "could not locate clipboard helper");
const copyContext = {
  navigator: { clipboard: { writeText: () => Promise.reject(new Error("permission denied")) } },
  document: {
    createElement: () => ({ value: "", style: {}, setAttribute() {}, select() {} }),
    body: { appendChild() {}, removeChild() {} },
    execCommand: () => false,
  },
  Promise,
  setTimeout() {},
};
vm.createContext(copyContext);
vm.runInContext(html.slice(copyStart, copyEnd), copyContext);

(async () => {
  const button = { textContent: "Copy Exact Summary" };
  const privateBody = "PRIVATE SUMMARY BODY";
  const copied = await copyContext.copyPlainText(privateBody, button, "Exact Summary Copied");
  assert.equal(copied, false, "clipboard rejection plus a failed fallback must report failure");
  assert.equal(button.textContent, "Copy Failed");
  assert.ok(!button.textContent.includes(privateBody), "private report text must never be placed on the button after a copy failure");
  console.log("TOP Analyzer explicit email-draft tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
