#!/usr/bin/env node

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";

export const SCHEMA_VERSION = "top.safe-usage.v1";
export const COLLECTOR_VERSION = "top.local-collector.2026-07-20.1";
export const PARSER_VERSION = "top.usage-parser.2026-07-20.1";
export const SCHEMA_VERSION_V2 = "top.safe-usage.v2";
export const COLLECTOR_VERSION_V2 = "top.local-collector.2026-07-20.2";
export const PARSER_VERSION_V2 = "top.usage-parser.2026-07-20.2";
export const MAX_LINE_CHARS = 2 * 1024 * 1024;

const PARTITIONS = 64;
const PROGRESS_BYTES = 128 * 1024 * 1024;
const SAFE_MODEL_FALLBACK = "Unrecognized AI version";
const ALLOWED_SOURCES = new Set(["claude-code", "codex"]);
const TOKEN_FIELDS = ["input_tokens", "cache_write_input_tokens", "cache_read_input_tokens", "output_tokens", "reasoning_output_tokens", "usage_records"];

function dateOnly(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  return match ? match[1] : null;
}

function validCalendarDay(value) {
  const day = dateOnly(value);
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  if (month < 1 || month > 12 || date < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return date <= days[month - 1] ? day : null;
}

function timeOnlyForLocalAggregation(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function monthForDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(day || "")) ? day.slice(0, 7) : "undated";
}

function validCalendarMonth(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 12);
}

function daysInCalendarMonth(value) {
  if (!validCalendarMonth(value)) return 0;
  const [year, month] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function sealPrivateMetadata(key, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function openPrivateMetadata(key, value) {
  const packed = Buffer.from(String(value || ""), "base64url");
  if (packed.length < 29) throw new Error("Private collector metadata could not be opened.");
  const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  const text = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
  return JSON.parse(text);
}

function safeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function addSafe(left, right) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Usage counters exceed the supported safe integer range.");
  }
  return result;
}

export function sanitizeModelLabel(value) {
  let model = String(value || "")
    .replace(/[\u0000-\u001f\u007f<>\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!model || model.length > 160) return SAFE_MODEL_FALLBACK;
  model = model.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "");
  if (/^claude-(?:(?:opus|sonnet|haiku|fable|mythos)-\d{1,2}(?:-\d{1,2}){0,2}|\d{1,2}(?:-\d{1,2}){0,2}-(?:opus|sonnet|haiku|fable|mythos))$/.test(model)) return model;
  if (/^gpt-\d{1,2}(?:[.-]\d{1,2})*(?:-(?:sol|terra|luna|mini|nano|codex(?:-mini)?|chat|pro|turbo|preview))?$/.test(model)) return model;
  if (/^o[1-9](?:-(?:mini|pro|preview|latest))?$/.test(model)) return model;
  if (/^deepseek-v\d{1,2}(?:[.-]\d{1,2})*(?:-(?:pro|lite|chat|coder|reasoner))?$/.test(model)) return model;
  if (model === "codex-auto-review") return model;
  if (/^codex-(?:mini|large|latest)(?:-latest)?$/.test(model)) return model;
  return SAFE_MODEL_FALLBACK;
}

function sourceMetadata(source) {
  if (source === "claude-code") return { provider: "anthropic", surface: "claude_code" };
  return { provider: "openai", surface: "codex" };
}

function emptyCoverage() {
  return {
    files_discovered: 0,
    files_parsed: 0,
    files_with_usage: 0,
    files_skipped: 0,
    malformed_lines: 0,
    oversized_lines: 0,
    counter_resets: 0,
    duplicate_usage_records: 0,
    complete: true,
  };
}

function emptyModelRow() {
  return {
    input_tokens: 0,
    cache_write_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    usage_records: 0,
  };
}

function mergeModelRow(target, row) {
  for (const key of TOKEN_FIELDS) {
    target[key] = addSafe(target[key], row[key]);
  }
}

function emptySessionAggregate() {
  return { ...emptyModelRow(), first_day: null, first_time: null, last_time: null, all_days_known: true, all_times_known: true };
}

function mergeUsageIntoSession(target, row, day, time, allDaysKnown = day !== null, allTimesKnown = time !== null) {
  mergeModelRow(target, row);
  if (!allDaysKnown) target.all_days_known = false;
  if (!allTimesKnown) target.all_times_known = false;
  if (day && (!target.first_day || day < target.first_day)) target.first_day = day;
  if (time !== null) {
    if (target.first_time === null || time < target.first_time) target.first_time = time;
    if (target.last_time === null || time > target.last_time) target.last_time = time;
  }
}

function emptyTimelineAggregate() {
  return { ...emptyModelRow(), days: new Set(), logical_sessions_started: 0 };
}

function mergeUsageIntoTimeline(timeline, row, day) {
  const period = monthForDay(day);
  const target = timeline.get(period) || emptyTimelineAggregate();
  mergeModelRow(target, row);
  if (day) target.days.add(day);
  timeline.set(period, target);
}

function incrementBucket(buckets, key) {
  buckets[key] = addSafe(buckets[key], 1);
}

function usageRecordBucket(value) {
  if (value === 0) return "zero";
  if (value === 1) return "one";
  if (value <= 4) return "two_to_four";
  if (value <= 19) return "five_to_nineteen";
  return "twenty_plus";
}

function tokenBucket(value) {
  if (value < 10_000) return "under_10k";
  if (value < 50_000) return "ten_to_49k";
  if (value < 200_000) return "fifty_to_199k";
  if (value < 1_000_000) return "two_hundred_to_999k";
  return "one_million_plus";
}

function elapsedBucket(session) {
  if (!session.all_times_known || session.first_time === null || session.last_time === null) return "unknown";
  const minutes = Math.max(0, (session.last_time - session.first_time) / 60_000);
  if (minutes < 10) return "under_10m";
  if (minutes < 60) return "ten_to_59m";
  if (minutes < 240) return "one_to_3h";
  if (minutes < 720) return "four_to_11h";
  return "twelve_h_plus";
}

