"use strict";

/*
 * Build a content-free forecast evaluation corpus from the private parity CSV.
 *
 * Privacy boundary:
 * - input can contain private descriptions and identifiers;
 * - output contains no description, session ID, user, timestamp, file name, or
 *   original project value;
 * - projects become stable first-seen labels (project_001, project_002, ...);
 * - chronological order becomes a zero-based integer.
 *
 * The generated JSON is local evaluation data and must not be committed.
 */

const fs = require("fs");
const path = require("path");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitize(sourcePath) {
  const parsed = parseCsv(fs.readFileSync(sourcePath, "utf8"));
  if (parsed.length < 2) throw new Error("parity CSV has no data rows");
  const header = parsed[0];
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const required = ["project", "archetype", "turn_count", "cost_usd", "start_ts"];
  for (const name of required) {
    if (!(name in index)) throw new Error(`missing required column: ${name}`);
  }

  const safe = [];
  for (const fields of parsed.slice(1)) {
    const cost = numberOrNull(fields[index.cost_usd]);
    const turns = numberOrNull(fields[index.turn_count]);
    const ts = fields[index.start_ts] || "";
    if (!(cost > 0) || !(turns >= 1) || !ts) continue;
    safe.push({
      rawProject: fields[index.project] || "unknown",
      archetype: fields[index.archetype] || "misc",
      cost_usd: cost,
      turn_count: Math.trunc(turns),
      sortKey: ts
    });
  }
  safe.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const projectLabels = new Map();
  function labelProject(raw) {
    if (!projectLabels.has(raw)) {
      projectLabels.set(raw, `project_${String(projectLabels.size + 1).padStart(3, "0")}`);
    }
    return projectLabels.get(raw);
  }

  return {
    schema_version: 1,
    privacy: "content-free: no prompts, identifiers, timestamps, file names, or original project values",
    rows: safe.map((row, order) => ({
      order,
      project: labelProject(row.rawProject),
      archetype: row.archetype,
      cost_usd: row.cost_usd,
      turn_count: row.turn_count
    }))
  };
}

function main() {
  const source = process.argv[2];
  const destination = process.argv[3];
  if (!source || !destination) {
    throw new Error("usage: node sanitize-parity.cjs <private sessions.csv> <local safe.json>");
  }
  const output = sanitize(source);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(output)}\n`, { flag: "w" });
  process.stdout.write(`sanitized_rows=${output.rows.length} projects=${new Set(output.rows.map(r => r.project)).size}\n`);
}

if (require.main === module) main();
module.exports = { parseCsv, sanitize };
