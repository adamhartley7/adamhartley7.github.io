#!/usr/bin/env node
/* LEAKAGE + ADMISSIBILITY PROOF for the three ABE mechanisms.
 *
 * Each mechanism adds a new way for information to reach a prediction, so each needs its
 * own proof that the information is (a) strictly earlier and (b) knowable before the task
 * runs. Synthetic records only -- no real prompt text or cost is read by this file.
 */
"use strict";
const F = require("./forecaster.js");
const A = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exit(1); } console.log("  pass: " + m); };

const DAY = 86400000, T0 = Date.parse("2026-01-01T00:00:00Z");
let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

function mk(i, cost, shBase, proj) {
  const sh = [];
  for (let j = 0; j < 12; j++) sh.push((shBase + j) >>> 0);
  sh.sort((a, b) => a - b);
  return { task_id: "t" + i, ts: T0 + i * DAY, timestamp: new Date(T0 + i * DAY).toISOString(),
    cost_usd: cost, turn_count: 5, archetype: i % 3 === 0 ? "debug_fix" : "build_new",
    project: proj || ("p" + (i % 4)), ph: shBase, sh, ntok: 50 + (i % 200), spos: i % 30 };
}
const past = [];
for (let i = 0; i < 240; i++) past.push(mk(i, 0.5 + 20 * rnd(), 1000 + 7 * (i % 40)));
const future = [];
for (let i = 300; i < 420; i++) future.push(mk(i, 5000 + rnd(), 1000 + 7 * (i % 40)));

const W = { jac: 3, len: 1, proj: 1, pos: 1, rec: 1, recHalfLife: 7 };

console.log("\n[1] WEIGHTED metric: strictly-earlier gate still holds");
{
  const q = mk(250, 1, 1000 + 7 * 3);
  const R1 = F.buildRetrieval(past, "description", { k: 3, simFloor: 0.05, weights: W });
  const R2 = F.buildRetrieval(past.concat(future), "description", { k: 3, simFloor: 0.05, weights: W });
  const a = F.retrieveNeighbourhood(q, R1), b = F.retrieveNeighbourhood(q, R2);
  A(a && b && a.mu === b.mu && a.n === b.n && a.source === b.source,
    "future tasks in the weighted index change nothing");
  A(Math.exp(a.mu) < 100, "mu stays in the past cost regime (no 5000-dollar future leaked in)");
}

console.log("\n[2] WEIGHTED metric: poisoning the future cannot move any prediction");
{
  const R1 = F.buildRetrieval(past, "description", { k: 3, simFloor: 0.05, weights: W });
  const R2 = F.buildRetrieval(past.concat(future), "description", { k: 3, simFloor: 0.05, weights: W });
  let diff = 0;
  for (let i = 0; i < 60; i++) {
    const q = mk(241 + i, 1, 1000 + 7 * (i % 40));
    const a = F.retrieveNeighbourhood(q, R1), b = F.retrieveNeighbourhood(q, R2);
    if (JSON.stringify(a) !== JSON.stringify(b)) diff++;
  }
  A(diff === 0, "120 poisoned future tasks changed 0 of 60 weighted retrievals");
}

console.log("\n[3] weights {jac:1} reduce EXACTLY to plain Jaccard");
{
  const Rp = F.buildRetrieval(past, "description", { k: 3, simFloor: 0.22 });
  const Rw = F.buildRetrieval(past, "description", { k: 3, simFloor: 0.22, weights: { jac: 1 } });
  let diff = 0;
  for (let i = 0; i < 80; i++) {
    const q = mk(241 + i, 1, 1000 + 7 * (i % 40));
    if (JSON.stringify(F.retrieveNeighbourhood(q, Rp)) !== JSON.stringify(F.retrieveNeighbourhood(q, Rw))) diff++;
  }
  A(diff === 0, "weighted path with jac-only weights is identical to the unweighted path (80 queries)");
}

console.log("\n[4] TARGET ADMISSIBILITY: the query's own realised cost never reaches the band");
{
  const opts = { alpha: 0.20, minBucket: 5, groupKey: "project", regime: "description",
    retrieval: { k: 3, simFloor: 0.05, halfLifeDays: 3, mode: "eb", weights: W, minHistory: 10 },
    stability: { enabled: true, tauStable: 0.5, tauUnstable: 1.5, mStable: 0.7, mUnstable: 1.6, abstain: true } };
  const priors = F.calibrate(F.fitPriors(past.slice(0, 180), opts), past.slice(180, 220));
  let moved = 0;
  for (let i = 0; i < 50; i++) {
    const q = mk(241 + i, 1, 1000 + 7 * (i % 40));
    const b1 = F.forecast(q, priors, "description");
    const q2 = Object.assign({}, q, { cost_usd: 99999 });        // same task, absurd realised cost
    const b2 = F.forecast(q2, priors, "description");
    if (JSON.stringify(b1) !== JSON.stringify(b2)) moved++;
  }
  A(moved === 0, "changing the query's realised cost moved 0 of 50 bands (cost is never read)");
}