function workflowBucket(value) {
  if (value === 1) return "single_exchange";
  if (value >= 2 && value <= 4) return "short_multi_exchange";
  if (value >= 5 && value <= 19) return "sustained";
  if (value >= 20) return "high_iteration";
  return "unclassified";
}

function buildV2Sections(source, sessions, timeline) {
  const usageRecords = { zero: 0, one: 0, two_to_four: 0, five_to_nineteen: 0, twenty_plus: 0 };
  const totalTokens = { under_10k: 0, ten_to_49k: 0, fifty_to_199k: 0, two_hundred_to_999k: 0, one_million_plus: 0 };
  const elapsed = { under_10m: 0, ten_to_59m: 0, one_to_3h: 0, four_to_11h: 0, twelve_h_plus: 0, unknown: 0 };
  const shapes = { single_exchange: 0, short_multi_exchange: 0, sustained: 0, high_iteration: 0, unclassified: 0 };
  for (const session of sessions.values()) {
    const sessionTotal = addSafe(addSafe(addSafe(session.input_tokens, session.cache_write_input_tokens), session.cache_read_input_tokens), session.output_tokens);
    incrementBucket(usageRecords, usageRecordBucket(session.usage_records));
    incrementBucket(totalTokens, tokenBucket(sessionTotal));
    incrementBucket(elapsed, elapsedBucket(session));
    incrementBucket(shapes, workflowBucket(session.usage_records));
    const period = session.all_days_known ? monthForDay(session.first_day) : "undated";
    const periodRow = timeline.get(period) || emptyTimelineAggregate();
    periodRow.logical_sessions_started = addSafe(periodRow.logical_sessions_started, 1);
    timeline.set(period, periodRow);
  }
  const periods = [...timeline.entries()]
    .sort(([left], [right]) => left === "undated" ? 1 : right === "undated" ? -1 : left.localeCompare(right))
    .map(([period, row]) => ({
      period,
      input_tokens: row.input_tokens,
      cache_write_input_tokens: row.cache_write_input_tokens,
      cache_read_input_tokens: row.cache_read_input_tokens,
      output_tokens: row.output_tokens,
      reasoning_output_tokens: row.reasoning_output_tokens,
      usage_records: row.usage_records,
      total_tokens: addSafe(addSafe(addSafe(row.input_tokens, row.cache_write_input_tokens), row.cache_read_input_tokens), row.output_tokens),
      active_days: row.days.size,
      logical_sessions_started: row.logical_sessions_started,
    }));
  return {
    timeline: {
      status: "available",
      granularity: "calendar_month",
      timestamp_basis: "source_date_prefix_not_timezone_normalized",
      periods,
    },
    session_distributions: {
      status: "available",
      session_definition: source === "claude-code" ? "deduplicated_logical_session" : "codex_rollout_file_proxy",
      thresholds_version: "top.session-buckets.v1",
      elapsed_time_basis: "wall_clock_span_between_first_and_last_supported_usage_record",
      logical_sessions_analyzed: sessions.size,
      usage_records_per_session: usageRecords,
      total_tokens_per_session: totalTokens,
      elapsed_time_per_session: elapsed,
    },
    workflow_shape: {
      status: "available",
      algorithm_version: "top.workflow-shape.v1",
      basis: "deduplicated_usage_record_count_only",
      sessions: shapes,
    },
  };
}

function reportV2FromBase(base, source, sessions, timeline) {
  const sections = buildV2Sections(source, sessions, timeline);
  const activeDays = sections.timeline.periods.reduce((total, row) => addSafe(total, row.active_days), 0);
  const report = {
    ...base,
    schema_version: SCHEMA_VERSION_V2,
    collector_version: COLLECTOR_VERSION_V2,
    parser_version: PARSER_VERSION_V2,
    activity: { sessions: sessions.size, active_days: activeDays },
    ...sections,
  };
  validateSafeReportV2(report);
  return report;
}

function reportFromAggregate(source, coverage, aggregate, sessions, activeDays) {
  const rows = [...aggregate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model, row]) => ({
      model,
      ...row,
      total_tokens: addSafe(addSafe(addSafe(row.input_tokens, row.cache_write_input_tokens), row.cache_read_input_tokens), row.output_tokens),
    }));
  const totals = emptyModelRow();
  for (const row of rows) mergeModelRow(totals, row);
  totals.total_tokens = addSafe(addSafe(addSafe(totals.input_tokens, totals.cache_write_input_tokens), totals.cache_read_input_tokens), totals.output_tokens);
  const report = {
    schema_version: SCHEMA_VERSION,
    collector_version: COLLECTOR_VERSION,
    parser_version: PARSER_VERSION,
    generated_date: new Date().toISOString().slice(0, 10),
    source: sourceMetadata(source),
    coverage,
    totals,
    activity: { sessions, active_days: activeDays },
    by_model: rows,
  };
  validateSafeReport(report);
  return report;
}

function privateDigest(secret, parts) {
  return createHmac("sha256", secret).update(JSON.stringify(parts)).digest("hex");
}

class PrivateUnionFind {
  constructor() { this.parents = new Map(); }
  add(value) { if (!this.parents.has(value)) this.parents.set(value, value); }
  find(value) {
    this.add(value);
    let root = value;
    while (this.parents.get(root) !== root) root = this.parents.get(root);
    let current = value;
    while (this.parents.get(current) !== current) {
      const next = this.parents.get(current);
      this.parents.set(current, root);
      current = next;
    }
    return root;
  }
  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return leftRoot;
    const root = leftRoot < rightRoot ? leftRoot : rightRoot;
    this.parents.set(leftRoot === root ? rightRoot : leftRoot, root);
    return root;
  }
}

function partitionFor(key) {
  return Number.parseInt(key.slice(0, 2), 16) % PARTITIONS;
}

class PartitionSpool {
  constructor(directory) {
    this.directory = directory;
    this.streams = new Map();
    this.pending = new Map();
  }

