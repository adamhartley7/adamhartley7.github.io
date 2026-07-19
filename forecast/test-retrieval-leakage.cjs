#!/usr/bin/env node
/* LEAKAGE PROOF for retrieval-based forecasting.
 *
 * The prior TOP-1 benchmark's credibility rests on its leakage audit. Retrieval is exactly
 * where leakage would creep back in, because retrieval reads OTHER TASKS' REALISED COSTS.
 * These tests are adversarial: they do not merely assert the gate exists, they plant
 * future data engineered to be maximally attractive to the retriever and show it is inert.
 *
 * Run: node forecast/test-retrieval-leakage.cjs
 */
"use strict";
const F = require("./forecaster.js");
const assert = require("assert");

let passed = 0;
function ok(name, cond, detail) {
  if (!cond) { console.error("FAIL: " + name + (detail ? " -- " + detail : "")); process.exit(1); }
  passed++; console.log("  pass: " + name);
}

const DAY = 86400000;
const T0 = Date.parse("2026-06-01T00:00:00Z");
function rec(dayOffset, cost, sh, ph) {
  return { ts: T0 + dayOffset * DAY, cost_usd: cost, sh: sh.slice().sort((a, b) => a - b), ph: ph };
}

console.log("\n[1] strictly-earlier gate");
{
  // Past: cheap. Future: catastrophically expensive AND a perfect textual match.
  const idx = [
    rec(0, 1.00, [1, 2, 3], 100),
    rec(1, 1.10, [1, 2, 3], 100),
    rec(9, 9999.0, [7, 8, 9], 777),   // future, exact-hash match for the query below
    rec(10, 9999.0, [7, 8, 9], 777)
  ];
  const R = F.buildRetrieval(idx, "description", { k: 3, simFloor: 0.22, halfLifeDays: 5 });
  const q = { ts: T0 + 5 * DAY, sh: [7, 8, 9], ph: 777 };
  const nb = F.retrieveNeighbourhood(q, R);
  ok("perfect future match is not retrieved",
    nb.source !== "exact", "source=" + nb.source);
  ok("mu stays in the past cost regime",
    Math.exp(nb.mu) < 5, "mu$=" + Math.exp(nb.mu).toFixed(3));
}

console.log("\n[2] boundary: ts EXACTLY equal to the query is excluded");
{
  const idx = [rec(0, 1.0, [1, 2, 3], 10), rec(5, 500.0, [4, 5, 6], 20)];
  const R = F.buildRetrieval(idx, "description", {});
  const q = { ts: T0 + 5 * DAY, sh: [4, 5, 6], ph: 20 };   // same instant as the $500 task
  const nb = F.retrieveNeighbourhood(q, R);
  ok("simultaneous task not used", Math.exp(nb.mu) < 5, "mu$=" + Math.exp(nb.mu).toFixed(3));
}

console.log("\n[3] no earlier task at all -> null (never invents a neighbourhood)");
{
  const idx = [rec(5, 3.0, [1, 2], 1), rec(6, 4.0, [1, 2], 1)];
  const R = F.buildRetrieval(idx, "description", {});
  const nb = F.retrieveNeighbourhood({ ts: T0, sh: [1, 2], ph: 1 }, R);
  ok("returns null for the very first task", nb === null);
}

console.log("\n[4] EQUIVALENCE: full index == manually-truncated past index (the strong test)");
{
  // Random-ish corpus, deterministic.
  let seed = 20260719;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const corpus = [];
  for (let i = 0; i < 400; i++) {
    const sh = []; for (let j = 0; j < 8; j++) sh.push(Math.floor(rnd() * 40));
    corpus.push(rec(i * 0.1, 0.05 + rnd() * 60, Array.from(new Set(sh)), Math.floor(rnd() * 25)));
  }
  const Rfull = F.buildRetrieval(corpus, "description", { k: 3, simFloor: 0.22, halfLifeDays: 5 });
  let checked = 0, mismatches = 0;
  for (let i = 0; i < corpus.length; i++) {
    const q = corpus[i];
    // index built ONLY from records strictly earlier than q
    const pastOnly = corpus.filter(r => r.ts < q.ts);
    const Rpast = F.buildRetrieval(pastOnly, "description", { k: 3, simFloor: 0.22, halfLifeDays: 5 });
    const a = F.retrieveNeighbourhood(q, Rfull);
    const b = F.retrieveNeighbourhood(q, Rpast);
    checked++;
    const same = (a === null && b === null) ||
      (a && b && a.source === b.source && a.n === b.n &&
        Math.abs(a.mu - b.mu) < 1e-12 && Math.abs(a.s - b.s) < 1e-12);
    if (!same) mismatches++;
  }
  ok("full-index and past-only-index retrievals are identical on all " + checked + " queries",
    mismatches === 0, "mismatches=" + mismatches);
}

