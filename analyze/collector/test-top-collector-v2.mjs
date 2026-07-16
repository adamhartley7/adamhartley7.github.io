import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COLLECTOR_VERSION_V2,
  PARSER_VERSION_V2,
  SCHEMA_VERSION_V2,
  collectUsage,
  validateSafeReportV2,
} from "./top-collector.mjs";

const PRIVATE = "PRIVATE_V2_SENTINEL_MUST_NOT_LEAK_174902";
const directory = path.dirname(fileURLToPath(import.meta.url));
const collectorPath = path.join(directory, "top-collector.mjs");

function claudeLine({
  messageId,
  requestId,
  sessionId,
  timestamp,
  input,
} = {}) {
  return JSON.stringify({
    type: "assistant",
    sessionId,
    timestamp,
    cwd: `C:\\${PRIVATE}`,
    prompt: PRIVATE,
    tool_name: PRIVATE,
    tool_output: PRIVATE,
    message: {
      id: messageId,
      model: "claude-opus-4-8-20260716",
      content: [{ type: "text", text: PRIVATE }],
      usage: {
        input_tokens: input,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    requestId,
  });
}

function sessionLines({ sessionId, prefix, count, input, start, spacingMinutes }) {
  const base = start ? Date.parse(start) : null;
  return Array.from({ length: count }, (_, index) => claudeLine({
    messageId: `${prefix}-message-${index}`,
    requestId: `${prefix}-request-${index}`,
    sessionId,
    timestamp: base === null ? undefined : new Date(base + index * spacingMinutes * 60_000).toISOString(),
    input,
  }));
}

async function makeClaudeV2Fixture(root) {
  const first = path.join(root, `project-${PRIVATE}-one`);
  const second = path.join(root, "project-two");
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });

  const sessionA = sessionLines({ sessionId: `session-a-${PRIVATE}`, prefix: "a", count: 1, input: 9_999, start: "2026-01-05T00:00:00Z", spacingMinutes: 0 });
  const sessionB = sessionLines({ sessionId: "session-b", prefix: "b", count: 2, input: 5_000, start: "2026-01-06T00:00:00Z", spacingMinutes: 10 });
  const sessionC = sessionLines({ sessionId: "session-c", prefix: "c", count: 4, input: 12_500, start: "2026-01-07T00:00:00Z", spacingMinutes: 40 });
  const sessionD = sessionLines({ sessionId: "session-d", prefix: "d", count: 5, input: 40_000, start: "2026-02-01T00:00:00Z", spacingMinutes: 75 });
  const sessionE = sessionLines({ sessionId: "session-e", prefix: "e", count: 19, input: 52_632, start: "2026-02-02T00:00:00Z", spacingMinutes: 40 });
  const sessionF = sessionLines({ sessionId: undefined, prefix: "f", count: 20, input: 1, start: null, spacingMinutes: 0 });
  await writeFile(path.join(first, "history-one.jsonl"), [...sessionA, ...sessionB, ...sessionC].join("\n"), "utf8");
  await writeFile(path.join(second, "history-two.jsonl"), [
    claudeLine({
      messageId: "a-message-0",
      requestId: "a-request-0",
      sessionId: "resumed-session-a",
      timestamp: "2026-01-08T12:00:00Z",
      input: 9_999,
    }),
    ...sessionD,
    ...sessionE,
    ...sessionF,
  ].join("\n"), "utf8");
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
  return JSON.stringify({ timestamp, type, payload, private: PRIVATE, prompt: PRIVATE });
}

function codexToken(timestamp, total, last = total) {
  return codexLine(timestamp, "event_msg", {
    type: "token_count",
    info: { total_token_usage: total, last_token_usage: last },
    rate_limits: { account: PRIVATE },
  });
}