  stream(kind, partition) {
    const key = `${kind}-${partition}`;
    if (!this.streams.has(key)) {
      const destination = path.join(this.directory, `${key}.jsonl`);
      this.streams.set(key, createWriteStream(destination, { encoding: "utf8", flags: "a", mode: 0o600 }));
    }
    return this.streams.get(key);
  }

  write(kind, digest, value) {
    const stream = this.stream(kind, partitionFor(digest));
    const line = JSON.stringify(value === undefined ? { digest } : { digest, value }) + "\n";
    if (!stream.write(line) && !this.pending.has(stream)) this.pending.set(stream, once(stream, "drain"));
  }

  async waitForDrain() {
    if (!this.pending.size) return;
    const waits = [...this.pending.values()];
    this.pending.clear();
    await Promise.all(waits);
  }

  async close() {
    await this.waitForDrain();
    await Promise.all([...this.streams.values()].map(async stream => {
      stream.end();
      await once(stream, "finish");
    }));
  }
}

function createBoundedLineCollector(onLine, onOversized, maxChars = MAX_LINE_CHARS) {
  let buffer = "";
  let dropping = false;
  return {
    push(chunk) {
      const pieces = String(chunk || "").split("\n");
      pieces.forEach((piece, index) => {
        const ended = index < pieces.length - 1;
        if (dropping) {
          if (ended) dropping = false;
          return;
        }
        if (buffer.length + piece.length > maxChars) {
          buffer = "";
          if (!ended) dropping = true;
          onOversized();
          return;
        }
        buffer += piece;
        if (ended) {
          onLine(buffer.replace(/\r$/, ""));
          buffer = "";
        }
      });
    },
    finish() {
      if (!dropping && buffer) onLine(buffer.replace(/\r$/, ""));
      buffer = "";
      dropping = false;
    },
  };
}

async function streamLines(filePath, onLine, onOversized, onBytes, afterChunk, onChunk) {
  const input = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  const decoder = new StringDecoder("utf8");
  const collector = createBoundedLineCollector(onLine, onOversized);
  for await (const chunk of input) {
    onBytes(chunk.length);
    if (onChunk) onChunk(chunk);
    const decoded = decoder.write(chunk);
    if (decoded) collector.push(decoded);
    if (afterChunk) await afterChunk();
  }
  const finalDecoded = decoder.end();
  if (finalDecoded) collector.push(finalDecoded);
  collector.finish();
  if (afterChunk) await afterChunk();
}

async function* jsonlFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw new Error("A source directory could not be read.");
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      if (entry.name.toLowerCase().endsWith(".jsonl")) yield { skipped: true };
      continue;
    }
    if (entry.isDirectory()) {
      yield* jsonlFiles(child);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
      yield { filePath: child, skipped: false };
    }
  }
}

function defaultRoots(source, profile) {
  if (source === "claude-code") return [path.join(profile, ".claude", "projects")];
  return [path.join(profile, ".codex", "sessions"), path.join(profile, ".codex", "archived_sessions")];
}

function createNoopProgress() {
  return { start() {}, bytes() {}, file() {}, phase() {}, done() {} };
}

export function createStderrProgress(stderr = process.stderr) {
  let bytesRead = 0;
  let nextByteNotice = PROGRESS_BYTES;
  return {
    start(source) { stderr.write(`TOP collector: scanning ${source === "claude-code" ? "Claude Code" : "Codex"} usage counters locally.\n`); },
    bytes(count, files) {
      bytesRead += count;
      if (bytesRead >= nextByteNotice) {
        stderr.write(`TOP collector: read ${Math.floor(bytesRead / (1024 * 1024))} MiB across ${files} file(s).\n`);
        while (nextByteNotice <= bytesRead) nextByteNotice += PROGRESS_BYTES;
      }
    },
    file(files) {
      if (files > 0 && files % 25 === 0) stderr.write(`TOP collector: processed ${files} file(s).\n`);
    },
    phase(message) { stderr.write(`TOP collector: ${message}\n`); },
    done(files) { stderr.write(`TOP collector: safe summary created from ${files} parsed file(s).\n`); },
  };
}

function claudeUsage(record) {
  if (!record || record.type !== "assistant" || !record.message || !record.message.usage) return null;
  const usage = record.message.usage;
  const values = {
    input_tokens: safeCount(usage.input_tokens),
    cache_write_input_tokens: safeCount(usage.cache_creation_input_tokens),
    cache_read_input_tokens: safeCount(usage.cache_read_input_tokens),
    output_tokens: safeCount(usage.output_tokens),
    reasoning_output_tokens: 0,
    usage_records: 1,
  };
  if (Object.values(values).slice(0, 4).some(value => value === null)) return { malformed: true };
  if (!(values.input_tokens || values.cache_write_input_tokens || values.cache_read_input_tokens || values.output_tokens)) return null;
  return values;
}

