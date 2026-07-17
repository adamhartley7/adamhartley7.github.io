const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
assert.match(html, /class="mini-emblem"/);
assert.match(html, /\.vcard input\[type=range\][^}]*min-width:0/);
assert.match(html, /@media\(max-width:640px\)\{\.vcard \.vcontrols\{display:grid/);
assert.match(html, /aria-valuetext/);

const forbiddenPatterns = [
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/sendBeacon/, "sendBeacon"],
  [/\bWebSocket\s*\(/, "WebSocket"],
  [/web3forms/i, "Web3Forms relay"],
  [/\baccess_key\b/i, "relay access key field"],
  [/ntfy\.sh/i, "visitor notification endpoint"],
  [/fonts\.googleapis|fonts\.gstatic/i, "remote font request"],
  [/id=["']sendbtn["']/, "remote send button"],
  [/mailto:adam1hartley/i, "email collection action"],
  [/send Adam/i, "instruction to send a file to Adam"],
  [/send us/i, "instruction to send a file to TOP"],
  [/\banonym(?:ised|ized|ous)\b/i, "unsupported anonymous-data claim"],
  [/showDirectoryPicker|createWritable|requestPermission\s*\(\s*\{[^}]*readwrite/i, "vault write permission"],
  [/indexedDB|localStorage|serviceWorker/, "persistent browser storage or worker"],
];

for (const [pattern, label] of forbiddenPatterns) {
  assert.equal(pattern.test(html), false, `${label} must not exist in the local analyzer`);
}

const fetchCalls = html.match(/\bfetch\s*\(/g) || [];
assert.equal(fetchCalls.length, 1, "only the deliberate, configuration-gated submission may use fetch");
assert.match(html, /var TOP_DELIVERY_ENDPOINT="";/,
  "the repository must keep direct delivery disabled until the Worker endpoint is verified");
assert.match(html, /fetch\(endpoint,\{method:"POST"/,
  "the one fetch call must use only the validated configuration constant");

assert.match(html, /Nothing is sent automatically\./);
assert.match(html, /Your chosen files stay on this device/);
assert.match(html, /The files stay in this browser and are not sent to TOP\./);
assert.match(html, /<main class="wrap" id="main-content">/);
assert.match(html, /connect-src 'none'/);
assert.match(html, /Copy summary/);
assert.match(html, /Download \.txt/);
assert.match(html, /You can make your report now\. TOP is not accepting files yet\./);
assert.match(html, /finish clear rules for permission, storage and deletion/);
assert.match(html, /Show My Report First/);
assert.match(html, /Make A Shareable Summary/);
assert.match(html, /Like opening a spreadsheet on your own laptop/);
assert.match(html, /Like sharing a summary of a bank statement instead of the statement itself/);
assert.match(html, /cc:\{[\s\S]*?a:"Choose your Claude Code history files[\s\S]*?b:"Use the readable privacy tool first/);
assert.match(html, /codex:\{[\s\S]*?a:"Choose Codex rollout session files[\s\S]*?b:"Choose Codex rollout session files/);
assert.match(html, /chat:\{[\s\S]*?a:"Choose conversations\.json[\s\S]*?b:"Choose conversations\.json/);
assert.match(html, /openai:\{[\s\S]*?a:"Choose your ChatGPT history download[\s\S]*?b:"Choose your ChatGPT history download/);
assert.match(html, /csv:\{[\s\S]*?a:"Choose either an Anthropic Usage CSV[\s\S]*?b:"Choose either an Anthropic Usage CSV/);
assert.match(html, /class="journey-world"/);
assert.match(html, /function setJourney\(/);
assert.match(html, /assets\/analyzer-ocean-sunset\.webp/);
assert.match(html, /Pok Rie \/ Pexels/);
assert.ok(fs.existsSync(new URL("../assets/analyzer-ocean-sunset.webp", `file://${__dirname}/`)));
assert.match(html, /assets\/nasa-lro-full-moon-2017\.webp/);
assert.match(html, /NASA's Scientific Visualization Studio/);
assert.ok(fs.existsSync(new URL("../assets/nasa-lro-full-moon-2017.webp", `file://${__dirname}/`)));
assert.match(html, /\.journey-sun\{[^}]*radial-gradient/);
assert.doesNotMatch(html, /\.journey-sun\{[^}]*nasa-sdo-sun-pia26681\.webp/);
assert.doesNotMatch(html, /Sun: <a href=/);
assert.match(html, /--world-brightness/);
assert.match(html, /--world-saturation/);
assert.match(html, /--world-warmth/);
assert.match(html, /--world-light/);
assert.match(html, /viewBox="0 0 520 390"/);
assert.match(html, /AI cost · invented useful work · invented value after cost/);
assert.match(html, /Which Of These Applies To You\?/);
assert.match(html, /Running Out Of AI Usage/);
assert.match(html, /I Cannot Predict How Much AI Allowance A Task Will Use/);
assert.match(html, /I Do Not Know Which AI Setup To Choose/);
assert.match(html, /Spending Too Much On AI/);
assert.match(html, /My AI Cannot Use My Obsidian Memory/);
assert.match(html, /data-mode="obsidian"/);
assert.match(html, /data-mode="codex"/);
assert.match(html, /data-provider="claude" aria-controls="claudeSources"/);
assert.match(html, /id="claudeSources" hidden/);
assert.match(html, /Which Claude history do you have\?/);
assert.match(html, /Useful context, but not usage history/);
assert.match(html, /individual UUID-named JSON files/);
assert.match(html, /Choose Claude, Codex, ChatGPT or Obsidian/);
assert.match(html, /id="reportScope"/);
assert.match(html, /Rough text-only estimate/);
assert.match(html, /not your full account total, subscription allowance, Claude Code usage or Codex usage/);
assert.match(html, /function detectConversationMode\(/);
assert.match(html, /function inferModeFromFileNames\(/);
assert.match(html, /Claude project, memory or user context, not usage history/);
assert.match(html, /Check conversation export/);
assert.match(html, /id="downloadscript"/);
assert.match(html, /Download Privacy Cleaner/);
assert.match(html, /id="historyPathHelper"/);
assert.match(html, /id="copyHistoryPath">Copy Folder Address/);
assert.match(html, /id="copyAgentPathPrompt">Ask My Agent For The Address/);
assert.match(html, /A website cannot type a private path into the picker for you/);
assert.match(html, /Choose only <code>rollout-\*\.jsonl<\/code> files/);
assert.match(html, /Do not choose the whole <code>\.codex<\/code> folder/);
assert.match(html, /id="downloadAIEvents">Download ai-events\.jsonl/);
assert.match(html, /id="downloadObsidianReport">Download Obsidian Report/);
assert.match(html, /Keep raw Codex rollout files outside the vault/);
assert.match(html, /function createCodexAccumulator\(/);
assert.match(html, /function createBoundedLineCollector\(/);
assert.match(html, /by=Object\.create\(null\),days=Object\.create\(null\)/);
assert.match(html, /Choose either raw rollout-\*\.jsonl files or ai-events\.jsonl aggregate files, not both/);
assert.match(html, /Choose one ai-events\.jsonl aggregate at a time/);
assert.match(html, /URL\.revokeObjectURL\(url\)/);
assert.match(html, /Your vault is memory, not a bill\./);
assert.match(html, /it does not connect to, change or copy your vault/i);
assert.match(html, /id="vaultFolder" webkitdirectory directory multiple/);
assert.match(html, /id="vaultFiles" accept="\.json,\.jsonl,\.csv,application\/json,text\/csv" multiple/);
assert.match(html, /does not read your Markdown notes, settings or attachments/);
assert.match(html, /Choose every statement that sounds like you/);
assert.match(html, /id="providerStep" hidden/);
assert.match(html, /id="routechooser" hidden/);
assert.match(html, /aria-pressed="false"/);
assert.match(html, /What you want to improve:/);
assert.match(html, /Rough text-only estimate/);
assert.match(html, /has no recorded token counts/);
assert.match(html, /if\(res\.csv\) return \{card:"Records",table:"Records",summary:"Records"\}/);
assert.match(html, /if\(res\.chatExport\) return \{card:"Text messages found",table:"Text messages found",summary:"Text messages found in selected file"\}/);
assert.doesNotMatch(html, /starting_challenges:|provider_selected:|privacy_route:|task_archetypes:/);
assert.match(html, /id="shareWithTop" hidden/);
assert.match(html, /<h2 id="shareWithTopHeading" tabindex="-1">Download Or Share My Safe Report<\/h2>/);
assert.match(html, /Nothing is submitted automatically\./);
assert.match(html, /Download My Own Copy/);
assert.match(html, /Copy Exact Summary/);
assert.match(html, /Optional Research Submission To Adam And Sam/);
assert.match(html, /This page cannot choose, change or add recipients/);
assert.match(html, /id="researchConsent"/);
assert.match(html, /id="submitResearchReport" disabled/);
assert.match(html, /retained for up to 30 days/);
assert.doesNotMatch(html, /id="shareRecipients"|id="openEmailDraft"|mailto:/,
  "the browser must not accept or construct delivery recipients");
assert.match(html, /id="finalPackagePreview" readonly/);
assert.match(html, /includeSurveyContext=!skipped/);
assert.match(html, /Optional answers included: "\+\(includeSurveyContext\?"Yes":"No"\)/);
assert.match(html, /\+\(includeSurveyContext\?surveyBlock\(\):""\)/,
  "skipped optional answers must not enter the shareable file");
assert.match(html, /var body=lastSummary/);
assert.match(html, /Original history file included: No/);
assert.match(html, /Delivery status: Prepared locally, not sent by TOP/);
assert.match(html, /cache added/);
assert.match(html, /cache reused/);
assert.match(html, /Pricing basis: pay-as-you-go API rates checked/);
assert.match(html, /id="shareSummaryBox" hidden/);
assert.doesNotMatch(html, /var wantsShare=selectedRoute==="b"/);
assert.match(html, /shareSummaryBox"\)\.hidden=false/);
assert.match(html, /getElementById\("survey"\)\.hidden=false/);
assert.match(html, /share\.scrollIntoView\(\{behavior:"smooth",block:"start"\}\)/);
assert.match(html, /document\.getElementById\('shareWithTop'\)\.hidden=true/);
assert.match(html, /ROUTEB=null/);

const folderChoicePosition = html.indexOf('id="historyFolderChoice"');
const fileFallbackPosition = html.indexOf('id="fileFallback"');
assert.ok(folderChoicePosition >= 0 && fileFallbackPosition > folderChoicePosition,
  "folder selection must be the primary Claude Code and Codex action, before individual-file fallback");

const topLevelSources = html.slice(html.indexOf('id="tabs"'), html.indexOf('id="claudeSources"'));
assert.doesNotMatch(topLevelSources, /data-mode="(?:cc|chat|csv)"/, "Claude subtypes must not appear as top-level choices");
const claudeSources = html.slice(html.indexOf('id="claudeSources"'), html.indexOf('id="routechooser"'));
for (const sourceMode of ["cc", "chat", "csv"]) assert.match(claudeSources, new RegExp(`data-mode="${sourceMode}"`));
assert.doesNotMatch(html, /MODES\s*=\s*\{\s*claude:/, "Claude must remain a chooser, not a combined parser");
assert.match(html, /function showClaudeChoices\(/);
assert.match(html, /document\.getElementById\('claudeSources'\)\.hidden=true/);

const codexExportStart = html.indexOf("function codexCoverageForExport");
const codexExportEnd = html.indexOf("// ---------- usage survey", codexExportStart);
assert.ok(codexExportStart >= 0 && codexExportEnd > codexExportStart, "Codex export builders must exist");
const codexExportSource = html.slice(codexExportStart, codexExportEnd);
for (const denied of ["source_file", "session_id", "turn_id", "cwd", "workspace_roots", "rate_limits", "plan_type", "credits", "repository_url"]) {
  assert.doesNotMatch(codexExportSource, new RegExp(denied), `Codex exports must not include ${denied}`);
}

const holdPosition = html.indexOf("You can make your report now. TOP is not accepting files yet.");
const routePosition = html.indexOf('id="routechooser"');
assert.ok(holdPosition >= 0 && routePosition >= 0 && holdPosition < routePosition,
  "the intake pause must be visible before route selection");
const questionPosition = html.indexOf("Which Of These Applies To You?");
const providerPosition = html.indexOf('id="providerStep"');
assert.ok(questionPosition >= 0 && providerPosition > questionPosition && routePosition > providerPosition,
  "the multi-select problem screen must come before provider and route selection");
const surveyPosition = html.indexOf('id="survey"');
const sharePosition = html.indexOf('id="shareWithTop"');
const footerPosition = html.indexOf("<footer>");
assert.ok(surveyPosition >= 0 && sharePosition > surveyPosition && footerPosition > sharePosition,
  "the shared safe-copy step must appear after the questionnaire and before the footer");

console.log("TOP Analyzer privacy regression tests passed");
