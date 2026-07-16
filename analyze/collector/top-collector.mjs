#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createInterface } from "node:readline";

export const SCHEMA_VERSION = "top.safe-usage.v1";
export const COLLECTOR_VERSION = "top.local-collector.2026-07-16.1";
export const PARSER_VERSION = "top.usage-parser.2026-07-16.2";
export const MAX_LINE_CHARS = 2 * 1024 * 1024;

const PARTITIONS = 64;
const PROGRESS_BYTES = 128 * 1024 * 1024;
const SAFE_MODEL_FALLBACK = "Unrecognized AI version";
const ALLOWED_SOURCES = new Set(["claude-code", "codex"]);

function dateOnly(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
  return match ? match[1] : null;
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
  for (const key of ["input_tokens", "cache_write_input_tokens", "cache_read_input_tokens", "output_tokens", "reasoning_output_tokens", "usage_records"]) {
    target[key] = addSafe(target[key], row[key]);
  }
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

async function streamLines(filePath, onLine, onOversized, onBytes, afterChunk) {
  const input = createReadStream(filePath, { encoding: "utf8", highWaterMark: 64 * 1024 });
  const collector = createBoundedLineCollector(onLine, onOversized);
  for await (const chunk of input) {
    onBytes(Buffer.byteLength(chunk, "utf8"));
    collector.push(chunk);
    if (afterChunk) await afterChunk();
  }
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

async function collectClaude(roots, progress) {
  const coverage = emptyCoverage();
  const secret = randomBytes(32);
  const spoolDirectory = await mkdtemp(path.join(tmpdir(), "top-collector-"));
  const spool = new PartitionSpool(spoolDirectory);
  const activeDays = new Set();
  const failedFiles = new Set();
  let fileIndex = 0;
  let spoolClosed = false;
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
            spool.write("calls", digest, { file_index: currentIndex, model: sanitizeModelLabel(record.message.model), ...usage });
            const sessionId = stableIdPart(record.sessionId);
            if (sessionId !== null) {
              const sessionDigest = privateDigest(secret, ["session", sessionId]);
              spool.write("sessions", sessionDigest, currentIndex);
            }
            const day = dateOnly(record.timestamp);
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
    let uniqueCalls = 0;
    let inputCallRows = 0;
    for (let partition = 0; partition < PARTITIONS; partition++) {
      const calls = new Map();
      await consumePartition(path.join(spoolDirectory, `calls-${partition}.jsonl`), ({ digest, value }) => {
        if (failedFiles.has(value.file_index)) return;
        inputCallRows++;
        delete value.file_index;
        const previous = calls.get(digest);
        if (!previous) {
          calls.set(digest, value);
          return;
        }
        if (previous.model === SAFE_MODEL_FALLBACK && value.model !== SAFE_MODEL_FALLBACK) previous.model = value.model;
        for (const key of ["input_tokens", "cache_write_input_tokens", "cache_read_input_tokens", "output_tokens"]) {
          previous[key] = Math.max(previous[key], value[key]);
        }
      });
      uniqueCalls += calls.size;
      for (const row of calls.values()) {
        const target = aggregate.get(row.model) || emptyModelRow();
        mergeModelRow(target, row);
        aggregate.set(row.model, target);
      }
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
    return reportFromAggregate("claude-code", coverage, aggregate, sessionCount || coverage.files_with_usage, activeDays.size);
  } finally {
    if (!spoolClosed) {
      try { await spool.close(); } catch { /* the original generic error is safer */ }
    }
    await rm(spoolDirectory, { recursive: true, force: true });
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

async function collectCodex(roots, progress) {
  const coverage = emptyCoverage();
  const aggregate = new Map();
  const activeDays = new Set();
  for (const root of roots) {
    for await (const item of jsonlFiles(root)) {
      coverage.files_discovered++;
      if (item.skipped) {
        coverage.files_skipped++;
        coverage.complete = false;
        continue;
      }
      const state = { currentModel: SAFE_MODEL_FALLBACK, previousTotal: null, lastTotalSignature: null, foundUsage: false };
      const fileAggregate = new Map();
      const fileDays = new Set();
      try {
        await streamLines(item.filePath, line => {
          const trimmed = String(line || "").trim();
          if (!trimmed) return;
          let record;
          try { record = JSON.parse(trimmed); } catch { coverage.malformed_lines++; coverage.complete = false; return; }
          if (!record || typeof record !== "object") return;
          if (record.type === "turn_context") {
            if (record.payload && record.payload.model !== undefined) state.currentModel = sanitizeModelLabel(record.payload.model);
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
          const row = fileAggregate.get(state.currentModel) || emptyModelRow();
          mergeModelRow(row, {
            input_tokens: usage.input - usage.cached,
            cache_write_input_tokens: 0,
            cache_read_input_tokens: usage.cached,
            output_tokens: usage.output,
            reasoning_output_tokens: usage.reasoning,
            usage_records: 1,
          });
          fileAggregate.set(state.currentModel, row);
          state.foundUsage = true;
          const day = dateOnly(record.timestamp);
          if (day) fileDays.add(day);
        }, () => { coverage.oversized_lines++; coverage.complete = false; }, count => progress.bytes(count, coverage.files_parsed));
        coverage.files_parsed++;
        if (state.foundUsage) {
          coverage.files_with_usage++;
          for (const [model, fileRow] of fileAggregate) {
            const target = aggregate.get(model) || emptyModelRow();
            mergeModelRow(target, fileRow);
            aggregate.set(model, target);
          }
          for (const day of fileDays) activeDays.add(day);
        }
      } catch {
        coverage.files_skipped++;
        coverage.complete = false;
      }
      progress.file(coverage.files_parsed + coverage.files_skipped);
    }
  }
  if (![...aggregate.values()].some(row => row.usage_records > 0)) throw new Error("No supported usage counters were found for that source.");
  return reportFromAggregate("codex", coverage, aggregate, coverage.files_with_usage, activeDays.size);
}

export async function collectUsage({ source, roots, progress = createNoopProgress() }) {
  if (!ALLOWED_SOURCES.has(source)) throw new Error("Source must be claude-code or codex.");
  const profile = process.env.USERPROFILE || process.env.HOME;
  if (!roots && !profile) throw new Error("The Windows user profile directory could not be found.");
  const selectedRoots = roots || defaultRoots(source, profile);
  progress.start(source);
  const report = source === "claude-code"
    ? await collectClaude(selectedRoots, progress)
    : await collectCodex(selectedRoots, progress);
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

function parseArgs(argv) {
  let source = null;
  let output = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--source") source = argv[++index];
    else if (argument === "--output") output = argv[++index];
    else throw new Error("Usage: node top-collector.mjs --source claude-code|codex [--output summary.json]");
  }
  if (!ALLOWED_SOURCES.has(source)) throw new Error("Usage: node top-collector.mjs --source claude-code|codex [--output summary.json]");
  if (output !== null && (!output || path.extname(output).toLowerCase() !== ".json")) throw new Error("Output must be a .json file.");
  return { source, output };
}

async function availableDefaultOutput(profile, source, generatedDate) {
  const directory = path.join(profile, "Downloads");
  await mkdir(directory, { recursive: true });
  const base = `top-safe-usage-${source}-${generatedDate}`;
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
  const { source, output } = parseArgs(argv);
  const profile = environment.USERPROFILE || environment.HOME;
  if (!profile) throw new Error("The Windows user profile directory could not be found.");
  const previousUserProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;
  process.env.USERPROFILE = environment.USERPROFILE || "";
  process.env.HOME = environment.HOME || "";
  try {
    const report = await collectUsage({ source, roots: defaultRoots(source, profile), progress: createStderrProgress(stderr) });
    const destination = output ? path.resolve(output) : await availableDefaultOutput(profile, source, report.generated_date);
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
      "Usage: node top-collector.mjs --source claude-code|codex [--output summary.json]",
      "Output must be a .json file.",
      "The Windows user profile directory could not be found.",
      "No supported usage counters were found for that source.",
      "A source directory could not be read.",
      "Usage counters exceed the supported safe integer range.",
    ]);
    const message = safeMessages.has(error && error.message) ? error.message : "The collector could not create a safe summary.";
    process.stderr.write(`TOP collector: ${message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && path.resolve(fileURLToPath(import.meta.url)) === invokedPath) await main();