function stableIdPart(value) {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

async function consumePartition(filePath, callback) {
  try {
    await stat(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw new Error("A private collector spool could not be read.");
  }
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    callback(JSON.parse(line));
  }
}

async function collectClaude(roots, progress, schema) {
  const v2 = schema === "v2";
  const coverage = emptyCoverage();
  const secret = randomBytes(32);
  const metadataKey = v2 ? randomBytes(32) : null;
  const spoolDirectory = await mkdtemp(path.join(tmpdir(), "top-collector-"));
  const spool = new PartitionSpool(spoolDirectory);
  const activeDays = new Set();
  const failedFiles = new Set();
  let fileIndex = 0;
  let spoolClosed = false;
  let uniqueSpool = null;
  let uniqueSpoolClosed = false;
  try {
    for (const root of roots) {
      for await (const item of jsonlFiles(root)) {
        coverage.files_discovered++;
        if (item.skipped) {
          coverage.files_skipped++;
          coverage.complete = false;
          continue;
        }
        const currentIndex = fileIndex++;
        let lineIndex = 0;
        let foundUsage = false;
        const fileDays = new Set();
        try {
          await streamLines(item.filePath, line => {
            const currentLine = lineIndex++;
            const trimmed = String(line || "").trim();
            if (!trimmed) return;
            let record;
            try { record = JSON.parse(trimmed); } catch { coverage.malformed_lines++; coverage.complete = false; return; }
            const usage = claudeUsage(record);
            if (!usage) return;
            if (usage.malformed) { coverage.malformed_lines++; coverage.complete = false; return; }
            foundUsage = true;
            const messageId = stableIdPart(record.message.id);
            const requestId = stableIdPart(record.requestId);
            const identity = messageId !== null || requestId !== null
              ? ["call", messageId, requestId]
              : ["line", currentIndex, currentLine];
            const digest = privateDigest(secret, identity);
            const sessionId = stableIdPart(record.sessionId);
            const sessionDigest = sessionId !== null
              ? privateDigest(secret, ["session", sessionId])
              : privateDigest(secret, ["file-session", currentIndex]);
            const day = v2 ? validCalendarDay(record.timestamp) : dateOnly(record.timestamp);
            const time = v2 && day ? timeOnlyForLocalAggregation(record.timestamp) : null;
            const callValue = { file_index: currentIndex, model: sanitizeModelLabel(record.message.model), ...usage };
            if (v2) Object.assign(callValue, {
              private_metadata: sealPrivateMetadata(metadataKey, { session_digest: sessionDigest, day, time_ms: time }),
            });
            spool.write("calls", digest, callValue);
            if (sessionId !== null || v2) {
              spool.write("sessions", sessionDigest, currentIndex);
            }
            if (day) fileDays.add(day);
          }, () => { coverage.oversized_lines++; coverage.complete = false; }, count => progress.bytes(count, coverage.files_parsed), () => spool.waitForDrain());
          coverage.files_parsed++;
          if (foundUsage) coverage.files_with_usage++;
          for (const day of fileDays) activeDays.add(day);
        } catch {
          failedFiles.add(currentIndex);
          coverage.files_skipped++;
          coverage.complete = false;
        }
        progress.file(coverage.files_parsed + coverage.files_skipped);
      }
    }
    await spool.close();
    spoolClosed = true;
    progress.phase("deduplicating content-free usage counters");
    const aggregate = new Map();
    const unions = v2 ? new PrivateUnionFind() : null;
    if (v2) uniqueSpool = new PartitionSpool(spoolDirectory);
    let uniqueCalls = 0;
    let inputCallRows = 0;
    for (let partition = 0; partition < PARTITIONS; partition++) {
      const calls = new Map();
      await consumePartition(path.join(spoolDirectory, `calls-${partition}.jsonl`), ({ digest, value }) => {
        if (failedFiles.has(value.file_index)) return;
        inputCallRows++;
        delete value.file_index;
        if (v2) {
          const metadata = openPrivateMetadata(metadataKey, value.private_metadata);
          delete value.private_metadata;
          value.session_digest = metadata.session_digest;
          value.day = metadata.day;
          value.time_ms = metadata.time_ms;
        }
        const previous = calls.get(digest);
        if (!previous) {
          if (v2) {
            value.session_digests = [value.session_digest];
            value.day_known = value.day !== null;
            value.time_known = value.time_ms !== null;
            delete value.session_digest;
          }
          calls.set(digest, value);
          return;
        }
        if (v2 && !previous.session_digests.includes(value.session_digest)) previous.session_digests.push(value.session_digest);
        if (v2 && value.day !== null) previous.day_known = true;
        if (v2 && value.time_ms !== null) previous.time_known = true;
        if (v2 && value.day && (!previous.day || value.day < previous.day)) previous.day = value.day;
        if (v2 && value.time_ms !== null && (previous.time_ms === null || value.time_ms < previous.time_ms)) previous.time_ms = value.time_ms;
        if (previous.model === SAFE_MODEL_FALLBACK && value.model !== SAFE_MODEL_FALLBACK) previous.model = value.model;
        for (const key of ["input_tokens", "cache_write_input_tokens", "cache_read_input_tokens", "output_tokens"]) {
          previous[key] = Math.max(previous[key], value[key]);
        }
      });
      uniqueCalls += calls.size;
      for (const [digest, row] of calls) {
        if (v2) {
          const sessionDigest = row.session_digests[0];
          unions.add(sessionDigest);
          for (let index = 1; index < row.session_digests.length; index++) unions.union(sessionDigest, row.session_digests[index]);
          uniqueSpool.write("unique", digest, {
            private_metadata: sealPrivateMetadata(metadataKey, {
              session_digest: sessionDigest,
              day: row.day,
              time_ms: row.time_ms,
              day_known: row.day_known,
              time_known: row.time_known,
            }),
            input_tokens: row.input_tokens,
            cache_write_input_tokens: row.cache_write_input_tokens,
            cache_read_input_tokens: row.cache_read_input_tokens,
            output_tokens: row.output_tokens,
            reasoning_output_tokens: row.reasoning_output_tokens,
            usage_records: row.usage_records,
          });
        }
        const target = aggregate.get(row.model) || emptyModelRow();
        mergeModelRow(target, row);
        aggregate.set(row.model, target);
      }
      if (v2) await uniqueSpool.waitForDrain();
    }
    if (v2) {
      await uniqueSpool.close();
      uniqueSpoolClosed = true;
    }
    coverage.duplicate_usage_records = inputCallRows - uniqueCalls;
    let sessionCount = 0;
    for (let partition = 0; partition < PARTITIONS; partition++) {
      const sessions = new Set();
      await consumePartition(path.join(spoolDirectory, `sessions-${partition}.jsonl`), ({ digest, value }) => {
        if (!failedFiles.has(value)) sessions.add(digest);
      });
      sessionCount += sessions.size;
    }
    if (!uniqueCalls) throw new Error("No supported usage counters were found for that source.");
    const base = reportFromAggregate("claude-code", coverage, aggregate, sessionCount || coverage.files_with_usage, activeDays.size);
    if (!v2) return base;
    const logicalSessions = new Map();
    const timeline = new Map();
    for (let partition = 0; partition < PARTITIONS; partition++) {
      await consumePartition(path.join(spoolDirectory, `unique-${partition}.jsonl`), ({ value }) => {
        const metadata = openPrivateMetadata(metadataKey, value.private_metadata);
        const root = unions.find(metadata.session_digest);
        const session = logicalSessions.get(root) || emptySessionAggregate();
        mergeUsageIntoSession(session, value, metadata.day, metadata.time_ms, metadata.day_known, metadata.time_known);
        logicalSessions.set(root, session);
        mergeUsageIntoTimeline(timeline, value, metadata.day);
      });
    }
    return reportV2FromBase(base, "claude-code", logicalSessions, timeline);
  } finally {
    if (uniqueSpool && !uniqueSpoolClosed) {
      try { await uniqueSpool.close(); } catch { /* the original generic error is safer */ }
    }
    if (!spoolClosed) {
      try { await spool.close(); } catch { /* the original generic error is safer */ }
    }
    try {
      await rm(spoolDirectory, { recursive: true, force: true });
    } finally {
      secret.fill(0);
      if (metadataKey) metadataKey.fill(0);
    }
  }
}

function checkedCodexUsage(value) {
  if (!value || typeof value !== "object") return null;
  const input = safeCount(value.input_tokens);
  const cached = safeCount(value.cached_input_tokens);
  const output = safeCount(value.output_tokens);
  const reasoning = safeCount(value.reasoning_output_tokens);
  const total = safeCount(value.total_tokens);
  if ([input, cached, output, reasoning, total].some(item => item === null)) return null;
  if (cached > input || reasoning > output) return null;
  return { input, cached, output, reasoning, total };
}

function subtractCodexUsage(current, previous) {
  if (!current) return null;
  if (!previous) return current;
  const delta = {
    input: current.input - previous.input,
    cached: current.cached - previous.cached,
    output: current.output - previous.output,
    reasoning: current.reasoning - previous.reasoning,
    total: current.total - previous.total,
  };
  return Object.values(delta).some(value => value < 0) ? null : delta;
}

class CodexSessionTrustError extends Error {}

async function collectCodex(roots, progress, schema) {
  const v2 = schema === "v2";
  const coverage = emptyCoverage();
  const aggregate = new Map();
  const activeDays = new Set();
  const logicalSessions = new Map();
  const timeline = new Map();
  const secret = randomBytes(32);
  const acceptedFileDigests = new Set();
  const acceptedSessionDigests = new Set();
  let logicalSessionIndex = 0;
  try {
    for (const root of roots) {
      for await (const item of jsonlFiles(root)) {
        coverage.files_discovered++;
        if (item.skipped) {
          coverage.files_skipped++;
          coverage.complete = false;
          continue;
        }
        const state = {
          currentModel: SAFE_MODEL_FALLBACK,
          previousTotal: null,
          lastTotalSignature: null,
          foundUsage: false,
          sessionDigest: null,
          conflictingSessionIds: false,
        };
        const fileAggregate = new Map();
        const fileDays = new Set();
        const fileSession = emptySessionAggregate();
        const fileTimeline = new Map();
        const fileHmac = createHmac("sha256", secret);
        try {
          await streamLines(item.filePath, line => {
            const trimmed = String(line || "").trim();
            if (!trimmed) return;
            let record;
            try { record = JSON.parse(trimmed); } catch { coverage.malformed_lines++; coverage.complete = false; return; }
            if (!record || typeof record !== "object") return;
            if (record.type === "session_meta") {
              const sessionId = stableIdPart(record.payload && record.payload.id);
              if (sessionId !== null) {
                const digest = privateDigest(secret, ["codex-session", sessionId]);
                if (state.sessionDigest !== null && state.sessionDigest !== digest) state.conflictingSessionIds = true;
                else state.sessionDigest = digest;
              }
              return;
            }
            if (record.type === "turn_context") {
              state.currentModel = sanitizeModelLabel(record.payload && record.payload.model);
              return;
            }
            if (record.type === "event_msg" && record.payload && record.payload.type === "model_reroute") {
              state.currentModel = sanitizeModelLabel(record.payload.to_model);
              return;
            }
            if (record.type !== "event_msg" || !record.payload || record.payload.type !== "token_count") return;
            const info = record.payload.info;
            if (!info || typeof info !== "object") return;
            const total = checkedCodexUsage(info.total_token_usage);
            const last = checkedCodexUsage(info.last_token_usage);
            let usage = null;
            if (total) {
              const signature = `${total.input}|${total.cached}|${total.output}|${total.reasoning}|${total.total}`;
              if (state.lastTotalSignature === signature) { coverage.duplicate_usage_records++; return; }
              state.lastTotalSignature = signature;
              usage = subtractCodexUsage(total, state.previousTotal);
              if (!usage) {
                coverage.counter_resets++;
                coverage.complete = false;
                if (last) usage = last;
              }
              state.previousTotal = total;
            } else if (last) {
              usage = last;
              coverage.complete = false;
            } else {
              coverage.complete = false;
              return;
            }
            if (!usage) return;
            if (usage.total !== usage.input + usage.output) coverage.complete = false;
            if (!(usage.input || usage.cached || usage.output || usage.reasoning)) return;
            const usageRow = {
              input_tokens: usage.input - usage.cached,
              cache_write_input_tokens: 0,
              cache_read_input_tokens: usage.cached,
              output_tokens: usage.output,
              reasoning_output_tokens: usage.reasoning,
              usage_records: 1,
            };
            const row = fileAggregate.get(state.currentModel) || emptyModelRow();
            mergeModelRow(row, usageRow);
            fileAggregate.set(state.currentModel, row);
            state.foundUsage = true;
            const day = v2 ? validCalendarDay(record.timestamp) : dateOnly(record.timestamp);
            if (v2) {
              const time = day ? timeOnlyForLocalAggregation(record.timestamp) : null;
              mergeUsageIntoSession(fileSession, usageRow, day, time);
              mergeUsageIntoTimeline(fileTimeline, usageRow, day);
            }
            if (day) fileDays.add(day);
          }, () => { coverage.oversized_lines++; coverage.complete = false; }, count => progress.bytes(count, coverage.files_parsed), undefined, chunk => fileHmac.update(chunk));
          coverage.files_parsed++;
          if (state.foundUsage) {
            coverage.files_with_usage++;
            const fileDigest = fileHmac.digest("hex");
            const usageRecords = [...fileAggregate.values()].reduce((total, row) => addSafe(total, row.usage_records), 0);
            if (acceptedFileDigests.has(fileDigest)) {
              coverage.duplicate_usage_records = addSafe(coverage.duplicate_usage_records, usageRecords);
            } else {
              if (state.conflictingSessionIds || state.sessionDigest === null) {
                throw new CodexSessionTrustError("A Codex usage file has no single stable session identity, so TOP stopped instead of risking a duplicate total.");
              }
              if (acceptedSessionDigests.has(state.sessionDigest)) {
                throw new CodexSessionTrustError("Two different Codex files claim the same session, so TOP stopped instead of risking a duplicate total.");
              }
              acceptedFileDigests.add(fileDigest);
              acceptedSessionDigests.add(state.sessionDigest);
              for (const [model, fileRow] of fileAggregate) {
                const target = aggregate.get(model) || emptyModelRow();
                mergeModelRow(target, fileRow);
                aggregate.set(model, target);
              }
              for (const day of fileDays) activeDays.add(day);
              if (v2) {
                logicalSessions.set(logicalSessionIndex++, fileSession);
                for (const [period, fileRow] of fileTimeline) {
                  const target = timeline.get(period) || emptyTimelineAggregate();
                  mergeModelRow(target, fileRow);
                  for (const day of fileRow.days) target.days.add(day);
                  timeline.set(period, target);
                }
              }
            }
          }
        } catch (error) {
          if (error instanceof CodexSessionTrustError) throw error;
          coverage.files_skipped++;
          coverage.complete = false;
        }
        progress.file(coverage.files_parsed + coverage.files_skipped);
      }
    }
    if (![...aggregate.values()].some(row => row.usage_records > 0)) throw new Error("No supported usage counters were found for that source.");
    const acceptedSessions = v2 ? logicalSessions.size : acceptedSessionDigests.size;
    const base = reportFromAggregate("codex", coverage, aggregate, acceptedSessions, activeDays.size);
    return v2 ? reportV2FromBase(base, "codex", logicalSessions, timeline) : base;
  } finally {
    secret.fill(0);
  }
}

export async function collectUsage({ source, roots, progress = createNoopProgress(), schema = "v1" }) {
  if (!ALLOWED_SOURCES.has(source)) throw new Error("Source must be claude-code or codex.");
  if (schema !== "v1" && schema !== "v2") throw new Error("Schema must be v1 or v2.");
  const profile = process.env.USERPROFILE || process.env.HOME;
  if (!roots && !profile) throw new Error("The Windows user profile directory could not be found.");
  const selectedRoots = roots || defaultRoots(source, profile);
  progress.start(source);
  const report = source === "claude-code"
    ? await collectClaude(selectedRoots, progress, schema)
    : await collectCodex(selectedRoots, progress, schema);
  progress.done(report.coverage.files_parsed);
  return report;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} has an unsupported field.`);
}

function assertCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative safe integer.`);
}