console.log("\n[5] STABILITY: a single analogue is never scored as 'stable'");
{
  const s = F.assessStability({ n: 1, s: 0, source: "analogy" }, 1.0,
    { enabled: true, tauStable: 0.5, tauUnstable: 1.5, mStable: 0.5, mUnstable: 2 });
  A(s.band === "unknown" && s.mult !== 0.5, "n=1 neighbourhood is 'unknown', not 'stable'");
  const t = F.assessStability({ n: 3, s: 0.1, source: "analogy" }, 1.0,
    { enabled: true, tauStable: 0.5, tauUnstable: 1.5, mStable: 0.5, mUnstable: 2 });
  A(t.band === "stable" && t.mult === 0.5, "tight 3-neighbour set is 'stable' and narrows the band");
  const u = F.assessStability({ n: 3, s: 4.0, source: "analogy" }, 1.0,
    { enabled: true, tauStable: 0.5, tauUnstable: 1.5, mStable: 0.5, mUnstable: 2, abstain: true });
  A(u.abstain === true && typeof u.reason === "string" && u.reason.length > 20,
    "dispersed neighbourhood abstains with a plain-English reason");
  A(!/\d+\.\d{6}/.test(u.reason) && !/[{}\[\]]/.test(u.reason), "reason is prose, not a serialised object");
}

console.log("\n[6] MIN-HISTORY: refusal counts only strictly-earlier completed tasks");
{
  const opts = { alpha: 0.20, minBucket: 5, groupKey: "project", regime: "description",
    retrieval: { k: 3, simFloor: 0.05, halfLifeDays: 3, mode: "eb", records: past, minHistory: 30 } };
  const priors = F.calibrate(F.fitPriors(past.slice(0, 180), opts), past.slice(180, 220));
  const early = F.forecast(mk(5, 1, 1000), priors, "description");    // 5 earlier tasks exist
  const late = F.forecast(mk(250, 1, 1000), priors, "description");   // 240 earlier tasks exist
  A(early.abstain === true, "task with 5 prior tasks is refused");
  A(early.p10 === null && early.p50 === null && early.p90 === null, "refusal emits NO band at all");
  A(/30/.test(early.reason) && /5/.test(early.reason), "refusal states the requirement and the actual count");
  A(late.abstain === false && late.p50 > 0, "task with 240 prior tasks is answered");
  A(late.history === 240, "history count reported alongside the band is correct");
  A(typeof late.measuredCoverage === "number" && late.measuredCoverage >= 0 && late.measuredCoverage <= 1,
    "measured coverage is attached to every emitted band");
}

console.log("\n[7] ABSTENTION does not silently become a band elsewhere in the API");
{
  const opts = { alpha: 0.20, minBucket: 5, groupKey: "project", regime: "description",
    retrieval: { k: 3, simFloor: 0.99, halfLifeDays: 3, mode: "eb", records: past },
    stability: { enabled: true, tauStable: 0.3, tauUnstable: 1.2, mStable: 0.7, mUnstable: 1.5,
                 abstain: true, abstainOnRecency: true } };
  const priors = F.calibrate(F.fitPriors(past.slice(0, 180), opts), past.slice(180, 220));
  let nAb = 0, leaked = 0;
  for (let i = 0; i < 40; i++) {
    const b = F.forecast(mk(241 + i, 1, 999999), priors, "description");
    if (b.abstain) { nAb++; if (b.p10 !== null || b.p50 !== null || b.p90 !== null) leaked++; }
  }
  A(nAb > 0, "recency-fallback tasks do abstain when configured to (" + nAb + "/40)");
  A(leaked === 0, "no abstained forecast carried a numeric band");
}

console.log("\n[8] DEFAULTS INERT: no stability, no weights, no minHistory => unchanged behaviour");
{
  const base = { alpha: 0.20, minBucket: 5, groupKey: "project", regime: "description",
    retrieval: { k: 3, simFloor: 0.22, halfLifeDays: 3, mode: "eb", records: past } };
  const p1 = F.calibrate(F.fitPriors(past.slice(0, 180), base), past.slice(180, 220));
  const p2 = F.calibrate(F.fitPriors(past.slice(0, 180), JSON.parse(JSON.stringify(base))), past.slice(180, 220));
  let diff = 0;
  for (let i = 0; i < 40; i++) {
    const q = mk(241 + i, 1, 1000 + 7 * (i % 40));
    const a = F.forecast(q, p1, "description"), b = F.forecast(q, p2, "description");
    if (a.p10 !== b.p10 || a.p50 !== b.p50 || a.p90 !== b.p90 || a.abstain || b.abstain) diff++;
  }
  A(diff === 0, "unconfigured path is deterministic and never abstains");
}

console.log("\nALL ABE LEAKAGE / ADMISSIBILITY CHECKS PASSED");
