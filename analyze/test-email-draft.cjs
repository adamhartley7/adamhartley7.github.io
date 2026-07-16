const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");

// The former arbitrary-recipient mail draft is deliberately gone. Delivery
// recipients belong only to the server configuration.
assert.doesNotMatch(html, /id="shareRecipients"|id="openEmailDraft"|mailto:/);
assert.doesNotMatch(html, /parseRecipientList|buildMailDraftUrl|MAILTO_SAFE_LIMIT/);
assert.match(html, /Optional Research Submission To Adam And Sam/);
assert.match(html, /Fixed recipients:/);
assert.match(html, /This page cannot choose, change or add recipients/);
assert.doesNotMatch(html, /oconns89@|adam2hartley@/i,
  "server recipient addresses must not be published in client source");

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