export function validateSafeReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("Report must be an object.");
  exactKeys(report, ["schema_version", "collector_version", "parser_version", "generated_date", "source", "coverage", "totals", "activity", "by_model"], "Report");
  if (report.schema_version !== SCHEMA_VERSION || report.collector_version !== COLLECTOR_VERSION || report.parser_version !== PARSER_VERSION) throw new Error("Report version is unsupported.");
  if (!dateOnly(report.generated_date) || report.generated_date.length !== 10) throw new Error("Report date must contain a date only.");
  exactKeys(report.source, ["provider", "surface"], "Source");
  const validPair = (report.source.provider === "anthropic" && report.source.surface === "claude_code") || (report.source.provider === "openai" && report.source.surface === "codex");
  if (!validPair) throw new Error("Source provider and surface do not match.");
  const coverageKeys = ["files_discovered", "files_parsed", "files_with_usage", "files_skipped", "malformed_lines", "oversized_lines", "counter_resets", "duplicate_usage_records", "complete"];
  exactKeys(report.coverage, coverageKeys, "Coverage");
  for (const key of coverageKeys.filter(key => key !== "complete")) assertCount(report.coverage[key], `coverage.${key}`);
  if (typeof report.coverage.complete !== "boolean") throw new Error("coverage.complete must be boolean.");
  if (report.coverage.files_parsed + report.coverage.files_skipped !== report.coverage.files_discovered) throw new Error("Coverage file counts do not reconcile.");
  if (report.coverage.files_with_usage > report.coverage.files_parsed) throw new Error("Files with usage exceed parsed files.");
  const totalKeys = ["input_tokens", "cache_write_input_tokens", "cache_read_input_tokens", "output_tokens", "reasoning_output_tokens", "usage_records", "total_tokens"];
  exactKeys(report.totals, totalKeys, "Totals");
  for (const key of totalKeys) assertCount(report.totals[key], `totals.${key}`);
  if (report.totals.reasoning_output_tokens > report.totals.output_tokens) throw new Error("Reasoning tokens exceed output tokens.");
  const total = report.totals.input_tokens + report.totals.cache_write_input_tokens + report.totals.cache_read_input_tokens + report.totals.output_tokens;
  if (report.totals.total_tokens !== total) throw new Error("Total tokens do not reconcile.");
  exactKeys(report.activity, ["sessions", "active_days"], "Activity");
  assertCount(report.activity.sessions, "activity.sessions");
  assertCount(report.activity.active_days, "activity.active_days");
  if (!Array.isArray(report.by_model)) throw new Error("by_model must be an array.");
  const sums = Object.fromEntries(totalKeys.map(key => [key, 0]));
  let previousModel = "";
  for (const row of report.by_model) {
    exactKeys(row, ["model", ...totalKeys], "Model row");
    if (row.model !== sanitizeModelLabel(row.model)) throw new Error("Model row contains an unsafe label.");
    if (previousModel && previousModel.localeCompare(row.model) >= 0) throw new Error("Model rows must be uniquely sorted.");
    previousModel = row.model;
    for (const key of totalKeys) { assertCount(row[key], `by_model.${key}`); sums[key] = addSafe(sums[key], row[key]); }
    if (row.reasoning_output_tokens > row.output_tokens) throw new Error("Model reasoning tokens exceed output tokens.");
    if (row.total_tokens !== row.input_tokens + row.cache_write_input_tokens + row.cache_read_input_tokens + row.output_tokens) throw new Error("Model totals do not reconcile.");
  }
  for (const key of totalKeys) if (sums[key] !== report.totals[key]) throw new Error(`Model rows do not reconcile with totals.${key}.`);
  return true;
}

