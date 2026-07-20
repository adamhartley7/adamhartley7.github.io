import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COLLECTOR_VERSION,
  MAX_LINE_CHARS,
  PARSER_VERSION,
  SCHEMA_VERSION,
  collectUsage,
  sanitizeModelLabel,
  validateSafeReport,
} from "./top-collector.mjs";

const PRIVATE = "PRIVATE_SENTINEL_MUST_NOT_LEAK_839204";
const directory = path.dirname(fileURLToPath(import.meta.url));
const collectorPath = path.join(directory, "top-collector.mjs");

function claudeLine({
  messageId,
  requestId,
  sessionId = "private-session-1",
  timestamp = "2026-07-15T09:00:00.123Z",
  model = "claude-opus-4-8-20260716",
  input = 100,
  output = 10,
  cacheWrite = 5,
  cacheRead = 20,
} = {}) {
  const record = {
    type: "assistant",
    sessionId,
    timestamp,
    cwd: `C:\\${PRIVATE}`,
    prompt: PRIVATE,
    tool_output: PRIVATE,
    message: {
      model,
      content: [{ type: "text", text: PRIVATE }],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheWrite,
        cache_read_input_tokens: cacheRead,
      },
    },
  };
  if (messageId !== undefined) record.message.id = messageId;
  if (requestId !== undefined) record.requestId = requestId;
  return JSON.stringify(record);
}

function codexUsage(input, cached, output, reasoning, total = input + output) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total,
  };
}

function codexLine(timestamp, type, payload) {
  return JSON.stringify({ timestamp, type, payload, private: PRIVATE });
}

function codexToken(timestamp, total, last = total) {
  return codexLine(timestamp, "event_msg", {
    type: "token_count",
    info: { total_token_usage: total, last_token_usage: last },
    rate_limits: { account: PRIVATE, credits: PRIVATE },
  });
}

function codexRollout(sessionId, totals, { model = "gpt-5.6-sol-20260716", startSecond = 0 } = {}) {
  const lines = [
    codexLine("2026-07-15T09:00:00Z", "session_meta", { id: sessionId, cwd: PRIVATE }),
    codexLine("2026-07-15T09:00:01Z", "turn_context", { model }),
  ];
  totals.forEach((total, index) => {
    lines.push(codexToken(new Date(Date.UTC(2026, 6, 15, 9, 0, startSecond + index + 2)).toISOString(), total));
  });
  return lines.join("\n");
}

function model(report, label) {
  const row = report.by_model.find(item => item.model === label);
  assert.ok(row, `missing model ${label}`);
  return row;
}

async function makeClaudeFixture(root) {
  const first = path.join(root, "project-private-a");
  const second = path.join(root, `project-${PRIVATE}`);
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });
  await writeFile(path.join(first, "private-first.jsonl"), [
    claudeLine({ messageId: `msg-${PRIVATE}`, requestId: "request-1", output: 10, cacheWrite: 3 }),
    claudeLine({ messageId: `msg-${PRIVATE}`, requestId: "request-1", output: 25, cacheWrite: 8 }),
    claudeLine({ messageId: "hostile-message", requestId: "hostile-request", model: `<img src=${PRIVATE}>`, input: 7, output: 3, cacheWrite: 0, cacheRead: 0 }),
    claudeLine({ messageId: undefined, requestId: undefined, input: 2, output: 1, cacheWrite: 0, cacheRead: 0 }),
    claudeLine({ messageId: "zero", requestId: "zero", input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }),
    `{not-json-${PRIVATE}`,
    claudeLine({ messageId: "invalid", requestId: "invalid", input: "not-a-count" }),
  ].join("\n"), "utf8");
  await writeFile(path.join(second, "private-second.jsonl"), [
    claudeLine({ messageId: `msg-${PRIVATE}`, requestId: "request-1", sessionId: "private-session-2", timestamp: "2026-07-16T10:00:00.999Z", output: 31, cacheWrite: 6 }),
    claudeLine({ messageId: "haiku-message", requestId: "haiku-request", sessionId: "private-session-2", timestamp: "2026-07-16T10:01:00Z", model: "claude-4-5-haiku-20260716", input: 11, output: 5, cacheWrite: 2, cacheRead: 4 }),
  ].join("\n"), "utf8");
}