async function makeCodexV2Fixture(root) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "rollout-one.jsonl"), [
    codexLine("2026-01-10T00:00:00Z", "session_meta", { id: PRIVATE, cwd: PRIVATE }),
    codexLine("2026-01-10T00:00:01Z", "turn_context", { model: "gpt-5.6-sol-20260716" }),
    codexToken("2026-01-10T00:00:02Z", codexUsage(100, 40, 20, 5)),
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "rollout-two.jsonl"), [
    codexLine("2026-02-10T00:00:00Z", "turn_context", { model: "o3-preview" }),
    codexToken("2026-02-10T00:00:01Z", codexUsage(50, 10, 10, 2)),
    codexToken("2026-02-10T02:00:01Z", codexUsage(80, 20, 20, 4), codexUsage(30, 10, 10, 2)),
  ].join("\n"), "utf8");
}

function assertPrivacy(report) {
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, new RegExp(PRIVATE));
  for (const denied of [
    "session-a",
    "resumed-session",
    "message-0",
    "request-0",
    "history-one",
    "rollout-one",
    "2026-01-05T00:00:00",
    "2026-02-10T02:00:01",
    "cwd",
    "prompt",
    "tool_name",
    "tool_output",
    "rate_limits",
  ]) assert.doesNotMatch(text, new RegExp(denied, "i"));
}

