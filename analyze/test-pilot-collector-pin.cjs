"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync(new URL("index.html", `file://${__dirname}/`), "utf8");
const collector = fs.readFileSync(new URL("collector/top-collector.mjs", `file://${__dirname}/`), "utf8");
const EXPECTED_COLLECTOR_URL = "https://adamhartley7.github.io/analyze/collector/top-collector.mjs";

test("the guided agent prompt pins the deployed collector URL and bytes", () => {
  const url = /var PILOT_COLLECTOR_URL="([^"]+)";/.exec(html);
  const pin = /var PILOT_COLLECTOR_SHA256="([A-Fa-f0-9]{64})";/.exec(html);
  assert.ok(url, "the guided prompt must carry one exact collector URL");
  assert.ok(pin, "the guided prompt must carry one exact collector SHA-256");
  assert.equal(url[1], EXPECTED_COLLECTOR_URL,
    "the guided prompt must download the reviewed collector path from the canonical site");

  // Git stores this source with LF endings and GitHub Pages serves those exact
  // UTF-8 bytes. Normalize the Windows working-tree copy before hashing so the
  // contract is stable on every contributor machine and in CI.
  const deployedBytes = Buffer.from(collector.replace(/\r\n/g, "\n"), "utf8");
  const deployedHash = crypto.createHash("sha256").update(deployedBytes).digest("hex");

  assert.equal(pin[1].toLowerCase(), deployedHash,
    "a careful stranger's agent must not be told to reject the deployed collector because a CRLF working-tree hash was pinned");
});