async function makeCodexFixture(root) {
  await mkdir(path.join(root, "nested"), { recursive: true });
  const fixture = [
    codexLine("2026-07-15T09:00:00Z", "session_meta", { id: PRIVATE, cwd: `C:\\${PRIVATE}` }),
    codexLine("2026-07-15T09:00:01Z", "response_item", { role: "user", content: PRIVATE }),
    codexLine("2026-07-15T09:00:02Z", "turn_context", { model: "gpt-5.6-sol-20260716", cwd: PRIVATE }),
    codexToken("2026-07-15T09:00:03Z", codexUsage(100, 40, 20, 5)),
    codexToken("2026-07-15T09:00:04Z", codexUsage(100, 40, 20, 5)),
    codexToken("2026-07-15T09:00:05Z", codexUsage(150, 50, 30, 8), codexUsage(50, 10, 10, 3)),
    codexLine("2026-07-16T10:00:00Z", "turn_context", { model: "o3-preview", turn_id: PRIVATE }),
    codexToken("2026-07-16T10:00:01Z", codexUsage(170, 60, 40, 10), codexUsage(20, 10, 10, 2)),
    codexToken("2026-07-16T10:00:02Z", codexUsage(10, 2, 4, 1), codexUsage(10, 2, 4, 1)),
  ].join("\n");
  await writeFile(path.join(root, "nested", "rollout-private.jsonl"), fixture, "utf8");
  await writeFile(path.join(root, "malformed-only.jsonl"), `{malformed-${PRIVATE}`, "utf8");
  const oversizedContext = JSON.stringify({
    padding_before: "x".repeat(MAX_LINE_CHARS),
    timestamp: "2026-07-16T10:59:58Z",
    type: "turn_context",
    payload: { model: "gpt-5.6-terra", private: PRIVATE },
  });
  const oversizedIrrelevant = JSON.stringify({
    timestamp: "2026-07-16T10:59:59Z",
    type: "response_item",
    payload: { content: `${PRIVATE} \\\"type\\\":\\\"token_count\\\" ${"x".repeat(MAX_LINE_CHARS)}` },
  });
  const oversizedSupportedUsage = JSON.stringify({
    timestamp: "2026-07-16T11:00:00Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: codexUsage(1_000_000, 0, 10, 0),
        last_token_usage: codexUsage(1_000_000, 0, 10, 0),
      },
    },
    private: PRIVATE,
    padding: "x".repeat(MAX_LINE_CHARS),
  });
  await writeFile(path.join(root, `oversized-${PRIVATE}.jsonl`), [
    JSON.stringify({ padding_before: "x".repeat(MAX_LINE_CHARS), timestamp: "2026-07-16T10:59:57Z", type: "session_meta", payload: { id: `oversized-session-${PRIVATE}` } }),
    oversizedContext,
    oversizedIrrelevant,
    oversizedSupportedUsage,
  ].join("\n") + "\n", "utf8");
}

function assertPrivacy(report) {
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, new RegExp(PRIVATE));
  for (const denied of ["private-session", "msg-", "request-", "cwd", "prompt", "tool_output", "rate_limits", "credits", "private-first", "private-second", "rollout-private"]) {
    assert.doesNotMatch(text, new RegExp(denied, "i"));
  }
}

function assertFrozenSchema(report) {
  assert.deepEqual(Object.keys(report), ["schema_version", "collector_version", "parser_version", "generated_date", "source", "coverage", "totals", "activity", "by_model"]);
  assert.equal(report.schema_version, SCHEMA_VERSION);
  assert.equal(report.collector_version, COLLECTOR_VERSION);
  assert.equal(report.parser_version, PARSER_VERSION);
  assert.deepEqual(Object.keys(report.source), ["provider", "surface"]);
  assert.deepEqual(Object.keys(report.coverage), ["files_discovered", "files_parsed", "files_with_usage", "files_skipped", "malformed_lines", "oversized_lines", "counter_resets", "duplicate_usage_records", "complete"]);
  assert.deepEqual(Object.keys(report.totals), ["input_tokens", "cache_write_input_tokens", "cache_read_input_tokens", "output_tokens", "reasoning_output_tokens", "usage_records", "total_tokens"]);
  assert.deepEqual(Object.keys(report.activity), ["sessions", "active_days"]);
  for (const row of report.by_model) {
    assert.deepEqual(Object.keys(row), ["model", "input_tokens", "cache_write_input_tokens", "cache_read_input_tokens", "output_tokens", "reasoning_output_tokens", "usage_records", "total_tokens"]);
  }
  assert.equal(validateSafeReport(report), true);
}