function assertV2Schema(report) {
  assert.deepEqual(Object.keys(report), [
    "schema_version",
    "collector_version",
    "parser_version",
    "generated_date",
    "source",
    "coverage",
    "totals",
    "activity",
    "by_model",
    "timeline",
    "session_distributions",
    "workflow_shape",
  ]);
  assert.equal(report.schema_version, SCHEMA_VERSION_V2);
  assert.equal(report.collector_version, COLLECTOR_VERSION_V2);
  assert.equal(report.parser_version, PARSER_VERSION_V2);
  assert.deepEqual(Object.keys(report.timeline), ["status", "granularity", "timestamp_basis", "periods"]);
  assert.deepEqual(Object.keys(report.session_distributions), [
    "status",
    "session_definition",
    "thresholds_version",
    "elapsed_time_basis",
    "logical_sessions_analyzed",
    "usage_records_per_session",
    "total_tokens_per_session",
    "elapsed_time_per_session",
  ]);
  assert.deepEqual(Object.keys(report.workflow_shape), ["status", "algorithm_version", "basis", "sessions"]);
  assert.equal(validateSafeReportV2(report), true);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const temp = await mkdtemp(path.join(tmpdir(), "top-collector-v2-test-"));
try {
  const claudeRoot = path.join(temp, "claude");
  await makeClaudeV2Fixture(claudeRoot);
  const claude = await collectUsage({ source: "claude-code", roots: [claudeRoot], schema: "v2" });
  assertV2Schema(claude);
  assertPrivacy(claude);
  assert.deepEqual(claude.activity, { sessions: 6, active_days: 5 });
  assert.deepEqual(claude.totals, {
    input_tokens: 1_270_027,
    cache_write_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    usage_records: 51,
    total_tokens: 1_270_027,
  });
  assert.equal(claude.coverage.duplicate_usage_records, 1);
  assert.deepEqual(claude.timeline.periods, [
    {
      period: "2026-01",
      input_tokens: 69_999,
      cache_write_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      usage_records: 7,
      total_tokens: 69_999,
      active_days: 3,
      logical_sessions_started: 3,
    },
    {
      period: "2026-02",
      input_tokens: 1_200_008,
      cache_write_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      usage_records: 24,
      total_tokens: 1_200_008,
      active_days: 2,
      logical_sessions_started: 2,
    },
    {
      period: "undated",
      input_tokens: 20,
      cache_write_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      usage_records: 20,
      total_tokens: 20,
      active_days: 0,
      logical_sessions_started: 1,
    },
  ]);
  assert.deepEqual(claude.session_distributions, {
    status: "available",
    session_definition: "deduplicated_logical_session",
    thresholds_version: "top.session-buckets.v1",
    elapsed_time_basis: "wall_clock_span_between_first_and_last_supported_usage_record",
    logical_sessions_analyzed: 6,
    usage_records_per_session: { zero: 0, one: 1, two_to_four: 2, five_to_nineteen: 2, twenty_plus: 1 },
    total_tokens_per_session: { under_10k: 2, ten_to_49k: 1, fifty_to_199k: 1, two_hundred_to_999k: 1, one_million_plus: 1 },
    elapsed_time_per_session: { under_10m: 1, ten_to_59m: 1, one_to_3h: 1, four_to_11h: 1, twelve_h_plus: 1, unknown: 1 },
  });
  assert.deepEqual(claude.workflow_shape, {
    status: "available",
    algorithm_version: "top.workflow-shape.v1",
    basis: "deduplicated_usage_record_count_only",
    sessions: { single_exchange: 1, short_multi_exchange: 2, sustained: 2, high_iteration: 1, unclassified: 0 },
  });

  const leaked = clone(claude);
  leaked.timeline.periods[0].prompt = PRIVATE;
  assert.throws(() => validateSafeReportV2(leaked), /Timeline period has an unsupported field/);
  const unreconciled = clone(claude);
  unreconciled.timeline.periods[0].input_tokens++;
  unreconciled.timeline.periods[0].total_tokens++;
  assert.throws(() => validateSafeReportV2(unreconciled), /Timeline does not reconcile/);
  const brokenHistogram = clone(claude);
  brokenHistogram.workflow_shape.sessions.single_exchange--;
  brokenHistogram.workflow_shape.sessions.high_iteration++;
  assert.throws(() => validateSafeReportV2(brokenHistogram), /Workflow shape does not reconcile with usage-record buckets/);
  const invalidPeriod = clone(claude);
  invalidPeriod.timeline.periods[0].period = "2026-99";
  assert.throws(() => validateSafeReportV2(invalidPeriod), /Timeline period is invalid/);
  const impossibleDays = clone(claude);
  impossibleDays.timeline.periods[0].active_days = 99;
  assert.throws(() => validateSafeReportV2(impossibleDays), /Timeline active-day cardinality is impossible/);
  const impossibleStarts = clone(claude);
  impossibleStarts.timeline.periods[0].logical_sessions_started = impossibleStarts.timeline.periods[0].usage_records + 1;
  assert.throws(() => validateSafeReportV2(impossibleStarts), /Timeline session-start cardinality is impossible/);

  const mixedTimestampRoot = path.join(temp, "mixed-timestamp");
  await mkdir(mixedTimestampRoot, { recursive: true });
  await writeFile(path.join(mixedTimestampRoot, "mixed.jsonl"), [
    claudeLine({ messageId: "mixed-message-1", requestId: "mixed-request-1", sessionId: "mixed-session", timestamp: "2026-03-05T10:00:00Z", input: 1 }),
    claudeLine({ messageId: "mixed-message-2", requestId: "mixed-request-2", sessionId: "mixed-session", timestamp: undefined, input: 1 }),
  ].join("\n"), "utf8");
  const mixedTimestamp = await collectUsage({ source: "claude-code", roots: [mixedTimestampRoot], schema: "v2" });
  assertV2Schema(mixedTimestamp);
  assert.deepEqual(mixedTimestamp.activity, { sessions: 1, active_days: 1 });
  assert.deepEqual(mixedTimestamp.timeline.periods.map(row => ({
    period: row.period,
    usage_records: row.usage_records,
    active_days: row.active_days,
    logical_sessions_started: row.logical_sessions_started,
  })), [
    { period: "2026-03", usage_records: 1, active_days: 1, logical_sessions_started: 0 },
    { period: "undated", usage_records: 1, active_days: 0, logical_sessions_started: 1 },
  ]);
  assert.deepEqual(mixedTimestamp.session_distributions.elapsed_time_per_session, {
    under_10m: 0,
    ten_to_59m: 0,
    one_to_3h: 0,
    four_to_11h: 0,
    twelve_h_plus: 0,
    unknown: 1,
  });

  const duplicateTimestampRoot = path.join(temp, "duplicate-timestamp");
  await mkdir(duplicateTimestampRoot, { recursive: true });
  await writeFile(path.join(duplicateTimestampRoot, "duplicate.jsonl"), [
    claudeLine({ messageId: "duplicate-message", requestId: "duplicate-request", sessionId: "duplicate-session-one", timestamp: undefined, input: 1 }),
    claudeLine({ messageId: "duplicate-message", requestId: "duplicate-request", sessionId: "duplicate-session-two", timestamp: "2026-04-05T10:00:00Z", input: 1 }),
  ].join("\n"), "utf8");
  const duplicateTimestamp = await collectUsage({ source: "claude-code", roots: [duplicateTimestampRoot], schema: "v2" });
  assertV2Schema(duplicateTimestamp);
  assert.deepEqual(duplicateTimestamp.activity, { sessions: 1, active_days: 1 });
  assert.deepEqual(duplicateTimestamp.timeline.periods.map(row => ({
    period: row.period,
    usage_records: row.usage_records,
    logical_sessions_started: row.logical_sessions_started,
  })), [{ period: "2026-04", usage_records: 1, logical_sessions_started: 1 }]);
  assert.equal(duplicateTimestamp.session_distributions.elapsed_time_per_session.under_10m, 1);
  assert.equal(duplicateTimestamp.session_distributions.elapsed_time_per_session.unknown, 0);
  const zeroTokenUsageRecord = clone(duplicateTimestamp);
  zeroTokenUsageRecord.totals.input_tokens = 0;
  zeroTokenUsageRecord.totals.total_tokens = 0;
  zeroTokenUsageRecord.by_model[0].input_tokens = 0;
  zeroTokenUsageRecord.by_model[0].total_tokens = 0;
  zeroTokenUsageRecord.timeline.periods[0].input_tokens = 0;
  zeroTokenUsageRecord.timeline.periods[0].total_tokens = 0;
  assert.throws(() => validateSafeReportV2(zeroTokenUsageRecord), /Usage records cannot exceed total tokens/);

  const invalidTimestampRoot = path.join(temp, "invalid-timestamp");
  await mkdir(invalidTimestampRoot, { recursive: true });
  await writeFile(path.join(invalidTimestampRoot, "invalid.jsonl"), claudeLine({
    messageId: "invalid-date-message",
    requestId: "invalid-date-request",
    sessionId: "invalid-date-session",
    timestamp: "2026-02-30T10:00:00Z",
    input: 1,
  }), "utf8");
  const invalidTimestamp = await collectUsage({ source: "claude-code", roots: [invalidTimestampRoot], schema: "v2" });
  assertV2Schema(invalidTimestamp);
  assert.deepEqual(invalidTimestamp.activity, { sessions: 1, active_days: 0 });
  assert.deepEqual(invalidTimestamp.timeline.periods.map(row => row.period), ["undated"]);
  assert.equal(invalidTimestamp.session_distributions.elapsed_time_per_session.unknown, 1);

  const codexRoot = path.join(temp, "codex");
  await makeCodexV2Fixture(codexRoot);
  const codex = await collectUsage({ source: "codex", roots: [codexRoot], schema: "v2" });
  assertV2Schema(codex);
  assertPrivacy(codex);
  assert.deepEqual(codex.activity, { sessions: 2, active_days: 2 });
  assert.deepEqual(codex.totals, {
    input_tokens: 120,
    cache_write_input_tokens: 0,
    cache_read_input_tokens: 60,
    output_tokens: 40,
    reasoning_output_tokens: 9,
    usage_records: 3,
    total_tokens: 220,
  });
  assert.deepEqual(codex.timeline.periods.map(row => ({
    period: row.period,
    usage_records: row.usage_records,
    total_tokens: row.total_tokens,
    active_days: row.active_days,
    logical_sessions_started: row.logical_sessions_started,
  })), [
    { period: "2026-01", usage_records: 1, total_tokens: 120, active_days: 1, logical_sessions_started: 1 },
    { period: "2026-02", usage_records: 2, total_tokens: 100, active_days: 1, logical_sessions_started: 1 },
  ]);
  assert.deepEqual(codex.session_distributions, {
    status: "available",
    session_definition: "codex_rollout_file_proxy",
    thresholds_version: "top.session-buckets.v1",
    elapsed_time_basis: "wall_clock_span_between_first_and_last_supported_usage_record",
    logical_sessions_analyzed: 2,
    usage_records_per_session: { zero: 0, one: 1, two_to_four: 1, five_to_nineteen: 0, twenty_plus: 0 },
    total_tokens_per_session: { under_10k: 2, ten_to_49k: 0, fifty_to_199k: 0, two_hundred_to_999k: 0, one_million_plus: 0 },
    elapsed_time_per_session: { under_10m: 1, ten_to_59m: 0, one_to_3h: 1, four_to_11h: 0, twelve_h_plus: 0, unknown: 0 },
  });
  assert.deepEqual(codex.workflow_shape.sessions, {
    single_exchange: 1,
    short_multi_exchange: 1,
    sustained: 0,
    high_iteration: 0,
    unclassified: 0,
  });

  const profile = path.join(temp, "profile");
  const profileClaude = path.join(profile, ".claude", "projects");
  await makeClaudeV2Fixture(profileClaude);
  const output = path.join(temp, "cli-v2-output.json");
  const cli = spawnSync(process.execPath, [collectorPath, "--source", "claude-code", "--schema", "v2", "--output", output], {
    env: { ...process.env, USERPROFILE: profile, HOME: profile },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(cli.status, 0, `V2 CLI failed: ${cli.stderr}`);
  assert.equal(cli.stdout, "");
  assert.doesNotMatch(cli.stderr, new RegExp(PRIVATE));
  assert.doesNotMatch(cli.stderr, /\.claude|project-|history-/i);
  const cliReport = JSON.parse(await readFile(output, "utf8"));
  assertV2Schema(cliReport);
  assertPrivacy(cliReport);
  assert.deepEqual(cliReport.totals, claude.totals);
  assert.deepEqual(cliReport.session_distributions, claude.session_distributions);

  const defaultV1Cli = spawnSync(process.execPath, [collectorPath, "--source", "claude-code"], {
    env: { ...process.env, USERPROFILE: profile, HOME: profile },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(defaultV1Cli.status, 0, `Default v1 CLI failed: ${defaultV1Cli.stderr}`);
  const defaultFiles = await readdir(path.join(profile, "Downloads"));
  assert.equal(defaultFiles.length, 1);
  assert.match(defaultFiles[0], /^top-safe-usage-claude-code-\d{4}-\d{2}-\d{2}\.json$/);
  const defaultV1Report = JSON.parse(await readFile(path.join(profile, "Downloads", defaultFiles[0]), "utf8"));
  assert.equal(defaultV1Report.schema_version, "top.safe-usage.v1");
  assert.deepEqual(Object.keys(defaultV1Report), ["schema_version", "collector_version", "parser_version", "generated_date", "source", "coverage", "totals", "activity", "by_model"]);

  const invalidSchemaCli = spawnSync(process.execPath, [collectorPath, "--source", "claude-code", "--schema", "v3"], {
    encoding: "utf8",
  });
  assert.notEqual(invalidSchemaCli.status, 0);
  assert.match(invalidSchemaCli.stderr, /Usage: node top-collector\.mjs/);
  assert.doesNotMatch(invalidSchemaCli.stderr, new RegExp(PRIVATE));
  await assert.rejects(
    collectUsage({ source: "claude-code", roots: [claudeRoot], schema: "v3" }),
    /Schema must be v1 or v2/,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("TOP safe-usage v2 synthetic boundary, privacy, reconciliation, logical-session, and CLI tests passed");