function assertBucketObject(value, keys, label, expectedTotal) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  exactKeys(value, keys, label);
  let total = 0;
  for (const key of keys) {
    assertCount(value[key], `${label}.${key}`);
    total = addSafe(total, value[key]);
  }
  if (total !== expectedTotal) throw new Error(`${label} does not reconcile with logical sessions.`);
}

function assertRangeReconciliation(buckets, total, ranges, label) {
  let minimum = 0;
  let maximum = 0;
  let unbounded = false;
  for (const [key, lower, upper] of ranges) {
    minimum = addSafe(minimum, buckets[key] * lower);
    if (upper === null && buckets[key] > 0) unbounded = true;
    else if (upper !== null) maximum = addSafe(maximum, buckets[key] * upper);
  }
  if (total < minimum || (!unbounded && total > maximum)) throw new Error(`${label} does not reconcile with its aggregate total.`);
}

export function validateSafeReportV2(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("Report must be an object.");
  const baseKeys = ["schema_version", "collector_version", "parser_version", "generated_date", "source", "coverage", "totals", "activity", "by_model"];
  exactKeys(report, [...baseKeys, "timeline", "session_distributions", "workflow_shape"], "V2 report");
  if (report.schema_version !== SCHEMA_VERSION_V2 || report.collector_version !== COLLECTOR_VERSION_V2 || report.parser_version !== PARSER_VERSION_V2) throw new Error("V2 report version is unsupported.");
  validateSafeReport({
    schema_version: SCHEMA_VERSION,
    collector_version: COLLECTOR_VERSION,
    parser_version: PARSER_VERSION,
    generated_date: report.generated_date,
    source: report.source,
    coverage: report.coverage,
    totals: report.totals,
    activity: report.activity,
    by_model: report.by_model,
  });
  if (report.totals.total_tokens < report.totals.usage_records) throw new Error("Usage records cannot exceed total tokens.");
  for (const row of report.by_model) if (row.total_tokens < row.usage_records) throw new Error("Model usage records cannot exceed model tokens.");

  exactKeys(report.timeline, ["status", "granularity", "timestamp_basis", "periods"], "Timeline");
  if (report.timeline.status !== "available" || report.timeline.granularity !== "calendar_month" || report.timeline.timestamp_basis !== "source_date_prefix_not_timezone_normalized") throw new Error("Timeline metadata is unsupported.");
  if (!Array.isArray(report.timeline.periods) || !report.timeline.periods.length) throw new Error("Timeline periods must be a nonempty array.");
  const timelineCountKeys = [...TOKEN_FIELDS, "total_tokens", "active_days", "logical_sessions_started"];
  const timelineSums = Object.fromEntries(timelineCountKeys.map(key => [key, 0]));
  let previousPeriod = "";
  for (const row of report.timeline.periods) {
    exactKeys(row, ["period", ...timelineCountKeys], "Timeline period");
    if (row.period !== "undated" && !validCalendarMonth(row.period)) throw new Error("Timeline period is invalid.");
    if (previousPeriod === "undated" || (previousPeriod && row.period !== "undated" && previousPeriod.localeCompare(row.period) >= 0)) throw new Error("Timeline periods must be uniquely sorted with undated last.");
    previousPeriod = row.period;
    for (const key of timelineCountKeys) {
      assertCount(row[key], `timeline.${key}`);
      timelineSums[key] = addSafe(timelineSums[key], row[key]);
    }
    if (row.reasoning_output_tokens > row.output_tokens) throw new Error("Timeline reasoning tokens exceed output tokens.");
    if (row.total_tokens !== row.input_tokens + row.cache_write_input_tokens + row.cache_read_input_tokens + row.output_tokens) throw new Error("Timeline token math is invalid.");
    if (row.total_tokens < row.usage_records) throw new Error("Timeline usage records cannot exceed timeline tokens.");
    if (row.period === "undated" && row.active_days !== 0) throw new Error("Undated timeline period cannot claim active days.");
    if (row.usage_records === 0) throw new Error("Timeline periods must contain at least one usage record.");
    if (row.active_days > row.usage_records || (row.period !== "undated" && row.active_days > daysInCalendarMonth(row.period))) throw new Error("Timeline active-day cardinality is impossible.");
    if (row.logical_sessions_started > row.usage_records) throw new Error("Timeline session-start cardinality is impossible.");
  }
  for (const key of [...TOKEN_FIELDS, "total_tokens"]) if (timelineSums[key] !== report.totals[key]) throw new Error(`Timeline does not reconcile with totals.${key}.`);
  if (timelineSums.active_days !== report.activity.active_days) throw new Error("Timeline active days do not reconcile.");
  if (timelineSums.logical_sessions_started !== report.activity.sessions) throw new Error("Timeline session starts do not reconcile.");

  const distributions = report.session_distributions;
  exactKeys(distributions, ["status", "session_definition", "thresholds_version", "elapsed_time_basis", "logical_sessions_analyzed", "usage_records_per_session", "total_tokens_per_session", "elapsed_time_per_session"], "Session distributions");
  if (distributions.status !== "available" || distributions.thresholds_version !== "top.session-buckets.v1" || distributions.elapsed_time_basis !== "wall_clock_span_between_first_and_last_supported_usage_record") throw new Error("Session distribution metadata is unsupported.");
  const expectedDefinition = report.source.surface === "claude_code" ? "deduplicated_logical_session" : "codex_rollout_file_proxy";
  if (distributions.session_definition !== expectedDefinition) throw new Error("Session definition does not match the source.");
  assertCount(distributions.logical_sessions_analyzed, "session_distributions.logical_sessions_analyzed");
  if (distributions.logical_sessions_analyzed !== report.activity.sessions) throw new Error("Logical session count does not reconcile with activity.");
  const sessionTotal = distributions.logical_sessions_analyzed;
  assertBucketObject(distributions.usage_records_per_session, ["zero", "one", "two_to_four", "five_to_nineteen", "twenty_plus"], "Usage-record distribution", sessionTotal);
  assertBucketObject(distributions.total_tokens_per_session, ["under_10k", "ten_to_49k", "fifty_to_199k", "two_hundred_to_999k", "one_million_plus"], "Token distribution", sessionTotal);
  assertBucketObject(distributions.elapsed_time_per_session, ["under_10m", "ten_to_59m", "one_to_3h", "four_to_11h", "twelve_h_plus", "unknown"], "Elapsed-time distribution", sessionTotal);
  assertRangeReconciliation(distributions.usage_records_per_session, report.totals.usage_records, [
    ["zero", 0, 0],
    ["one", 1, 1],
    ["two_to_four", 2, 4],
    ["five_to_nineteen", 5, 19],
    ["twenty_plus", 20, null],
  ], "Usage-record distribution");
  assertRangeReconciliation(distributions.total_tokens_per_session, report.totals.total_tokens, [
    ["under_10k", 0, 9_999],
    ["ten_to_49k", 10_000, 49_999],
    ["fifty_to_199k", 50_000, 199_999],
    ["two_hundred_to_999k", 200_000, 999_999],
    ["one_million_plus", 1_000_000, null],
  ], "Token distribution");

  exactKeys(report.workflow_shape, ["status", "algorithm_version", "basis", "sessions"], "Workflow shape");
  if (report.workflow_shape.status !== "available" || report.workflow_shape.algorithm_version !== "top.workflow-shape.v1" || report.workflow_shape.basis !== "deduplicated_usage_record_count_only") throw new Error("Workflow shape metadata is unsupported.");
  assertBucketObject(report.workflow_shape.sessions, ["single_exchange", "short_multi_exchange", "sustained", "high_iteration", "unclassified"], "Workflow shape sessions", sessionTotal);
  const usageToShape = {
    zero: "unclassified",
    one: "single_exchange",
    two_to_four: "short_multi_exchange",
    five_to_nineteen: "sustained",
    twenty_plus: "high_iteration",
  };
  for (const [usageKey, shapeKey] of Object.entries(usageToShape)) {
    if (distributions.usage_records_per_session[usageKey] !== report.workflow_shape.sessions[shapeKey]) throw new Error("Workflow shape does not reconcile with usage-record buckets.");
  }
  return true;
}