const temp = await mkdtemp(path.join(tmpdir(), `top-collector-test-${PRIVATE}-`));
try {
  const claudeRoot = path.join(temp, "claude");
  await makeClaudeFixture(claudeRoot);
  const claude = await collectUsage({ source: "claude-code", roots: [claudeRoot] });
  assertFrozenSchema(claude);
  assertPrivacy(claude);
  assert.deepEqual(claude.source, { provider: "anthropic", surface: "claude_code" });
  assert.deepEqual(claude.coverage, {
    files_discovered: 2,
    files_parsed: 2,
    files_with_usage: 2,
    files_skipped: 0,
    malformed_lines: 2,
    oversized_lines: 0,
    counter_resets: 0,
    duplicate_usage_records: 2,
    complete: false,
  });
  assert.deepEqual(claude.activity, { sessions: 2, active_days: 2 });
  assert.deepEqual(model(claude, "claude-opus-4-8"), {
    model: "claude-opus-4-8",
    input_tokens: 102,
    cache_write_input_tokens: 8,
    cache_read_input_tokens: 20,
    output_tokens: 32,
    reasoning_output_tokens: 0,
    usage_records: 2,
    total_tokens: 162,
  });
  assert.deepEqual(model(claude, "claude-4-5-haiku"), {
    model: "claude-4-5-haiku",
    input_tokens: 11,
    cache_write_input_tokens: 2,
    cache_read_input_tokens: 4,
    output_tokens: 5,
    reasoning_output_tokens: 0,
    usage_records: 1,
    total_tokens: 22,
  });
  assert.deepEqual(model(claude, "Unrecognized AI version"), {
    model: "Unrecognized AI version",
    input_tokens: 7,
    cache_write_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 3,
    reasoning_output_tokens: 0,
    usage_records: 1,
    total_tokens: 10,
  });
  assert.deepEqual(claude.totals, {
    input_tokens: 120,
    cache_write_input_tokens: 10,
    cache_read_input_tokens: 24,
    output_tokens: 40,
    reasoning_output_tokens: 0,
    usage_records: 4,
    total_tokens: 194,
  });

  const codexRoot = path.join(temp, "codex");
  await makeCodexFixture(codexRoot);
  const codex = await collectUsage({ source: "codex", roots: [codexRoot] });
  assertFrozenSchema(codex);
  assertPrivacy(codex);
  assert.deepEqual(codex.source, { provider: "openai", surface: "codex" });
  assert.deepEqual(codex.coverage, {
    files_discovered: 3,
    files_parsed: 2,
    files_with_usage: 2,
    files_skipped: 1,
    malformed_lines: 1,
    oversized_lines: 0,
    counter_resets: 1,
    duplicate_usage_records: 1,
    complete: false,
  });
  assert.deepEqual(codex.activity, { sessions: 2, active_days: 2 });
  assert.deepEqual(model(codex, "gpt-5.6-sol"), {
    model: "gpt-5.6-sol",
    input_tokens: 100,
    cache_write_input_tokens: 0,
    cache_read_input_tokens: 50,
    output_tokens: 30,
    reasoning_output_tokens: 8,
    usage_records: 2,
    total_tokens: 180,
  });
  assert.deepEqual(model(codex, "o3-preview"), {
    model: "o3-preview",
    input_tokens: 18,
    cache_write_input_tokens: 0,
    cache_read_input_tokens: 12,
    output_tokens: 14,
    reasoning_output_tokens: 3,
    usage_records: 2,
    total_tokens: 44,
  });
  assert.deepEqual(model(codex, "gpt-5.6-terra"), {
    model: "gpt-5.6-terra",
    input_tokens: 1_000_000,
    cache_write_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 10,
    reasoning_output_tokens: 0,
    usage_records: 1,
    total_tokens: 1_000_010,
  });
  assert.deepEqual(codex.totals, {
    input_tokens: 1_000_118,
    cache_write_input_tokens: 0,
    cache_read_input_tokens: 62,
    output_tokens: 54,
    reasoning_output_tokens: 11,
    usage_records: 5,
    total_tokens: 1_000_234,
  });

  const unresolvedOversizedRoot = path.join(temp, "codex-unresolved-oversized");
  await mkdir(unresolvedOversizedRoot, { recursive: true });
  await writeFile(path.join(unresolvedOversizedRoot, "truncated.jsonl"), [
    codexLine("2026-07-16T12:00:00Z", "session_meta", { id: "truncated-session" }),
    '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1},"private":"' + "x".repeat(MAX_LINE_CHARS),
    codexLine("2026-07-16T12:00:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T12:00:02Z", codexUsage(10, 0, 2, 0)),
  ].join("\n"), "utf8");
  await writeFile(path.join(unresolvedOversizedRoot, "clean.jsonl"), [
    codexLine("2026-07-16T12:10:00Z", "session_meta", { id: "clean-after-truncated" }),
    codexLine("2026-07-16T12:10:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T12:10:02Z", codexUsage(7, 0, 1, 0)),
  ].join("\n"), "utf8");
  const unresolvedOversized = await collectUsage({ source: "codex", roots: [unresolvedOversizedRoot] });
  assert.equal(unresolvedOversized.coverage.files_discovered, 2);
  assert.equal(unresolvedOversized.coverage.files_parsed, 1);
  assert.equal(unresolvedOversized.coverage.files_skipped, 1);
  assert.equal(unresolvedOversized.coverage.oversized_lines, 1);
  assert.equal(unresolvedOversized.coverage.complete, false);
  assert.equal(unresolvedOversized.totals.usage_records, 1);
  assert.equal(unresolvedOversized.totals.input_tokens, 7,
    "a file with an unclassifiable oversized record must contribute no totals");

  const adversarialOversizedRoot = path.join(temp, "codex-adversarial-oversized");
  await mkdir(adversarialOversizedRoot, { recursive: true });
  const largePadding = "x".repeat(MAX_LINE_CHARS);
  const duplicateInfo = '{"timestamp":"2026-07-16T14:00:02Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":1000}},"info":{}},"padding":"' + largePadding + '"}';
  const nonFiniteCounter = '{"timestamp":"2026-07-16T14:00:05Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1e309,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":1e309}}},"padding":"' + largePadding + '"}';
  const duplicatePayload = '{"timestamp":"2026-07-16T14:00:11Z","type":"turn_context","payload":{"model":"gpt-5.6-sol"},"padding":"' + largePadding + '","payload":{}}';
  const unresolvedLongModel = JSON.stringify({
    timestamp: "2026-07-16T14:00:14Z",
    type: "turn_context",
    payload: { model: "x".repeat(2048) },
    padding: largePadding,
  });
  await writeFile(path.join(adversarialOversizedRoot, "adversarial.jsonl"), [
    codexLine("2026-07-16T14:00:00Z", "session_meta", { id: "adversarial-session" }),
    codexLine("2026-07-16T14:00:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T14:00:01.500Z", codexUsage(10, 0, 0, 0)),
    duplicateInfo,
    codexToken("2026-07-16T14:00:03Z", codexUsage(20, 0, 0, 0)),
    codexLine("2026-07-16T14:00:04Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T14:00:04.500Z", codexUsage(30, 0, 0, 0)),
    nonFiniteCounter,
    codexToken("2026-07-16T14:00:06Z", codexUsage(40, 0, 0, 0)),
    codexLine("2026-07-16T14:00:07Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T14:00:07.500Z", codexUsage(50, 0, 0, 0)),
    codexLine("2026-07-16T14:00:10Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T14:00:10.500Z", codexUsage(50, 0, 0, 0)),
    duplicatePayload,
    codexToken("2026-07-16T14:00:12Z", codexUsage(60, 0, 0, 0)),
    codexLine("2026-07-16T14:00:13Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T14:00:13.500Z", codexUsage(70, 0, 0, 0)),
    unresolvedLongModel,
    codexToken("2026-07-16T14:00:15Z", codexUsage(80, 0, 0, 0)),
  ].join("\n"), "utf8");
  const adversarialOversized = await collectUsage({ source: "codex", roots: [adversarialOversizedRoot] });
  assert.equal(adversarialOversized.coverage.oversized_lines, 3);
  assert.equal(adversarialOversized.coverage.complete, false);
  assert.equal(adversarialOversized.totals.input_tokens, 80,
    "superseded and non-finite projected counters must never enter trusted totals");
  assert.equal(model(adversarialOversized, "gpt-5.6-sol").input_tokens, 40);
  assert.equal(model(adversarialOversized, "Unrecognized AI version").input_tokens, 40,
    "usage after unresolved or superseded model context must not inherit a stale known rate");

  const uncertainOversizedRoot = path.join(temp, "codex-uncertain-oversized");
  await mkdir(uncertainOversizedRoot, { recursive: true });
  const invalidWhitespace = '{"timestamp":"2026-07-16T14:20:02Z","type":"turn_context",\f"payload":{"model":"gpt-5.6-sol"},"padding":"' + largePadding + '"}';
  const tooDeepSessionMeta = '{"nested":' + "[".repeat(129) + "0" + "]".repeat(129) + ',"padding":"' + largePadding + '","type":"session_meta","payload":{"id":"second-session"}}';
  await writeFile(path.join(uncertainOversizedRoot, "clean.jsonl"), [
    codexLine("2026-07-16T14:10:00Z", "session_meta", { id: "uncertain-clean-session" }),
    codexLine("2026-07-16T14:10:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T14:10:02Z", codexUsage(9, 0, 0, 0)),
  ].join("\n"), "utf8");
  await writeFile(path.join(uncertainOversizedRoot, "invalid-whitespace.jsonl"), [
    codexLine("2026-07-16T14:20:00Z", "session_meta", { id: "invalid-whitespace-session" }),
    codexLine("2026-07-16T14:20:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T14:20:01.500Z", codexUsage(10, 0, 0, 0)),
    invalidWhitespace,
    codexToken("2026-07-16T14:20:03Z", codexUsage(20, 0, 0, 0)),
  ].join("\n"), "utf8");
  await writeFile(path.join(uncertainOversizedRoot, "deep-before-session.jsonl"), [
    codexLine("2026-07-16T14:30:00Z", "session_meta", { id: "first-session" }),
    codexLine("2026-07-16T14:30:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T14:30:01.500Z", codexUsage(10, 0, 0, 0)),
    tooDeepSessionMeta,
    codexToken("2026-07-16T14:30:03Z", codexUsage(20, 0, 0, 0)),
  ].join("\n"), "utf8");
  const uncertainOversized = await collectUsage({ source: "codex", roots: [uncertainOversizedRoot] });
  assert.equal(uncertainOversized.coverage.files_discovered, 3);
  assert.equal(uncertainOversized.coverage.files_parsed, 1);
  assert.equal(uncertainOversized.coverage.files_skipped, 2);
  assert.equal(uncertainOversized.coverage.oversized_lines, 2);
  assert.equal(uncertainOversized.coverage.complete, false);
  assert.equal(uncertainOversized.totals.input_tokens, 9,
    "classification-incomplete oversized records must exclude the whole file from deduplication");

  const numericSessionRoot = path.join(temp, "codex-oversized-session-numeric");
  await mkdir(numericSessionRoot, { recursive: true });
  await writeFile(path.join(numericSessionRoot, "numeric.jsonl"), [
    codexLine("2026-07-16T15:00:00Z", "session_meta", { id: "first-session" }),
    '{"type":"session_meta","payload":{"id":12345},"padding":"' + largePadding + '"}',
    codexLine("2026-07-16T15:00:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T15:00:02Z", codexUsage(10, 0, 0, 0)),
  ].join("\n"), "utf8");
  await assert.rejects(
    collectUsage({ source: "codex", roots: [numericSessionRoot] }),
    /no single stable session identity/,
    "a conflicting oversized numeric session ID must stop deduplication",
  );

  const longSessionRoot = path.join(temp, "codex-oversized-session-long");
  await mkdir(longSessionRoot, { recursive: true });
  await writeFile(path.join(longSessionRoot, "long.jsonl"), [
    codexLine("2026-07-16T15:10:00Z", "session_meta", { id: "first-session" }),
    JSON.stringify({ type: "session_meta", payload: { id: "x".repeat(2048) }, padding: largePadding }),
    codexLine("2026-07-16T15:10:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T15:10:02Z", codexUsage(10, 0, 0, 0)),
  ].join("\n"), "utf8");
  await writeFile(path.join(longSessionRoot, "clean.jsonl"), [
    codexLine("2026-07-16T15:20:00Z", "session_meta", { id: "long-session-clean" }),
    codexLine("2026-07-16T15:20:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T15:20:02Z", codexUsage(9, 0, 0, 0)),
  ].join("\n"), "utf8");
  const longSessionReport = await collectUsage({ source: "codex", roots: [longSessionRoot] });
  assert.equal(longSessionReport.coverage.files_parsed, 1);
  assert.equal(longSessionReport.coverage.files_skipped, 1);
  assert.equal(longSessionReport.coverage.oversized_lines, 1);
  assert.equal(longSessionReport.totals.input_tokens, 9,
    "an unresolved oversized session ID must exclude the whole file");

  for (const [name, secondSessionMeta] of [
    ["ordinary", codexLine("2026-07-16T15:30:01Z", "session_meta", {})],
    ["projected", '{"type":"session_meta","payload":{"id":"superseded"},"padding":"' + largePadding + '","payload":{}}'],
  ]) {
    const root = path.join(temp, `codex-missing-session-${name}`);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, `${name}.jsonl`), [
      codexLine("2026-07-16T15:30:00Z", "session_meta", { id: "first-session" }),
      secondSessionMeta,
      codexLine("2026-07-16T15:30:02Z", "turn_context", { model: "gpt-5.6-sol" }),
      codexToken("2026-07-16T15:30:03Z", codexUsage(10, 0, 0, 0)),
    ].join("\n"), "utf8");
    await assert.rejects(
      collectUsage({ source: "codex", roots: [root] }),
      /no single stable session identity/,
      `a ${name} session_meta record without an ID must stop deduplication`,
    );
  }

  const malformedContextRoot = path.join(temp, "codex-malformed-context");
  await mkdir(malformedContextRoot, { recursive: true });
  await writeFile(path.join(malformedContextRoot, "malformed.jsonl"), [
    codexLine("2026-07-16T16:00:00Z", "session_meta", { id: "malformed-context-session" }),
    codexLine("2026-07-16T16:00:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T16:00:02Z", codexUsage(10, 0, 0, 0)),
    '{"type":"turn_context","payload":{"model":',
    codexToken("2026-07-16T16:00:03Z", codexUsage(20, 0, 0, 0)),
  ].join("\n"), "utf8");
  await writeFile(path.join(malformedContextRoot, "clean.jsonl"), [
    codexLine("2026-07-16T16:10:00Z", "session_meta", { id: "malformed-context-clean" }),
    codexLine("2026-07-16T16:10:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T16:10:02Z", codexUsage(9, 0, 0, 0)),
  ].join("\n"), "utf8");
  const malformedContextReport = await collectUsage({ source: "codex", roots: [malformedContextRoot] });
  assert.equal(malformedContextReport.coverage.malformed_lines, 1);
  assert.equal(malformedContextReport.coverage.files_parsed, 1);
  assert.equal(malformedContextReport.coverage.files_skipped, 1);
  assert.equal(model(malformedContextReport, "gpt-5.6-sol").input_tokens, 9);
  assert.equal(malformedContextReport.by_model.some(row => row.model === "Unrecognized AI version"), false,
    "a file with malformed possible identity context must contribute no attribution or totals");

  const invalidCounterTypeRoot = path.join(temp, "codex-invalid-counter-type");
  await mkdir(invalidCounterTypeRoot, { recursive: true });
  const invalidCounterUsage = { ...codexUsage(10, 0, 0, 0), cached_input_tokens: null, reasoning_output_tokens: "0" };
  await writeFile(path.join(invalidCounterTypeRoot, "invalid.jsonl"), [
    codexLine("2026-07-16T17:00:00Z", "session_meta", { id: "invalid-counter-session" }),
    codexLine("2026-07-16T17:00:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-16T17:00:02Z", invalidCounterUsage),
    codexToken("2026-07-16T17:00:03Z", codexUsage(10, 0, 0, 0)),
  ].join("\n"), "utf8");
  const invalidCounterTypeReport = await collectUsage({ source: "codex", roots: [invalidCounterTypeRoot] });
  assert.equal(invalidCounterTypeReport.totals.usage_records, 1);
  assert.equal(invalidCounterTypeReport.totals.input_tokens, 10);
  assert.equal(invalidCounterTypeReport.coverage.complete, false,
    "null and numeric-string counters must not be coerced to trusted zeroes");

  const duplicateLive = path.join(temp, "codex-duplicate-live");
  const duplicateArchive = path.join(temp, "codex-duplicate-archive");
  await mkdir(duplicateLive, { recursive: true });
  await mkdir(duplicateArchive, { recursive: true });
  const duplicateRollout = codexRollout("duplicate-session", [
    codexUsage(100, 0, 0, 0),
    codexUsage(150, 0, 0, 0),
  ]);
  await writeFile(path.join(duplicateLive, "live.jsonl"), duplicateRollout, "utf8");
  await writeFile(path.join(duplicateArchive, "archive.jsonl"), duplicateRollout, "utf8");
  const duplicateCodex = await collectUsage({ source: "codex", roots: [duplicateLive, duplicateArchive] });
  assertFrozenSchema(duplicateCodex);
  assert.deepEqual(duplicateCodex.totals, {
    input_tokens: 150,
    cache_write_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    usage_records: 2,
    total_tokens: 150,
  });
  assert.deepEqual(duplicateCodex.activity, { sessions: 1, active_days: 1 });
  assert.deepEqual(duplicateCodex.coverage, {
    files_discovered: 2,
    files_parsed: 2,
    files_with_usage: 2,
    files_skipped: 0,
    malformed_lines: 0,
    oversized_lines: 0,
    counter_resets: 0,
    duplicate_usage_records: 2,
    complete: true,
  });

  const distinctSessionsRoot = path.join(temp, "codex-distinct-sessions");
  await mkdir(distinctSessionsRoot, { recursive: true });
  await writeFile(path.join(distinctSessionsRoot, "one.jsonl"), codexRollout("distinct-one", [codexUsage(100, 0, 0, 0), codexUsage(150, 0, 0, 0)]), "utf8");
  await writeFile(path.join(distinctSessionsRoot, "two.jsonl"), codexRollout("distinct-two", [codexUsage(100, 0, 0, 0), codexUsage(150, 0, 0, 0)]), "utf8");
  const distinctSessions = await collectUsage({ source: "codex", roots: [distinctSessionsRoot] });
  assert.equal(distinctSessions.totals.total_tokens, 300);
  assert.equal(distinctSessions.totals.usage_records, 4);
  assert.equal(distinctSessions.activity.sessions, 2);
  assert.equal(distinctSessions.coverage.duplicate_usage_records, 0);

  const overlapOne = path.join(temp, "codex-overlap-one");
  const overlapTwo = path.join(temp, "codex-overlap-two");
  await mkdir(overlapOne, { recursive: true });
  await mkdir(overlapTwo, { recursive: true });
  await writeFile(path.join(overlapOne, "prefix.jsonl"), codexRollout("overlap-session", [codexUsage(100, 0, 0, 0), codexUsage(150, 0, 0, 0)]), "utf8");
  await writeFile(path.join(overlapTwo, "longer.jsonl"), codexRollout("overlap-session", [codexUsage(100, 0, 0, 0), codexUsage(150, 0, 0, 0), codexUsage(200, 0, 0, 0)]), "utf8");
  await assert.rejects(
    collectUsage({ source: "codex", roots: [overlapOne, overlapTwo] }),
    /Two different Codex files claim the same session/,
  );

  const invalidUtf8One = path.join(temp, "codex-invalid-utf8-one");
  const invalidUtf8Two = path.join(temp, "codex-invalid-utf8-two");
  await mkdir(invalidUtf8One, { recursive: true });
  await mkdir(invalidUtf8Two, { recursive: true });
  const invalidUtf8Prefix = Buffer.from(`${codexRollout("invalid-utf8-session", [codexUsage(100, 0, 0, 0)])}\n{"type":"response_item","payload":{"content":"`, "utf8");
  const invalidUtf8Suffix = Buffer.from('"}}\n', "utf8");
  await writeFile(path.join(invalidUtf8One, "one.jsonl"), Buffer.concat([invalidUtf8Prefix, Buffer.from([0x80]), invalidUtf8Suffix]));
  await writeFile(path.join(invalidUtf8Two, "two.jsonl"), Buffer.concat([invalidUtf8Prefix, Buffer.from([0x81]), invalidUtf8Suffix]));
  await assert.rejects(
    collectUsage({ source: "codex", roots: [invalidUtf8One, invalidUtf8Two] }),
    /Two different Codex files claim the same session/,
    "deduplication must fingerprint raw bytes, not decoded replacement characters",
  );

  const missingSessionRoot = path.join(temp, "codex-missing-session");
  await mkdir(missingSessionRoot, { recursive: true });
  await writeFile(path.join(missingSessionRoot, "missing.jsonl"), [
    codexLine("2026-07-15T09:00:01Z", "turn_context", { model: "gpt-5.6-sol" }),
    codexToken("2026-07-15T09:00:02Z", codexUsage(10, 0, 0, 0)),
  ].join("\n"), "utf8");
  await assert.rejects(
    collectUsage({ source: "codex", roots: [missingSessionRoot] }),
    /no single stable session identity/,
  );

  const attributionRoot = path.join(temp, "codex-attribution");
  await mkdir(attributionRoot, { recursive: true });
  await writeFile(path.join(attributionRoot, "attribution.jsonl"), [
    codexLine("2026-07-15T09:00:00Z", "session_meta", { id: "attribution-session" }),
    codexLine("2026-07-15T09:00:01Z", "turn_context", { model: "codex-auto-review" }),
    codexToken("2026-07-15T09:00:02Z", codexUsage(20, 0, 0, 0)),
    codexLine("2026-07-15T09:00:03Z", "event_msg", { type: "model_reroute", from_model: "codex-auto-review", to_model: "gpt-5.2", reason: "high_risk_cyber_activity" }),
    codexToken("2026-07-15T09:00:04Z", codexUsage(30, 0, 0, 0)),
    codexLine("2026-07-15T09:00:05Z", "turn_context", {}),
    codexToken("2026-07-15T09:00:06Z", codexUsage(40, 0, 0, 0)),
  ].join("\n"), "utf8");
  const attribution = await collectUsage({ source: "codex", roots: [attributionRoot] });
  assert.equal(model(attribution, "codex-auto-review").total_tokens, 20);
  assert.equal(model(attribution, "gpt-5.2").total_tokens, 10);
  assert.equal(model(attribution, "Unrecognized AI version").total_tokens, 10);
  assert.equal(attribution.totals.total_tokens, 40);

  assert.equal(sanitizeModelLabel("claude-opus-4-8-12345678"), "claude-opus-4-8");
  assert.equal(sanitizeModelLabel("gpt-5.6-sol-00000000"), "gpt-5.6-sol");
  assert.equal(sanitizeModelLabel("o3-preview-12345678"), "o3-preview");
  assert.equal(sanitizeModelLabel("codex-auto-review"), "codex-auto-review");
  assert.equal(sanitizeModelLabel(`gpt-5.6-${PRIVATE}`), "Unrecognized AI version");
  assert.equal(sanitizeModelLabel("__proto__"), "Unrecognized AI version");

  const profile = path.join(temp, `profile-${PRIVATE}`);
  const profileClaude = path.join(profile, ".claude", "projects");
  await makeClaudeFixture(profileClaude);
  const output = path.join(temp, "cli-safe-output.json");
  const cli = spawnSync(process.execPath, [collectorPath, "--source", "claude-code", "--output", output], {
    env: { ...process.env, USERPROFILE: profile, HOME: profile },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(cli.status, 0, `CLI failed: ${cli.stderr}`);
  assert.equal(cli.stdout, "");
  assert.match(cli.stderr, /scanning Claude Code usage counters locally/);
  assert.match(cli.stderr, /safe summary created from 2 parsed file/);
  assert.doesNotMatch(cli.stderr, new RegExp(PRIVATE));
  assert.doesNotMatch(cli.stderr, /\.claude|project-private|private-first/i);
  const cliReport = JSON.parse(await readFile(output, "utf8"));
  assertFrozenSchema(cliReport);
  assertPrivacy(cliReport);
  assert.deepEqual(cliReport.totals, claude.totals);

  const codexProfile = path.join(temp, "codex-cli-profile");
  const codexLive = path.join(codexProfile, ".codex", "sessions");
  const codexArchive = path.join(codexProfile, ".codex", "archived_sessions");
  await mkdir(codexLive, { recursive: true });
  await mkdir(codexArchive, { recursive: true });
  await writeFile(path.join(codexLive, "live.jsonl"), duplicateRollout, "utf8");
  await writeFile(path.join(codexArchive, "archive.jsonl"), duplicateRollout, "utf8");
  const codexCliOutput = path.join(temp, "codex-cli-output.json");
  const codexCli = spawnSync(process.execPath, [collectorPath, "--source", "codex", "--output", codexCliOutput], {
    env: { ...process.env, USERPROFILE: codexProfile, HOME: codexProfile },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(codexCli.status, 0, `Codex CLI failed: ${codexCli.stderr}`);
  assert.doesNotMatch(codexCli.stderr, /\.codex|duplicate-session|live\.jsonl|archive\.jsonl/i);
  const codexCliReport = JSON.parse(await readFile(codexCliOutput, "utf8"));
  assert.equal(codexCliReport.totals.total_tokens, 150);
  assert.equal(codexCliReport.activity.sessions, 1);
  assert.equal(codexCliReport.coverage.duplicate_usage_records, 2);

  const badCli = spawnSync(process.execPath, [collectorPath, "--source", "wrong-source"], { encoding: "utf8" });
  assert.notEqual(badCli.status, 0);
  assert.match(badCli.stderr, /Usage: node top-collector\.mjs/);
  assert.doesNotMatch(badCli.stderr, new RegExp(PRIVATE));
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("TOP local collector synthetic, privacy, reconciliation, malformed/reset, and CLI tests passed");
