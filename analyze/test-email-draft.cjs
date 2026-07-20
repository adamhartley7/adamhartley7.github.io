const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

// The former arbitrary-recipient mail draft is deliberately gone. The
// canonical analyzer terminal is local-only and names no remote recipient.
assert.doesNotMatch(html, /id="shareRecipients"|id="openEmailDraft"|mailto:/);
assert.doesNotMatch(html, /parseRecipientList|buildMailDraftUrl|MAILTO_SAFE_LIMIT/);
assert.doesNotMatch(html, /oconns89@|adam2hartley@/i,
  "server recipient addresses must not be published in client source");

const terminalStart = html.indexOf('<section class="share-stage" id="shareWithTop"');
const terminalEnd = html.indexOf("</section>", terminalStart);
assert.ok(terminalStart >= 0 && terminalEnd > terminalStart, "could not locate the local report terminal");
const terminal = html.slice(terminalStart, terminalEnd);
assert.match(terminal, /Download Or Copy My Safe Report/);
assert.match(terminal, /This page has no configured remote recipient/);
assert.match(terminal, /<div class="share-form" hidden aria-hidden="true">/,
  "the dormant remote-transfer area must remain inaccessible");
assert.doesNotMatch(terminal, /Optional Research Submission|Submit Reviewed Safe Report|Fixed recipients:|Adam And Sam/i,
  "the local terminal must not advertise a named remote-delivery action");

// Local download and copy remain available even while the endpoint is blank.
assert.match(html, /id="safeDownload">Download My Own Copy/);
assert.match(html, /id="copySafePackage">Copy Exact Summary/);
assert.match(html, /id="downloadResearchJSON">Download Complete Research-Safe JSON/);
assert.match(html, /var TOP_DELIVERY_ENDPOINT="";/);

const copyStart = html.indexOf("function copyPlainText");
const copyEnd = html.indexOf('document.getElementById("copyHistoryPath")', copyStart);
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
  assert.ok(!button.textContent.includes(privateBody), "private report text must not enter the button after a copy failure");
  console.log("TOP Analyzer fixed-recipient and local-fallback tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