console.log("\n[5] POISON: appending arbitrary future tasks cannot change any prediction");
{
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const base = [];
  for (let i = 0; i < 150; i++) {
    const sh = []; for (let j = 0; j < 6; j++) sh.push(Math.floor(rnd() * 30));
    base.push(rec(i * 0.2, 0.1 + rnd() * 20, Array.from(new Set(sh)), Math.floor(rnd() * 20)));
  }
  const queries = base.slice(100);
  const poison = [];
  for (let i = 0; i < 300; i++) {
    // engineered to dominate: latest timestamps, every shingle, every hash
    poison.push(rec(1000 + i, 1e6, [...Array(30).keys()], i % 20));
  }
  const Rclean = F.buildRetrieval(base, "description", { k: 3, simFloor: 0.22, halfLifeDays: 5 });
  const Rpoison = F.buildRetrieval(base.concat(poison), "description", { k: 3, simFloor: 0.22, halfLifeDays: 5 });
  let diff = 0;
  for (const q of queries) {
    const a = F.retrieveNeighbourhood(q, Rclean);
    const b = F.retrieveNeighbourhood(q, Rpoison);
    if (!a || !b || Math.abs(a.mu - b.mu) > 1e-12 || a.source !== b.source) diff++;
  }
  ok("300 poisoned future tasks changed 0 of " + queries.length + " predictions", diff === 0, "diff=" + diff);
}

console.log("\n[6] end-to-end through forecast(): future poison cannot move a band");
{
  const mk = (d, c, sh, ph, proj, arch) => ({
    ts: T0 + d * DAY, timestamp: new Date(T0 + d * DAY).toISOString(),
    cost_usd: c, turn_count: 5, sh: sh.slice().sort((a, b) => a - b), ph: ph,
    project: proj, archetype: arch
  });
  const train = [];
  for (let i = 0; i < 60; i++) train.push(mk(i * 0.3, 1 + (i % 7), [i % 10, (i + 1) % 10, (i + 2) % 10], i % 12, "p" + (i % 3), "debug_fix"));
  const future = [];
  for (let i = 0; i < 60; i++) future.push(mk(500 + i, 1e5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], i % 12, "p0", "debug_fix"));

  const q = mk(25, 0, [0, 1, 2], 0, "p0", "debug_fix");
  const optsA = { regime: "description", retrieval: { k: 3, simFloor: 0.22, halfLifeDays: 5, records: train } };
  const optsB = { regime: "description", retrieval: { k: 3, simFloor: 0.22, halfLifeDays: 5, records: train.concat(future) } };
  const pA = F.calibrate(F.fitPriors(train, optsA), train);
  const pB = F.calibrate(F.fitPriors(train, optsB), train);
  const fA = F.forecast(q, pA, "description");
  const fB = F.forecast(q, pB, "description");
  ok("p50 identical with and without future in the index",
    Math.abs(fA.p50 - fB.p50) < 1e-9, `${fA.p50} vs ${fB.p50}`);
  ok("p90 identical with and without future in the index",
    Math.abs(fA.p90 - fB.p90) < 1e-9, `${fA.p90} vs ${fB.p90}`);
}

console.log("\n[7] REGRESSION: with no retrieval configured, behaviour is bit-identical to baseline");
{
  const Base = require("C:/Users/adam1/worktrees/top1-benchmark/forecast/forecaster.js");
  let seed = 99;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const arch = ["debug_fix", "build_new", "misc", "qa_short"];
  const data = [];
  for (let i = 0; i < 500; i++) {
    data.push({
      timestamp: new Date(T0 + i * 3600000).toISOString(),
      cost_usd: 0.05 + rnd() * 40, turn_count: 1 + Math.floor(rnd() * 30),
      project: "proj_" + (1 + Math.floor(rnd() * 6)), archetype: arch[Math.floor(rnd() * arch.length)]
    });
  }
  const tr = data.slice(0, 300), ca = data.slice(300, 400), te = data.slice(400);
  const pN = F.calibrate(F.fitPriors(tr, {}), ca);
  const pO = Base.calibrate(Base.fitPriors(tr, {}), ca);
  let maxd = 0;
  for (const r of te) for (const m of ["oracle", "description"]) {
    const a = F.forecast(r, pN, m), b = Base.forecast(r, pO, m);
    maxd = Math.max(maxd, Math.abs(a.p10 - b.p10), Math.abs(a.p50 - b.p50), Math.abs(a.p90 - b.p90));
  }
  ok("baseline path unchanged across " + te.length + " tasks x 2 regimes", maxd === 0, "maxdiff=" + maxd);
}

console.log("\n[8] classifier untouched (archetype labels identical to baseline)");
{
  const Base = require("C:/Users/adam1/worktrees/top1-benchmark/forecast/forecaster.js");
  const probes = ["fix the failing test", "refactor across the codebase", "what is this?",
    "build a new prototype from scratch", "summarise the findings", "commit and push",
    "", "add a button to index.html", "hackathon builder track entry"];
  let bad = 0;
  for (const p of probes) if (F.classifyArchetype(p) !== Base.classifyArchetype(p)) bad++;
  ok("archetype classifier unchanged on " + probes.length + " probes", bad === 0);
}

console.log("\nALL " + passed + " LEAKAGE / REGRESSION CHECKS PASSED\n");