function parseArgs(argv) {
  let source = null;
  let output = null;
  let schema = "v1";
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--source") source = argv[++index];
    else if (argument === "--output") output = argv[++index];
    else if (argument === "--schema") schema = argv[++index];
    else throw new Error("Usage: node top-collector.mjs --source claude-code|codex [--schema v1|v2] [--output summary.json]");
  }
  if (!ALLOWED_SOURCES.has(source) || (schema !== "v1" && schema !== "v2")) throw new Error("Usage: node top-collector.mjs --source claude-code|codex [--schema v1|v2] [--output summary.json]");
  if (output !== null && (!output || path.extname(output).toLowerCase() !== ".json")) throw new Error("Output must be a .json file.");
  return { source, output, schema };
}

async function availableDefaultOutput(profile, source, generatedDate, schema) {
  const directory = path.join(profile, "Downloads");
  await mkdir(directory, { recursive: true });
  const base = `top-safe-usage${schema === "v2" ? "-v2" : ""}-${source}-${generatedDate}`;
  for (let suffix = 1; suffix < 1000; suffix++) {
    const candidate = path.join(directory, `${base}${suffix === 1 ? "" : `-${suffix}`}.json`);
    try { await stat(candidate); } catch (error) { if (error && error.code === "ENOENT") return candidate; throw error; }
  }
  throw new Error("A free output filename could not be found.");
}

