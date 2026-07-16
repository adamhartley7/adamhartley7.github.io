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
    `{malformed-${PRIVATE}`,
  ].join("\n");
  await writeFile(path.join(root, "nested", "rollout-private.jsonl"), fixture, "utf8");
  await writeFile(path.join(root, `oversized-${PRIVATE}.jsonl`), "x".repeat(MAX_LINE_CHARS + 32) + "\n", "utf8");
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
    files_discovered: 2,
    files_parsed: 2,
    files_with_usage: 1,
    files_skipped: 0,
    malformed_lines: 1,
    oversized_lines: 1,
    counter_resets: 1,
    duplicate_usage_records: 1,
    complete: false,
  });
  assert.deepEqual(codex.activity, { sessions: 1, active_days: 2 });
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
  assert.deepEqual(codex.totals, {
    input_tokens: 118,
    cache_write_input_tokens: 0,
    cache_read_input_tokens: 62,
    output_tokens: 44,
    reasoning_output_tokens: 11,
    usage_records: 4,
    total_tokens: 224,
  });

  assert.equal(sanitizeModelLabel("claude-opus-4-8-12345678"), "claude-opus-4-8");
  assert.equal(sanitizeModelLabel("gpt-5.6-sol-00000000"), "gpt-5.6-sol");
  assert.equal(sanitizeModelLabel("o3-preview-12345678"), "o3-preview");
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

  const badCli = spawnSync(process.execPath, [collectorPath, "--source", "wrong-source"], { encoding: "utf8" });
  assert.notEqual(badCli.status, 0);
  assert.match(badCli.stderr, /Usage: node top-collector\.mjs/);
  assert.doesNotMatch(badCli.stderr, new RegExp(PRIVATE));
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("TOP local collector synthetic, privacy, reconciliation, malformed/reset, and CLI tests passed");
