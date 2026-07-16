const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const start = html.indexOf('<textarea id="scripttext"');
const bodyStart = html.indexOf(">", start) + 1;
const end = html.indexOf("</textarea>", bodyStart);
assert.ok(start >= 0 && bodyStart > start && end > bodyStart, "privacy script must be embedded");
const script = html.slice(bodyStart, end);

function pythonCommand() {
  const candidates = process.platform === "win32"
    ? [["py", ["-3"]], ["python", []], ["python3", []]]
    : [["python3", []], ["python", []]];
  for (const [command, args] of candidates) {
    const probe = spawnSync(command, [...args, "--version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return { command, args };
  }
  throw new Error("Python 3 is required to verify the Route B privacy script");
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "top-strip-privacy-"));
try {
  const project = path.join(temp, ".claude", "projects", "demo");
  fs.mkdirSync(project, { recursive: true });
  const records = [
    { output: 10, messageId: "RAW-MESSAGE-SECRET-1", requestId: "RAW-REQUEST-SECRET-1" },
    { output: 25, messageId: "RAW-MESSAGE-SECRET-1", requestId: "RAW-REQUEST-SECRET-1" },
    { output: 7, messageId: "RAW-MESSAGE-SECRET-2", requestId: "RAW-REQUEST-SECRET-2" },
  ].map(({ output, messageId, requestId }, index) => JSON.stringify({
    type: "assistant",
    timestamp: `2026-07-15T00:00:0${index}Z`,
    sessionId: "RAW-SESSION-SECRET",
    uuid: `RAW-UUID-SECRET-${index}`,
    requestId,
    permissionMode: "default",
    agentName: "RAW-AGENT-NAME",
    attributionSkill: "RAW-SKILL-NAME",
    attributionMcpServer: "RAW-MCP-SERVER",
    attributionMcpTool: "RAW-MCP-TOOL",
    promptSource: "RAW-PROMPT-SOURCE",
    entrypoint: "RAW-ENTRYPOINT",
    message: {
      id: messageId,
      role: "assistant",
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "RAW-PROMPT-OR-REPLY-SECRET" }],
      usage: {
        input_tokens: 100,
        output_tokens: output,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 20,
      },
    },
  }));
  fs.writeFileSync(path.join(project, "session.jsonl"), records.join("\n") + "\n");
  const secondProject = path.join(temp, ".claude", "projects", "zz-demo-two");
  fs.mkdirSync(secondProject, { recursive: true });
  const extraRecords = [
    {
      sessionId: "RAW-SESSION-SECRET",
      messageId: "RAW-MESSAGE-SECRET-3",
      requestId: "RAW-EXTRA-REQUEST-0",
      output: 9,
      input: 100,
      timestamp: "2026-07-15T00:01:00Z",
      permissionMode: "default",
      model: "claude-opus-4-8",
    },
    {
      sessionId: "RAW-SESSION-SECRET-2",
      messageId: "RAW-MESSAGE-SECRET-1",
      requestId: "RAW-REQUEST-SECRET-1",
      output: 11,
      input: "RAW-TOKEN-VALUE-SECRET",
      timestamp: "RAW-TIMESTAMP-VALUE-SECRET",
      permissionMode: "RAW-PERMISSION-VALUE-SECRET with spaces",
      model: "RAW-MODEL-VALUE-SECRET with spaces",
    },
    {
      sessionId: "RAW-SESSION-SECRET-2",
      messageId: "RAW-ZERO-USAGE-MESSAGE",
      requestId: "RAW-EXTRA-REQUEST-2",
      output: 0,
      input: 0,
      timestamp: "2026-07-15T00:01:02Z",
      permissionMode: "default",
      model: "claude-opus-4-8",
    },
  ].map(({ sessionId, messageId, requestId, output, input, timestamp, permissionMode, model }) => JSON.stringify({
    type: "assistant",
    timestamp,
    sessionId,
    requestId,
    permissionMode,
    message: {
      id: messageId,
      role: "assistant",
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }));
  fs.writeFileSync(path.join(secondProject, "session.jsonl"), extraRecords.join("\n") + "\n");
  for (const [folder, output] of [["zz-no-id-a", 13], ["zz-no-id-b", 17]]) {
    const noIdProject = path.join(temp, ".claude", "projects", folder);
    fs.mkdirSync(noIdProject, { recursive: true });
    fs.writeFileSync(path.join(noIdProject, "session.jsonl"), JSON.stringify({
      type: "assistant",
      timestamp: "2026-07-15T00:02:00Z",
      sessionId: "RAW-SESSION-SECRET",
      permissionMode: "default",
      message: {
        role: "assistant",
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 100,
          output_tokens: output,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    }) + "\n");
  }
  fs.writeFileSync(path.join(temp, "strip_claude_logs.py"), script);

  const python = pythonCommand();
  const run = spawnSync(python.command, [...python.args, "strip_claude_logs.py"], {
    cwd: temp,
    env: { ...process.env, HOME: temp, USERPROFILE: temp },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout || "privacy script failed");

  const output = fs.readFileSync(path.join(temp, "claude-usage-only.jsonl"), "utf8");
  for (const raw of [
    "RAW-SESSION-SECRET", "RAW-MESSAGE-SECRET", "RAW-REQUEST-SECRET", "RAW-EXTRA-REQUEST",
    "RAW-UUID-SECRET", "RAW-PROMPT-OR-REPLY-SECRET", "RAW-AGENT-NAME",
    "RAW-SKILL-NAME", "RAW-MCP-SERVER", "RAW-MCP-TOOL", "RAW-PROMPT-SOURCE", "RAW-ENTRYPOINT",
    "RAW-TOKEN-VALUE-SECRET", "RAW-TIMESTAMP-VALUE-SECRET",
    "RAW-PERMISSION-VALUE-SECRET", "RAW-MODEL-VALUE-SECRET",
  ]) assert.doesNotMatch(output, new RegExp(raw), `${raw} must not be written`);

  const rows = output.trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.length, 6, "duplicates and zero-usage records must be removed without collapsing separate calls");
  assert.deepEqual(rows.map((row) => row.usage.output_tokens), [25, 7, 9, 11, 13, 17]);
  assert.deepEqual(rows.map((row) => row.session_number), [1, 1, 1, 2, 1, 1],
    "the same raw session across files must keep one safe number, while a new session gets a new number");
  for (const row of rows) {
    for (const key of ["sessionId", "message_id", "requestId", "uuid"])
      assert.equal(key in row, false, `${key} must not appear in the safe file`);
  }
  for (const row of rows.filter((_, index) => index !== 3)) {
    assert.deepEqual(Object.keys(row).sort(), ["model", "permissionMode", "session_number", "timestamp", "usage"],
      "the safe file must expose only the fields disclosed in the Route B instructions");
  }
  assert.deepEqual(rows[3], {
    model: "unknown",
    usage: {
      output_tokens: 11,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    session_number: 2,
  }, "invalid labels and nonnumeric counters must be removed instead of copied");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("TOP Analyzer strip-script privacy regression tests passed");
