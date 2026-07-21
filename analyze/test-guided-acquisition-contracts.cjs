"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const collector = fs.readFileSync(new URL("collector/top-collector.mjs", `file://${__dirname}/`), "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `could not extract source between ${startMarker} and ${endMarker}`);
  return html.slice(start, end);
}

function sourceBetweenPatterns(source, startPattern, endPattern) {
  const startMatch = startPattern.exec(source);
  assert.ok(startMatch, `could not find source start ${startPattern}`);
  const tail = source.slice(startMatch.index + startMatch[0].length);
  const endMatch = endPattern.exec(tail);
  assert.ok(endMatch, `could not find source end ${endPattern}`);
  return source.slice(startMatch.index, startMatch.index + startMatch[0].length + endMatch.index);
}

function functionSource(name, nextName) {
  return sourceBetweenPatterns(
    html,
    new RegExp(`function\\s+${name}\\s*\\(`),
    new RegExp(`function\\s+${nextName}\\s*\\(`),
  );
}

function platformFolderSource() {
  return sourceBetween("function detectedDesktopPlatform", "var MODES={");
}

function textOnly(value) {
  return String(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function loadModes() {
  const context = {};
  vm.runInNewContext(sourceBetweenPatterns(html, /\bvar\s+MODES\s*=/, /\bvar\s+MODE_ACCEPT\s*=/), context);
  assert.ok(context.MODES && context.MODES.chat && context.MODES.copilot, "acquisition modes must load");
  return context.MODES;
}

function fakeElement() {
  return {
    hidden: false,
    textContent: "",
    value: "",
    classList: { add() {}, toggle() {} },
    scrollIntoView() {},
    setAttribute() {},
  };
}

function guidedCodexFolderCopy() {
  const elements = Object.create(null);
  const document = {
    getElementById(id) {
      if (!elements[id]) elements[id] = fakeElement();
      return elements[id];
    },
    querySelectorAll() { return []; },
  };
  const context = {
    document,
    navigator: { platform: "Win32" },
    PILOT_SOURCE: "",
    mode: "",
    selectedRoute: "",
    providerChosen: false,
    pilotPromptFor() { return ""; },
    pilotStatus() {},
    setJourney() {},
  };
  vm.runInNewContext(
    `${platformFolderSource()}\n${functionSource("pilotChooseSource", "pilotChooseMethod")}`,
    context,
  );
  context.pilotChooseSource("codex");
  const panel = sourceBetween('id="pilotFolderPanel"', 'id="pilotCursorPanel"');
  return `${textOnly(panel)} ${elements.pilotFolderInstructions.textContent} ${elements.pilotFolderPath.textContent}`.trim();
}

function codexCollectorPrompt() {
  const context = {
    navigator: { platform: "Win32" },
    PILOT_COLLECTOR_URL: "https://local.invalid/top-collector.mjs",
    PILOT_COLLECTOR_SHA256: "synthetic-hash",
    PILOT_COLLECTOR_VERSION: "synthetic-version",
  };
  vm.runInNewContext(
    `${platformFolderSource()}\n${functionSource("pilotPromptFor", "pilotChooseSource")}`,
    context,
  );
  return context.pilotPromptFor("codex");
}

function executeCollectorCodexRoots() {
  const context = {
    path: { join(...parts) { return parts.join("\\"); } },
  };
  vm.runInNewContext(
    sourceBetweenPatterns(collector, /function\s+defaultRoots\s*\(/, /function\s+createNoopProgress\s*\(/),
    context,
  );
  return Array.from(context.defaultRoots("codex", "C:\\SyntheticProfile"));
}

function sentenceAround(value, index) {
  const before = value.slice(0, index);
  const starts = Array.from(before.matchAll(/(?:[!?;]|\.\s+)\s*/g));
  const start = starts.length ? starts[starts.length - 1].index + starts[starts.length - 1][0].length : 0;
  const after = value.slice(index);
  const endMatch = /(?:[!?;]|\.\s|\.$)/.exec(after);
  const end = endMatch ? index + endMatch.index : value.length;
  return value.slice(start, end);
}

function offersBothCodexRoots(value) {
  const copy = String(value).replace(/\//g, "\\");
  const lowered = copy.toLowerCase();
  const activeRoot = "%userprofile%\\.codex\\sessions";
  const archiveRoot = "%userprofile%\\.codex\\archived_sessions";
  if (!lowered.includes(activeRoot) || !lowered.includes(archiveRoot)) return false;
  const activeIndex = lowered.indexOf(activeRoot);
  const archiveIndex = lowered.indexOf(archiveRoot);
  const activeSentence = sentenceAround(lowered, activeIndex);
  const archiveSentence = sentenceAround(lowered, archiveIndex);
  const actionable = (sentence) => /\b(?:choose|paste|copy|select|open|use|add|include|scan|read)\b/.test(sentence)
    && !/\b(?:not|never|cannot|can't|unsupported|do not)\b/.test(sentence);
  const firstIndex = Math.min(activeIndex, archiveIndex);
  const lastIndex = Math.max(activeIndex, archiveIndex);
  const firstRootLength = activeIndex < archiveIndex ? activeRoot.length : archiveRoot.length;
  const linkingCopy = lowered.slice(firstIndex + firstRootLength, lastIndex);
  const fallbackLink = /\b(?:or|either|if|otherwise|instead|fallback|alternative)\b/.test(linkingCopy);
  const explicitCombination = Array.from(lowered.matchAll(/\b(?:both|combines?|combined|together|too|as\s+well|in\s+addition)\b/g))
    .some((match) => {
      const sentence = sentenceAround(lowered, match.index);
      return /\b(?:choose|paste|copy|select|open|use|add|include|scan|read|combines?|combined)\b/.test(sentence)
        && !/\b(?:not|never|cannot|can't|unsupported|do not)\b/.test(sentence);
    });
  const combined = explicitCombination && !fallbackLink;
  return actionable(activeSentence) && actionable(archiveSentence) && combined;
}

function panelPinsCollectorBothRoots(value) {
  return /\bcollector\b/i.test(value) && offersBothCodexRoots(value);
}

function requiredStepIsNegated(clause, stage) {
  const verbNegation = "(?:do not|don't|does not|doesn't|never|cannot|can't|won't|should not|must not)";
  const terms = {
    settings: "settings",
    privacy: "privacy",
    export: "export",
    zip: "download|save",
    extract: "extract|unzip",
  }[stage];
  if (terms) {
    const before = new RegExp(`\\b${verbNegation}\\b[^.!?]{0,60}\\b(?:${terms})\\b`, "i");
    const after = new RegExp(`\\b(?:${terms})\\b[^.!?]{0,40}\\b(?:cannot|can't|won't|is not|isn't|are not|aren't)\\b`, "i");
    if (before.test(clause) || after.test(clause)) return true;
  }
  if (stage === "email") {
    return /\b(?:do not|does not|doesn't|never|cannot|can't|won't|will not|should not|must not)\b[^.!?]{0,60}\b(?:email|send)\b[^.!?]{0,60}\blink\b/i.test(clause)
      || /\blink\b[^.!?]{0,40}\b(?:is not|isn't|was not|wasn't|never)\b[^.!?]{0,30}\b(?:email|sent)\b/i.test(clause)
      || /\b(?:no|without)\b[^.!?]{0,30}\b(?:email(?:ed)?|download)\b[^.!?]{0,30}\blink\b/i.test(clause);
  }
  if (stage === "conversation") {
    return /\b(?:do not|does not|never|cannot|can't)\b[^.!?]{0,60}\bconversations\.json\b/i.test(clause)
      || /\b(?:without|no)\b\s+(?:the\s+)?\bconversations\.json\b/i.test(clause);
  }
  return false;
}

function hasClaudeWebExportPath(modeData) {
  const entries = [modeData.hint, ...(modeData.steps || [])].map(textOnly);
  return entries.some((entry, index) => {
    const opensWebSettings = /(?:claude\.ai|web app|web browser|in a browser)[^.!?]{0,120}\bsettings\b/i.test(entry)
      && /\bclaude\.ai\b/i.test(entry);
    if (!opensWebSettings) return false;
    const tail = entries.slice(index).join(" ");
    const ordered = [
      { stage: "settings", pattern: /\bsettings\b/i },
      { stage: "privacy", pattern: /\bprivacy\b/i },
      { stage: "export", pattern: /\bexport(?: data)?\b/i },
      { stage: "email", pattern: /\bemail(?:ed|s)?\b[^.]{0,100}\b(?:download\s+)?link\b/i },
      { stage: "zip", pattern: /\b(?:download|save)\b[^.]{0,100}\bzip\b|\bzip\b[^.]{0,100}\b(?:download|save)\b/i },
      { stage: "extract", pattern: /\b(?:extract|unzip)\b/i },
      { stage: "conversation", pattern: /\bconversations\.json\b/i },
    ];
    let offset = 0;
    for (const requirement of ordered) {
      const match = requirement.pattern.exec(tail.slice(offset));
      if (!match) return false;
      const matchIndex = offset + match.index;
      const clause = sentenceAround(tail, matchIndex);
      if (requiredStepIsNegated(clause, requirement.stage)) return false;
      offset += match.index + match[0].length;
    }
    const route = tail.slice(0, offset);
    const desktopReferences = Array.from(route.matchAll(/\b(?:claude\s+)?desktop(?:\s+app)?\b/gi));
    if (desktopReferences.some((match) => {
      const sentence = sentenceAround(route, match.index);
      const affirmativeContext = /\b(?:switch|open|use|go|continue|move|in|from|inside|via)\b/i.test(sentence);
      const negatedContext = /\b(?:not|never|without|do not|don't)\b[^.!?]{0,50}\b(?:claude\s+)?desktop(?:\s+app)?\b/i.test(sentence);
      return affirmativeContext && !negatedContext;
    })) return false;
    return true;
  });
}

function copilotAcquisitionSurfaces(modes) {
  const card = /<button\b[^>]*\bdata-pilot-source="copilot"[^>]*>([\s\S]*?)<\/button>/i.exec(html);
  assert.ok(card, "guided Copilot card must exist");
  const panel = sourceBetween('id="pilotCopilotPanel"', 'id="pilotStatus"');
  const elements = Object.create(null);
  let runtimeStatus = "";
  const context = {
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = fakeElement();
        return elements[id];
      },
      querySelectorAll() { return []; },
    },
    PILOT_SOURCE: "",
    mode: "",
    selectedRoute: "",
    providerChosen: false,
    pilotPromptFor() { return ""; },
    pilotStatus(message) { runtimeStatus = String(message); },
    setJourney() {},
  };
  vm.runInNewContext(
    functionSource("pilotChooseSource", "pilotChooseMethod"),
    context,
  );
  context.pilotChooseSource("copilot");
  return {
    card: textOnly(card[1]),
    panel: textOnly(panel),
    status: runtimeStatus,
    route: [modes.copilot.hint, ...(modes.copilot.steps || [])].map(textOnly).join(" "),
  };
}

function statesCopilotEmailDelivery(copy) {
  const sentences = String(copy).split(/[.!?]+/).filter(Boolean);
  let affirmativeEmail = false;
  for (const sentence of sentences) {
    const delivery = /\bemails?\b[^.]{0,120}\b(?:download\s+)?link\b/i.test(sentence)
      || /\b(?:download\s+)?link\b[^.]{0,120}\bemail\b/i.test(sentence);
    const negatedDelivery = /\b(?:do not|does not|doesn't|never|cannot|can't|won't|will not|should not|must not)\b[^.]{0,70}\b(?:email|send)\b[^.]{0,70}\blink\b/i.test(sentence)
      || /\b(?:no|without)\b[^.]{0,30}\bemail\b/i.test(sentence);
    if (delivery && !negatedDelivery) affirmativeEmail = true;
    const immediate = /\b(?:straight\s+away|immediately|instant(?:ly)?|direct\s+download)\b/i.test(sentence);
    const deniedImmediate = /\b(?:do not|does not|doesn't|not|never|cannot|can't|won't)\b[^.]{0,60}\b(?:straight\s+away|immediately|instant(?:ly)?|direct\s+download)\b/i.test(sentence);
    if (immediate && !deniedImmediate && !delivery) return false;
  }
  return affirmativeEmail;
}

function hasManagedCopilotBoundary(copy) {
  const sentences = String(copy).split(/[.!?]+/);
  const personalAccess = sentences.some((sentence) => {
    const complete = /\b(?:personal|personally billed|individual)\b/i.test(sentence)
      && /\b(?:can|may|request|get|download|access)\b/i.test(sentence)
      && /\b(?:usage\s+)?report\b/i.test(sentence);
    const denied = /\b(?:cannot|can't|may not|must not|do not|does not|never)\b[^.!?]{0,50}\b(?:request|get|download|access)\b/i.test(sentence);
    const roleRestricted = /\b(?:request|get|download|access)\b[^.!?]{0,60}\b(?:only\s+(?:through|with|by)|requires?|needs?|must)\b[^.!?]{0,40}\b(?:owner|billing manager|billing administrator|billing role)\b/i.test(sentence)
      || /\b(?:only\s+(?:an?\s+)?|requires?\s+(?:an?\s+)?|needs?\s+(?:an?\s+)?)\b(?:owner|billing manager|billing administrator|billing role)\b[^.!?]{0,50}\b(?:request|get|download|access)\b/i.test(sentence);
    return complete && !denied && !roleRestricted;
  });
  if (!personalAccess) return false;
  return sentences.some((sentence) => {
    const managed = /\b(?:organization-managed|managed|organization|enterprise)\b/i.test(sentence);
    const role = "(?:owner|billing manager|billing administrator|billing role)";
    const action = "(?:request|get|download|access|generate|export)";
    const report = "(?:the\\s+)?usage report";
    const relation = new RegExp(
      `(?:requires?|required|needs?|must|only|ask|contact)[^.!?]{0,50}\\b${role}\\b[^.!?]{0,60}\\b${action}\\b[^.!?]{0,40}\\b${report}\\b`
        + `|\\b${role}\\b[^.!?]{0,40}(?:only|must|required|needs?|can)[^.!?]{0,40}\\b${action}\\b[^.!?]{0,40}\\b${report}\\b`
        + `|\\b${action}\\b[^.!?]{0,40}\\b${report}\\b[^.!?]{0,50}(?:requires?|required|needs?|must|ask|contact)[^.!?]{0,40}\\b${role}\\b`,
      "i",
    ).test(sentence);
    const negatedRole = /\b(?:no|not|without)\b[^,;]{0,60}\b(?:owner|billing manager|billing administrator|billing role)\b/i.test(sentence)
      || /\b(?:owner|billing manager|billing administrator|billing role)\b[^,;]{0,40}\b(?:not|required|needed)\b/i.test(sentence)
        && /\bnot\b/i.test(sentence);
    return managed && relation && !negatedRole;
  });
}

function copilotAcquisitionFailures(surfaces) {
  const failures = [];
  for (const [surface, copy] of Object.entries(surfaces)) {
    if (!statesCopilotEmailDelivery(copy)) {
      failures.push(`${surface} does not consistently state GitHub's emailed download-link route`);
    }
  }
  const combined = Object.values(surfaces).join(" ");
  if (!/\b(?:wait|expires?|expiry|24\s+hours?)\b/i.test(combined)) {
    failures.push("the email wait or link expiry is missing");
  }
  for (const surface of ["panel", "route"]) {
    if (!hasManagedCopilotBoundary(surfaces[surface])) {
      failures.push(`${surface} does not distinguish personal access from a managed-account billing-role restriction`);
    }
  }
  return failures;
}

async function exerciseConversationPreflight(fileSpecs) {
  const state = {
    progressStarted: false,
    readStarted: false,
    completed: false,
    completedFiles: 0,
    wholeFileReaderUsed: false,
    sliceReads: [],
    streamReads: [],
    texts: [],
    errors: [],
  };
  let settle;
  const settled = new Promise((resolve) => { settle = resolve; });
  function recordError(message) {
    state.errors.push(String(message));
    settle();
  }
  function markRead() {
    state.readStarted = true;
  }
  function syntheticBase(spec) {
    return JSON.stringify([{
      uuid: `synthetic-${spec.name}`,
      name: `Synthetic ${spec.name}`,
      chat_messages: [
        { sender: "human", text: "synthetic request" },
        { sender: "assistant", text: "synthetic response" },
      ],
    }]);
  }
  function syntheticPayloadRange(spec, requestedStart = 0, requestedEnd = spec.size) {
    const base = syntheticBase(spec);
    assert.ok(spec.size >= base.length, "virtual conversation fixture is too small for its JSON envelope");
    const head = base.slice(0, -1);
    const tailOffset = spec.size - 1;
    const start = Math.max(0, Math.min(spec.size, requestedStart));
    const end = Math.max(start, Math.min(spec.size, requestedEnd));
    const parts = [];
    const headStart = Math.max(start, 0);
    const headEnd = Math.min(end, head.length);
    if (headEnd > headStart) parts.push(head.slice(headStart, headEnd));
    const fillerStart = Math.max(start, head.length);
    const fillerEnd = Math.min(end, tailOffset);
    if (fillerEnd > fillerStart) parts.push(" ".repeat(fillerEnd - fillerStart));
    if (start <= tailOffset && end > tailOffset) parts.push("]");
    const text = parts.join("");
    assert.equal(text.length, end - start, "virtual fixture range must contain every declared byte");
    return text;
  }
  function syntheticPayload(spec) {
    return syntheticPayloadRange(spec, 0, spec.size);
  }
  function instrumentFile(spec, specIndex) {
    return {
      name: spec.name,
      size: spec.size,
      webkitRelativePath: spec.webkitRelativePath || "",
      wholeFile: true,
      arrayBuffer() {
        markRead();
        state.wholeFileReaderUsed = true;
        return Promise.resolve(new TextEncoder().encode(syntheticPayload(spec)).buffer);
      },
      text() { markRead(); state.wholeFileReaderUsed = true; return Promise.resolve(syntheticPayload(spec)); },
      slice(start = 0, end = spec.size) {
        markRead();
        const boundedStart = Math.max(0, Math.min(spec.size, start));
        const boundedEnd = Math.max(boundedStart, Math.min(spec.size, end));
        state.sliceReads.push({ specIndex, name: spec.name, start: boundedStart, end: boundedEnd });
        const text = syntheticPayloadRange(spec, boundedStart, boundedEnd);
        const bytes = new TextEncoder().encode(text);
        return {
          size: boundedEnd - boundedStart,
          wholeFile: false,
          arrayBuffer() { markRead(); return Promise.resolve(bytes.buffer.slice(0)); },
          text() { markRead(); return Promise.resolve(text); },
        };
      },
      stream() {
        const record = { specIndex, name: spec.name, chunks: 0, bytes: 0, done: false };
        state.streamReads.push(record);
        let offset = 0;
        const chunkBytes = 1024 * 1024;
        return {
          getReader() {
            return {
              read() {
                markRead();
                if (offset >= spec.size) {
                  record.done = true;
                  return Promise.resolve({ done: true });
                }
                const end = Math.min(spec.size, offset + chunkBytes);
                const value = new TextEncoder().encode(syntheticPayloadRange(spec, offset, end));
                offset = end;
                record.chunks++;
                record.bytes += value.byteLength;
                return Promise.resolve({ done: false, value });
              },
            };
          },
        };
      },
    };
  }
  class FakeFileReader {
    readAsText(blob) {
      markRead();
      if (blob.wholeFile) state.wholeFileReaderUsed = true;
      Promise.resolve(blob.text()).then((value) => {
        this.result = value;
        if (this.onload) this.onload({ target: this });
      }, (error) => {
        this.error = error;
        if (this.onerror) this.onerror(error);
      });
    }

    readAsArrayBuffer(blob) {
      markRead();
      if (blob.wholeFile) state.wholeFileReaderUsed = true;
      Promise.resolve(blob.arrayBuffer()).then((value) => {
        this.result = value;
        if (this.onload) this.onload({ target: this });
      }, (error) => {
        this.error = error;
        if (this.onerror) this.onerror(error);
      });
    }
  }
  const context = {
    window: { innerWidth: 1280 },
    navigator: { maxTouchPoints: 0 },
    document: { getElementById() { return fakeElement(); } },
    showErr: recordError,
    startAnalysisProgress() { state.progressStarted = true; return 1; },
    readTextFiles(files, done) {
      state.readStarted = true;
      const texts = new Array(files.length);
      let remaining = files.length;
      if (!remaining) { done([], 0); return; }
      files.forEach((file, index) => {
        const reader = new FakeFileReader();
        reader.onload = () => {
          texts[index] = String(reader.result || "");
          remaining--;
          if (!remaining) done(texts, 0);
        };
        reader.onerror = recordError;
        reader.readAsText(file);
      });
    },
    analysisJobIsCurrent() { return true; },
    switchToDetectedMode() {},
    run(texts, openedCount) {
      state.completed = true;
      state.completedFiles = openedCount;
      state.texts = Array.from(texts || []);
      settle();
    },
    analysisProgressSet() {},
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    FileReader: FakeFileReader,
    Promise,
    mode: "chat",
    Number,
    Array,
    String,
    Object,
    RegExp,
    Math,
  };
  const source = [
    sourceBetweenPatterns(html, /\bvar\s+HISTORY_LIMITS\s*=/, /function\s+inferModeFromFileNames\s*\(/),
    sourceBetween("function conversationRecords", "function parseChat"),
    sourceBetween("function openDetectedConversationFiles", "function finishParsedResult"),
  ].join("\n");
  vm.runInNewContext(source, context);
  context.showErr = recordError;
  Promise.resolve(context.openDetectedConversationFiles(fileSpecs.map(instrumentFile))).catch(recordError);
  let timeoutId;
  await Promise.race([
    settled,
    new Promise((resolve) => { timeoutId = setTimeout(() => { state.timedOut = true; resolve(); }, 10000); }),
  ]);
  clearTimeout(timeoutId);
  state.completePayloads = state.texts.map((text, index) => {
    if (text.length !== fileSpecs[index].size) return false;
    try {
      const parsed = JSON.parse(text);
      return parsed[0]?.uuid === `synthetic-${fileSpecs[index].name}`
        && parsed[0]?.chat_messages?.[1]?.text === "synthetic response";
    } catch (error) {
      return false;
    }
  });
  return state;
}

function slicesCoverFile(sliceReads, specIndex, size) {
  const reads = sliceReads
    .filter((read) => read.specIndex === specIndex)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let coveredThrough = 0;
  for (const read of reads) {
    if (read.start > coveredThrough || read.end <= read.start || read.end - read.start > 16 * 1024 * 1024) return false;
    coveredThrough = Math.max(coveredThrough, read.end);
  }
  return reads.length >= 2 && coveredThrough >= size;
}

function streamCoversFile(streamReads, specIndex, size) {
  return streamReads.some((read) => read.specIndex === specIndex
    && read.done && read.bytes === size && read.chunks >= 2);
}

test("the guided Codex folder path deliberately offers active and archived sessions", () => {
  assert.equal(offersBothCodexRoots(
    "Choose %USERPROFILE%\\.codex\\sessions, then add %USERPROFILE%\\.codex\\archived_sessions. TOP combines both folders.",
  ), true, "two actionable Codex roots must satisfy the contract");
  assert.equal(offersBothCodexRoots(
    "Choose %USERPROFILE%\\.codex\\sessions or %USERPROFILE%\\.codex\\archived_sessions.",
  ), false, "an either-or choice must not satisfy the both-roots contract");
  assert.equal(offersBothCodexRoots(
    "Do not choose %USERPROFILE%\\.codex\\sessions. Choose %USERPROFILE%\\.codex\\archived_sessions.",
  ), false, "a negated active path must not satisfy the contract");
  assert.equal(offersBothCodexRoots(
    "Choose %USERPROFILE%\\.codex\\sessions. %USERPROFILE%\\.codex\\archived_sessions is supported.",
  ), false, "mentioning an archive path without an action must not satisfy the contract");
  assert.equal(offersBothCodexRoots(
    "Choose %USERPROFILE%\\.codex\\sessions. %USERPROFILE%\\.codex\\archived_sessions is unsupported.",
  ), false, "a rejected archive path must not satisfy the contract");
  assert.equal(offersBothCodexRoots(
    "Choose %USERPROFILE%\\.codex\\sessions and if it is unavailable choose %USERPROFILE%\\.codex\\archived_sessions.",
  ), false, "a fallback choice must not satisfy the both-roots contract");
  assert.equal(offersBothCodexRoots(
    "Read both %USERPROFILE%\\.codex\\sessions and %USERPROFILE%\\.codex\\archived_sessions. Do not choose auth.json or the whole folder.",
  ), true, "a trailing safety warning must not be mistaken for an either-or root choice");

  assert.deepEqual(executeCollectorCodexRoots(), [
    "C:\\SyntheticProfile\\.codex\\sessions",
    "C:\\SyntheticProfile\\.codex\\archived_sessions",
  ], "the executed collector route must return exactly the active and archived Codex roots");
  const panelCopy = guidedCodexFolderCopy();
  const collectorPrompt = codexCollectorPrompt();
  const failures = [];
  if (!panelPinsCollectorBothRoots(panelCopy)) failures.push(`guided folder panel does not tie both roots to the verified collector route: ${panelCopy}`);
  if (!offersBothCodexRoots(collectorPrompt)) failures.push("collector prompt does not explicitly request both Codex roots");
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("Claude Chat gives a complete browser export path as well as a desktop path", () => {
  assert.equal(hasClaudeWebExportPath({
    hint: "Claude works on claude.ai or in the desktop app.",
    steps: ["Open Settings in the desktop app.", "Choose Privacy.", "Export Data."],
  }), false, "a generic web mention must not excuse desktop-only steps");
  assert.equal(hasClaudeWebExportPath({
    hint: "On claude.ai in a browser, open Settings.",
    steps: ["Choose Privacy.", "Choose Export Data."],
  }), false, "request steps without email retrieval must not satisfy the contract");
  assert.equal(hasClaudeWebExportPath({
    hint: "On claude.ai in a browser, open Settings.",
    steps: ["Choose Privacy, then Export Data.", "Anthropic does not email a download link.", "Download the ZIP, extract it, and choose conversations.json."],
  }), false, "a negated email step must not satisfy the contract");
  assert.equal(hasClaudeWebExportPath({
    hint: "On claude.ai in a browser, open Settings.",
    steps: ["Now switch to the Claude desktop app, choose Privacy, then Export Data.", "Anthropic emails a download link.", "Download the ZIP, extract it, and choose conversations.json."],
  }), false, "a route that switches to the desktop app must not count as a web route");
  assert.equal(hasClaudeWebExportPath({
    hint: "On claude.ai in a browser, open Settings.",
    steps: ["In the Claude desktop app, choose Privacy, then Export Data.", "Anthropic emails a download link.", "Download the ZIP, extract it, and choose conversations.json."],
  }), false, "desktop-app context must not count as continuation of the web route");
  assert.equal(hasClaudeWebExportPath({
    hint: "On claude.ai in a browser, open Settings.",
    steps: ["Choose Privacy, then Export Data.", "Anthropic will not email a download link.", "Download the ZIP, extract it, and choose conversations.json."],
  }), false, "will-not email wording must not satisfy the route");
  assert.equal(hasClaudeWebExportPath({
    hint: "On claude.ai in a browser, open Settings.",
    steps: ["Choose Privacy, then Export Data.", "Anthropic emails a download link.", "Use the link to download the ZIP, extract it, and choose conversations.json."],
  }), true, "the complete browser request and retrieval route must satisfy the contract");
  assert.equal(hasClaudeWebExportPath({
    hint: "On claude.ai in a browser, open Settings.",
    steps: ["Choose Privacy, then Export Data.", "Anthropic emails a download link.", "Download the ZIP without uploading it, extract it, and choose conversations.json."],
  }), true, "privacy reassurance must not be mistaken for a negated download step");

  const modes = loadModes();
  assert.equal(hasClaudeWebExportPath(modes.chat), true,
    "Claude Chat promises browser support but does not give a complete claude.ai Settings, Privacy, Export Data route");
});

test("Copilot acquisition copy is consistent about delivery and managed-license eligibility", () => {
  const managed = "Personally billed users can request the report. Organization-managed accounts require an owner or billing manager to request the usage report.";
  const complete = {
    card: "GitHub emails a download link.",
    panel: `GitHub emails a download link. ${managed}`,
    status: "GitHub emails a download link.",
    route: `GitHub emails a download link that expires after 24 hours. ${managed}`,
  };
  assert.deepEqual(copilotAcquisitionFailures(complete), [], "complete copy on every acquisition surface must satisfy the contract");
  assert.ok(copilotAcquisitionFailures({
    ...complete,
    card: "The CSV downloads straight away with no email wait.",
  }).some((failure) => /^card /.test(failure)), "a contradictory card must fail");
  assert.ok(copilotAcquisitionFailures({
    ...complete,
    panel: "GitHub emails a download link. Personal and organization usage is supported. No billing manager is required for the usage report.",
  }).some((failure) => /^panel /.test(failure)), "a negated managed-account boundary must fail");
  assert.equal(statesCopilotEmailDelivery("GitHub does not email a download link."), false,
    "a negated email route must not satisfy delivery");
  assert.equal(statesCopilotEmailDelivery("GitHub will not email a download link."), false,
    "will-not email wording must not satisfy delivery");
  assert.equal(statesCopilotEmailDelivery("GitHub does not send the report immediately. GitHub emails a download link."), true,
    "denying direct delivery before stating the email route must satisfy delivery");
  assert.equal(hasManagedCopilotBoundary(
    "Personal users cannot request the report. Organization-managed accounts require an owner to request the usage report.",
  ), false, "denied personal access must not satisfy the account boundary");
  assert.equal(hasManagedCopilotBoundary(
    "Personal usage report. Managed account owner billing role request usage report.",
  ), false, "unrelated eligibility terms must not satisfy the account boundary");
  assert.equal(hasManagedCopilotBoundary(
    "Personal users can request the usage report without an owner. Organization-managed accounts require a billing manager to request the usage report.",
  ), true, "personal access without a role and a related managed role must satisfy the boundary");
  assert.equal(hasManagedCopilotBoundary(
    "Personal users can request the usage report only through an owner. Organization-managed accounts require a billing manager to request the usage report.",
  ), false, "a role restriction on personal access must not satisfy the boundary");
  assert.equal(hasManagedCopilotBoundary(
    "Personal users can request the usage report. For managed accounts, contact the owner with questions; a usage report exists.",
  ), false, "managed role and report terms without an access action must not satisfy the boundary");

  const failures = copilotAcquisitionFailures(copilotAcquisitionSurfaces(loadModes()));
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("official-name conversation files above the current limits require a complete bounded-read path", async () => {
  const smallControl = await exerciseConversationPreflight([{ name: "conversations.json", size: 1024 }]);
  assert.equal(smallControl.progressStarted, true, "the control must start visible progress");
  assert.equal(smallControl.readStarted, true, "the control must reach a reader");
  assert.equal(smallControl.completed, true, "the control must reach the analysis callback");
  assert.equal(smallControl.completedFiles, 1, "the control must preserve its selected-file count");
  assert.deepEqual(smallControl.completePayloads, [true], "the control must preserve every byte of its synthetic conversation payload");
  assert.deepEqual(smallControl.errors, [], "the control must not emit a terminal error");

  const scenarios = [
    {
      label: "one official conversations.json above 64 MiB",
      files: [{ name: "conversations.json", size: 64 * 1024 * 1024 + 1 }],
    },
    {
      label: "numbered conversation files individually below 64 MiB but above it in aggregate",
      files: [
        { name: "conversations_1.json", size: 40 * 1024 * 1024 },
        { name: "conversations_2.json", size: 40 * 1024 * 1024 },
      ],
    },
  ];
  const failures = [];
  for (const scenario of scenarios) {
    const result = await exerciseConversationPreflight(scenario.files);
    if (!result.progressStarted) failures.push(`${scenario.label} never started visible progress`);
    if (!result.readStarted) failures.push(`${scenario.label} never reached a local file reader`);
    if (!result.completed) failures.push(`${scenario.label} did not reach the analysis callback`);
    if (result.completedFiles !== scenario.files.length) failures.push(`${scenario.label} did not preserve its selected-file count`);
    if (result.completePayloads.length !== scenario.files.length || result.completePayloads.some((complete) => !complete)) {
      failures.push(`${scenario.label} did not reconstruct every declared byte into valid synthetic conversation JSON`);
    }
    if (result.errors.length) failures.push(`${scenario.label} emitted a terminal error: ${result.errors.join(" ")}`);
    if (result.wholeFileReaderUsed) failures.push(`${scenario.label} used the whole-file reader instead of bounded local reads`);
    for (let specIndex = 0; specIndex < scenario.files.length; specIndex++) {
      const covered = slicesCoverFile(result.sliceReads, specIndex, scenario.files[specIndex].size)
        || streamCoversFile(result.streamReads, specIndex, scenario.files[specIndex].size);
      if (!covered) failures.push(`${scenario.label} did not cover ${scenario.files[specIndex].name} through bounded local reads`);
    }
  }
  // A future splitter is acceptable only with a behavioral fixture-equivalence,
  // incremental-read and no-network contract. A control label alone is not proof.
  assert.deepEqual(failures, [], failures.join("\n"));
});