async function writeNewFile(destination, text) {
  await mkdir(path.dirname(destination), { recursive: true });
  const handle = await open(destination, "wx", 0o600);
  try { await handle.writeFile(text, "utf8"); } finally { await handle.close(); }
}

export async function runCli(argv, environment = process.env, stderr = process.stderr) {
  const { source, output, schema } = parseArgs(argv);
  const profile = environment.USERPROFILE || environment.HOME;
  if (!profile) throw new Error("The Windows user profile directory could not be found.");
  const previousUserProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;
  process.env.USERPROFILE = environment.USERPROFILE || "";
  process.env.HOME = environment.HOME || "";
  try {
    const report = await collectUsage({ source, roots: defaultRoots(source, profile), progress: createStderrProgress(stderr), schema });
    const destination = output ? path.resolve(output) : await availableDefaultOutput(profile, source, report.generated_date, schema);
    await writeNewFile(destination, JSON.stringify(report, null, 2) + "\n");
    return destination;
  } finally {
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  }
}

async function main() {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const safeMessages = new Set([
      "Usage: node top-collector.mjs --source claude-code|codex [--schema v1|v2] [--output summary.json]",
      "Output must be a .json file.",
      "The Windows user profile directory could not be found.",
      "No supported usage counters were found for that source.",
      "A source directory could not be read.",
      "Usage counters exceed the supported safe integer range.",
      "A Codex usage file has no single stable session identity, so TOP stopped instead of risking a duplicate total.",
      "Two different Codex files claim the same session, so TOP stopped instead of risking a duplicate total.",
    ]);
    const message = safeMessages.has(error && error.message) ? error.message : "The collector could not create a safe summary.";
    process.stderr.write(`TOP collector: ${message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && path.resolve(fileURLToPath(import.meta.url)) === invokedPath) await main();
