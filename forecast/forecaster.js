/*
 * forecaster.js — TOP v1 cost forecaster, self-contained browser port of the
 * Python reference (top-forecaster/forecaster.py + archetype.py).
 *
 * NO dependencies. Loads as a plain <script> (sets window.Forecaster), works
 * under a bundler / Node require(), and touches no DOM, network, or globals.
 *
 * Mechanism, faithful to the paper (TOP Sections 3.2-3.3) and the Python v1:
 *   1. Per-archetype log-cost PRIOR (location/scale of log-cost per archetype).
 *   2. Per-group EMPIRICAL-BAYES / Buhlmann-credibility blend in LOG space:
 *          w   = n / (n + k)
 *          mu  = w*mu_group + (1-w)*mu_prior
 *          s^2 = w*s_group^2 + (1-w)*s_prior^2 + w^2 * s_group^2 / max(n,1)
 *      k is estimated from the data by a one-way ANOVA/Buhlmann variance
 *      decomposition (between- vs within-group log-cost variance).
 *   3. SPLIT-CONFORMAL, GROUP-CONDITIONAL (Mondrian) calibration: standardized
 *      nonconformity |y - mu| / sigma, finite-sample (1-alpha) quantile PER
 *      ARCHETYPE (pooled fallback for thin buckets). That quantile q replaces
 *      the nominal z=1.2816. Bands never invert (P10 <= P50 <= P90).
 *
 * TWO REGIMES (the `mode` argument to forecast()):
 *   "oracle"      : GIVEN the realised turn count T. Models r = log(cost) - log(T),
 *                   blends r, adds log(T) back. Upper-bound regime.
 *   "description" : from archetype/description ALONE, no turn count. Models
 *                   log(cost) directly. Deployment reality.
 *
 * "GROUP" = project (the credibility group), matching the Python honesty note:
 * a single-human corpus, so the per-user blend personalises across PROJECTS,
 * the paper's own ~5x-varying "correlated-session source with its own cost level".
 *
 * PUBLIC API
 *   classifyArchetype(sessionOrText)   -> archetype label string
 *   fitPriors(trainSessions, opts?)    -> priors {oracle, description, ...}
 *   calibrate(priors, calibSessions)   -> priors (conformal q's filled in place)
 *   forecast(session, priors, mode)    -> {p10, p50, p90}   (USD)
 *
 * A `session` for fit/calibrate needs: {cost_usd, turn_count, archetype, project}.
 * A `session` for forecast() needs only what exists BEFORE the run:
 *   {archetype, project}  (+ turn_count when mode === "oracle").  cost is NOT read.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;      // Node / bundler
  if (typeof define === "function" && define.amd) define(function () { return api; }); // AMD
  if (typeof window !== "undefined") window.Forecaster = api;                      // browser global
  if (typeof root !== "undefined" && root) root.Forecaster = root.Forecaster || api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var Z_80 = 1.2816;            // nominal one-sided z for a P10/P90 (80% central) band
  var SEP = "\u0000";           // group-key join char (never appears in project/archetype)

  // ============================================================ archetype.js port

  var ARCHETYPES = [
    "qa_short", "debug_fix", "single_file_edit", "multi_file_refactor", "build_new",
    "research_summarize", "ops_repo", "eval_pipeline_agent", "exam_solver",
    "hackathon_build", "misc"
  ];

  // leading imperative verb -> archetype (first word of the description)
  var LEADING_VERB = {
    fix: "debug_fix", debug: "debug_fix", resolve: "debug_fix", diagnose: "debug_fix",
    investigate: "debug_fix",
    build: "build_new", create: "build_new", scaffold: "build_new", implement: "build_new",
    write: "build_new", design: "build_new",
    add: "single_file_edit", update: "single_file_edit", edit: "single_file_edit",
    change: "single_file_edit", modify: "single_file_edit", tweak: "single_file_edit",
    refactor: "multi_file_refactor", restructure: "multi_file_refactor",
    reorganize: "multi_file_refactor", reorganise: "multi_file_refactor",
    migrate: "multi_file_refactor", rename: "multi_file_refactor", clean: "multi_file_refactor",
    summarize: "research_summarize", summarise: "research_summarize", research: "research_summarize",
    analyze: "research_summarize", analyse: "research_summarize", review: "research_summarize",
    read: "research_summarize", compare: "research_summarize",
    explain: "qa_short", what: "qa_short", how: "qa_short", why: "qa_short",
    is: "qa_short", can: "qa_short",
    commit: "ops_repo", deploy: "ops_repo", push: "ops_repo", release: "ops_repo",
    publish: "ops_repo"
  };

  // ordered list of [label, keywords] (order is cosmetic: vote totals are order-independent)
  var KEYWORDS = [
    ["debug_fix", ["bug", "error", "crash", "fail", "broken", "traceback", "exception", "doesn't work", "not working"]],
    ["build_new", ["build", "scaffold", "from scratch", "new app", "new project", "prototype", "generate"]],
    ["single_file_edit", ["this file", "the file", "one file", "single file", "add a function", "add a button"]],
    ["multi_file_refactor", ["refactor", "across the codebase", "restructure", "reorganize", "reorganise",
      "rename across", "clean up", "migrate"]],
    ["research_summarize", ["summarize", "summarise", "research", "analy", "report", "investigate", "compare"]],
    ["ops_repo", ["git ", "commit", "deploy", "release", "pipeline", " ci ", "publish", "push to"]]
  ];

  var STRONG_KEYWORDS = [
    ["eval_pipeline_agent", ["checker / optimizer", "checker/optimizer", "skillopt", "two-agent loop",
      "roll out -> reflect", "bounded edit", "validation gate"]],
    ["exam_solver", ["cold solver", "hpat", "practice exam", "answer key", "blind sample", "question-generation"]],
    ["hackathon_build", ["built with claude", "hackathon", "builder track", "cerebral valley"]]
  ];

  var SCAN_CHARS = 1500;
  var FILE_TOKEN_RE = /\b[\w\-/\\]+\.\w{1,5}\b/g;
  var WORD_RE = /[a-zA-Z']+/g;

  // code-point-accurate slice (Python slices by code point, JS strings are UTF-16)
  function cpSlice(str, n) {
    var cps = Array.from(str);
    return cps.length <= n ? { text: str, len: cps.length } : { text: cps.slice(0, n).join(""), len: n };
  }

  function classifyArchetype(sessionOrText) {
    var description;
    if (typeof sessionOrText === "string") {
      description = sessionOrText;
    } else if (sessionOrText && typeof sessionOrText === "object") {
      description = sessionOrText.description != null ? sessionOrText.description
        : (sessionOrText.description_excerpt != null ? sessionOrText.description_excerpt : "");
    } else {
      description = "";
    }
    if (!description) return "misc";

    var sl = cpSlice(description.trim().toLowerCase(), SCAN_CHARS);
    var text = sl.text;
    var textLen = sl.len;                       // Python len(text): code-point count
    if (!text) return "misc";

    var wm = text.match(WORD_RE);
    var firstWord = wm && wm.length ? wm[0] : "";

    var votes = Object.create(null);
    function addVote(label, weight) { votes[label] = (votes[label] || 0) + weight; }

    var leading = LEADING_VERB[firstWord];
    if (leading) addVote(leading, 2);

    var i, j;
    for (i = 0; i < KEYWORDS.length; i++) {
      var lbl = KEYWORDS[i][0], kws = KEYWORDS[i][1];
      for (j = 0; j < kws.length; j++) {
        if (text.indexOf(kws[j]) !== -1) { addVote(lbl, 1); break; }
      }
    }
    for (i = 0; i < STRONG_KEYWORDS.length; i++) {
      var slbl = STRONG_KEYWORDS[i][0], skws = STRONG_KEYWORDS[i][1];
      for (j = 0; j < skws.length; j++) {
        if (text.indexOf(skws[j]) !== -1) { addVote(slbl, 2); break; }
      }
    }

    // file mentions: scan ORIGINAL-case description prefix (Python code-point slice)
    var descPrefix = cpSlice(description, SCAN_CHARS).text;
    var fileMatches = descPrefix.match(FILE_TOKEN_RE) || [];
    var fileSet = Object.create(null), fileMentions = 0;
    for (i = 0; i < fileMatches.length; i++) {
      var low = fileMatches[i].toLowerCase();
      if (!(low in fileSet)) { fileSet[low] = 1; fileMentions++; }
    }

    // Python: text.rstrip().endswith("?") or first_word in (what/how/why/is/can/does)
    var isQuestion = text.replace(/\s+$/, "").slice(-1) === "?" ||
      firstWord === "what" || firstWord === "how" || firstWord === "why" ||
      firstWord === "is" || firstWord === "can" || firstWord === "does";

    if (textLen < 120 && isQuestion && fileMentions === 0) addVote("qa_short", 1);
    if (fileMentions >= 3) addVote("multi_file_refactor", 1);
    else if (fileMentions === 1 && textLen < 400) addVote("single_file_edit", 1);

    var labels = Object.keys(votes);
    if (labels.length === 0) return "misc";

    // rank by descending vote count; output depends only on whether the max is unique
    var topLabel = null, topScore = -Infinity, runnerUp = 0;
    for (i = 0; i < labels.length; i++) {
      var sc = votes[labels[i]];
      if (sc > topScore) { runnerUp = topScore; topLabel = labels[i]; topScore = sc; }
      else if (sc > runnerUp) { runnerUp = sc; }
    }
    if (runnerUp === -Infinity) runnerUp = 0;   // only one label voted
    if (topScore <= runnerUp) return "misc";    // genuine tie -> abstain
    return topLabel;
  }

  // ============================================================ numeric helpers

  function mean(xs) {
    var s = 0.0;
    for (var i = 0; i < xs.length; i++) s += xs[i];
    return s / xs.length;
  }

  // sample stdev (ddof=1); mirrors Python _std(xs, mean=None)
  function std(xs, m) {
    if (xs.length < 2) return 0.0;
    if (m === undefined || m === null) m = mean(xs);
    var s = 0.0;
    for (var i = 0; i < xs.length; i++) {
      var d = xs[i] - m;
      s += d * d;
    }
    return Math.sqrt(s / (xs.length - 1));
  }

  // linear-interpolation quantile of an already-sorted array (Python _quantile)
  function quantile(sortedXs, q) {
    if (sortedXs.length === 0) return null;
    if (q <= 0) return sortedXs[0];
    if (q >= 1) return sortedXs[sortedXs.length - 1];
    var idx = q * (sortedXs.length - 1);
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) return sortedXs[lo];
    var frac = idx - lo;
    return sortedXs[lo] * (1 - frac) + sortedXs[hi] * frac;
  }

  function toInt(x) { return Math.trunc(Number(x)); }   // Python int() on a clean numeric string

  // ============================================================ target transform

  function targetOf(rec, regime) {
    var cost = Number(rec.cost_usd);
    if (!(cost > 0)) return null;
    if (regime === "oracle") {
      var T = Math.max(1, toInt(rec.turn_count));
      return Math.log(cost) - Math.log(T);
    }
    return Math.log(cost);
  }

  // ============================================================ fit (per regime)

  function fitRegime(train, regime, opts) {
    var groupKey = opts.groupKey;
    var byArch = new Map();     // archetype -> [y...]
    var byGroup = new Map();    // groupKey+SEP+arch -> {proj, arch, ys:[y...]}
    var allv = [];

    for (var i = 0; i < train.length; i++) {
      var rec = train[i];
      var y = targetOf(rec, regime);
      if (y === null) continue;
      var a = rec.archetype;
      var g = rec[groupKey];
      if (!byArch.has(a)) byArch.set(a, []);
      byArch.get(a).push(y);
      var gk = g + SEP + a;
      if (!byGroup.has(gk)) byGroup.set(gk, { proj: g, arch: a, ys: [] });
      byGroup.get(gk).ys.push(y);
      allv.push(y);
    }
    if (allv.length === 0) throw new Error("no usable training targets (all zero-cost?)");

    var gm = mean(allv);
    var gs = std(allv, gm) || 1.0;
    var globalPrior = [gm, gs];

    var prior = new Map();
    byArch.forEach(function (xs, a) {
      var m = mean(xs);
      var s = std(xs, m);
      if (s <= 0) s = globalPrior[1];
      prior.set(a, [m, s, xs.length]);
    });

    var group = new Map();
    byGroup.forEach(function (obj, gk) {
      var m = mean(obj.ys);
      var s = std(obj.ys, m);   // 0.0 if singleton; handled at blend time
      group.set(gk, [m, s, obj.ys.length]);
    });

    var k = (opts.kOverride !== null && opts.kOverride !== undefined)
      ? opts.kOverride : estimateK(byGroup, allv);

    return {
      regime: regime, k: k, globalPrior: globalPrior, prior: prior, group: group,
      qByArchetype: new Map(), qGlobal: Z_80,
      alpha: opts.alpha, minBucket: opts.minBucket, groupKey: groupKey
    };
  }

  // Buhlmann k = EPV / VHM via one-way ANOVA over groups (Python _estimate_k)
  function estimateK(byGroup, allv) {
    var groups = [];
    byGroup.forEach(function (obj) { if (obj.ys.length >= 1) groups.push(obj.ys); });
    var N = allv.length;
    var G = groups.length;
    if (G < 2 || N <= G) return 50.0;

    var grand = mean(allv);
    var num_w = 0.0, den_w = 0.0, i, xs;
    for (i = 0; i < groups.length; i++) {
      xs = groups[i];
      if (xs.length >= 2) {
        var m = mean(xs), sw = 0.0;
        for (var j = 0; j < xs.length; j++) { var d = xs[j] - m; sw += d * d; }
        num_w += sw;
        den_w += (xs.length - 1);
      }
    }
    var epv;
    if (den_w > 0) { epv = num_w / den_w; }
    else { var s0 = std(allv, grand); epv = s0 * s0; }

    var ssb = 0.0;
    for (i = 0; i < groups.length; i++) {
      xs = groups[i];
      var dd = mean(xs) - grand;
      ssb += xs.length * (dd * dd);
    }
    var sum_n2 = 0.0;
    for (i = 0; i < groups.length; i++) sum_n2 += groups[i].length * groups[i].length;

    var denom = N - (sum_n2 / N);
    if (denom <= 0) return 50.0;
    var vhm = (ssb - (G - 1) * epv) / denom;
    if (vhm <= 0 || epv <= 0) return 200.0;
    var k = epv / vhm;
    return Math.max(1.0, Math.min(1000.0, k));
  }

  // ============================================================ retrieval (ABE neighbourhood)
  //
  // Replaces the (project, archetype) CELL as the definition of "similar past work"
  // with analogy-based retrieval over the user's own prior prompts:
  //
  //   1. EXACT REPEAT  - same normalised prompt hash -> those tasks are the neighbourhood.
  //   2. ANALOGY       - k nearest EARLIER prompts by word 3-gram Jaccard similarity;
  //                      neighbourhood location = median of their log costs.
  //   3. FALLBACK      - if the best similarity is below simFloor, no trustworthy analogy
  //                      exists: back off to a recency-weighted global median (half-life
  //                      in days), which tracks cost-regime drift that a flat median misses.
  //
  // Neighbourhood DISPERSION is retained and returned, not discarded. Following
  // Kocaguneli et al. 2012 (IEEE TSE 38(2):425-438), the stability of a neighbourhood is
  // itself a measurable, ex-ante signal: a high-variance neighbourhood should widen the
  // band rather than assert a confident point. That dispersion flows into the existing
  // empirical-Bayes blend as s_group, so an unstable neighbourhood is automatically
  // distrusted instead of being reported with false confidence.
  //
  // TEMPORAL SAFETY: candidate.ts < query.ts is enforced HERE, unconditionally, inside the
  // retrieval function itself. It is not delegated to harness bookkeeping. An index that
  // contains future tasks still cannot leak them.

  // Jaccard over two ASCENDING-sorted arrays of 32-bit shingle hashes.
  function jaccard(a, b) {
    var na = a.length, nb = b.length;
    if (na === 0 || nb === 0) return 0;
    var i = 0, j = 0, inter = 0;
    while (i < na && j < nb) {
      var x = a[i], y = b[j];
      if (x === y) { inter++; i++; j++; }
      else if (x < y) i++;
      else j++;
    }
    var uni = na + nb - inter;
    return uni > 0 ? inter / uni : 0;
  }

  function medianOf(xs) {
    if (xs.length === 0) return null;
    var s = xs.slice().sort(function (p, q) { return p - q; });
    var m = s.length >> 1;
    return (s.length % 2) ? s[m] : 0.5 * (s[m - 1] + s[m]);
  }

  // Recency-weighted median: weight 0.5^(age_days / halfLifeDays).
  function recencyWeightedMedian(entries, tNow, halfLifeDays) {
    if (entries.length === 0) return null;
    var HL = Math.max(1e-6, halfLifeDays) * 86400000;
    var rows = [];
    var total = 0, i;
    for (i = 0; i < entries.length; i++) {
      var age = Math.max(0, tNow - entries[i].ts);
      var w = Math.pow(0.5, age / HL);
      if (!(w > 0)) continue;
      rows.push([entries[i].y, w]);
      total += w;
    }
    if (!rows.length || !(total > 0)) return medianOf(entries.map(function (e) { return e.y; }));
    rows.sort(function (p, q) { return p[0] - q[0]; });
    var half = total / 2, acc = 0;
    for (i = 0; i < rows.length; i++) {
      acc += rows[i][1];
      if (acc >= half) return rows[i][0];
    }
    return rows[rows.length - 1][0];
  }

  // Build an index. `records` need {ts|timestamp, ph, sh} plus a cost the regime can score.
  // Records the regime cannot score (non-positive cost) are dropped.
  function buildRetrieval(records, regime, opts) {
    opts = opts || {};
    var entries = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var y = targetOf(r, regime);
      if (y === null) continue;
      var ts = (typeof r.ts === "number") ? r.ts : Date.parse(r.ts || r.timestamp || 0);
      if (!isFinite(ts)) continue;
      entries.push({ ts: ts, y: y, ph: r.ph, sh: r.sh || [] });
    }
    entries.sort(function (p, q) { return p.ts - q.ts; });
    return {
      entries: entries,
      k: opts.k !== undefined ? opts.k : 3,
      simFloor: opts.simFloor !== undefined ? opts.simFloor : 0.22,
      halfLifeDays: opts.halfLifeDays !== undefined ? opts.halfLifeDays : 5,
      mode: opts.mode || "eb"          // "eb" = feed the EB blend, "replace" = use directly
    };
  }

  // Returns {mu, s, n, source} or null. ALWAYS strictly-earlier-only.
  function retrieveNeighbourhood(rec, R) {
    var tq = (typeof rec.ts === "number") ? rec.ts : Date.parse(rec.ts || rec.timestamp || 0);
    if (!isFinite(tq)) return null;
    var E = R.entries, i;

    // --- strict temporal gate: only tasks that finished strictly before this one exists.
    var past = [];
    for (i = 0; i < E.length; i++) {
      if (E[i].ts < tq) past.push(E[i]);
      else break;                      // entries are ts-sorted, so we can stop
    }
    if (past.length === 0) return null;

    // --- 1. exact repeat
    // An exact repeat has Jaccard 1.0, so it is simply the top of the similarity ranking and
    // obeys the same k cap. Ties at similarity 1.0 break toward the MOST RECENT repeat: a
    // duplicate prompt issued yesterday is a better analogy for today than the same prompt
    // issued five weeks ago, and in a drifting cost regime the stale ones bias the median down.
    var sh = rec.sh || [];
    if (rec.ph !== undefined && rec.ph !== null) {
      var exact = [];
      for (i = past.length - 1; i >= 0 && exact.length < R.k; i--) {
        if (past[i].ph === rec.ph) exact.push(past[i].y);   // past is ts-ascending, so walk back
      }
      if (exact.length > 0) {
        return { mu: medianOf(exact), s: std(exact), n: exact.length, source: "exact" };
      }
    }

    // --- 2. k nearest earlier prompts by 3-gram Jaccard
    if (sh.length > 0) {
      var scored = [];
      for (i = 0; i < past.length; i++) {
        var sim = jaccard(sh, past[i].sh);
        if (sim > 0) scored.push([sim, past[i].y, past[i].ts]);
      }
      if (scored.length > 0) {
        // similarity descending, then most-recent-first so ties resolve toward the current regime
        scored.sort(function (p, q) { return (q[0] - p[0]) || (q[2] - p[2]); });
        if (scored[0][0] >= R.simFloor) {
          var top = scored.slice(0, R.k);
          var ys = top.map(function (t) { return t[1]; });
          return { mu: medianOf(ys), s: std(ys), n: ys.length, source: "analogy" };
        }
      }
    }

    // --- 3. no trustworthy analogy -> recency-weighted global median
    var mu = recencyWeightedMedian(past, tq, R.halfLifeDays);
    if (mu === null) return null;
    var allY = [];
    for (i = 0; i < past.length; i++) allY.push(past[i].y);
    return { mu: mu, s: std(allY), n: 1, source: "recency" };
  }

  // ============================================================ EB blend

  // returns [mu, sigma] in target space for one record (Python _blend)
  function blend(rec, P) {
    var a = rec.archetype;
    var g = rec[P.groupKey];
    var pr = P.prior.get(a);
    var mu_p, s_p;
    if (pr) { mu_p = pr[0]; s_p = pr[1]; }
    else { mu_p = P.globalPrior[0]; s_p = P.globalPrior[1]; }   // cold archetype -> global prior

    var gm, gs, n;

    if (P.retrieval) {
      // RETRIEVAL defines the neighbourhood; the EB machinery below still decides how much
      // to trust it. Retrieval answers WHICH past tasks are relevant, shrinkage answers HOW
      // MUCH a small or unstable neighbourhood should move us off the prior.
      var nb = retrieveNeighbourhood(rec, P.retrieval);
      if (!nb) return [mu_p, s_p];                              // nothing earlier exists at all
      if (P.retrieval.mode === "replace") {
        var sr = (nb.n >= 2 && nb.s > 0) ? nb.s : s_p;
        return [nb.mu, Math.sqrt(Math.max(sr * sr, 1e-9))];
      }
      gm = nb.mu; gs = nb.s; n = nb.n;
    } else {
      var gr = P.group.get(g + SEP + a);
      if (!gr) return [mu_p, s_p];                              // cold start: pure archetype prior
      gm = gr[0]; gs = gr[1]; n = gr[2];
    }
    if (n <= 0 || gm === null) return [mu_p, s_p];

    var s_user = (n >= 2 && gs > 0) ? gs : s_p;
    var w = n / (n + P.k);
    var mu = w * gm + (1 - w) * mu_p;
    var vv = w * (s_user * s_user) + (1 - w) * (s_p * s_p) + (w * w) * (s_user * s_user) / Math.max(n, 1);
    var sigma = Math.sqrt(Math.max(vv, 1e-9));
    return [mu, sigma];
  }

  // map (mu, sigma) back to (p10, p50, p90) in USD using q (Python _reconstruct)
  function reconstruct(rec, mu, sigma, P) {
    var a = rec.archetype;
    var q = P.qByArchetype.has(a) ? P.qByArchetype.get(a) : P.qGlobal;
    var shift = (P.regime === "oracle") ? Math.log(Math.max(1, toInt(rec.turn_count))) : 0.0;
    var p50 = Math.exp(mu + shift);
    var p10 = Math.exp(mu - q * sigma + shift);
    var p90 = Math.exp(mu + q * sigma + shift);
    return [p10, p50, p90];
  }

  // ============================================================ conformal calibration

  function calibrateRegime(P, calib) {
    var scoresByArch = new Map();
    var scoresAll = [];
    for (var i = 0; i < calib.length; i++) {
      var rec = calib[i];
      var y = targetOf(rec, P.regime);
      if (y === null) continue;
      var mus = blend(rec, P);
      var sigma = mus[1];
      if (sigma <= 0) continue;
      var s = Math.abs(y - mus[0]) / sigma;
      var a = rec.archetype;
      if (!scoresByArch.has(a)) scoresByArch.set(a, []);
      scoresByArch.get(a).push(s);
      scoresAll.push(s);
    }

    function confQ(scores) {
      var n = scores.length;
      if (n === 0) return Z_80;
      var lvl = Math.min(1.0, Math.ceil((n + 1) * (1 - P.alpha)) / n);
      var sorted = scores.slice().sort(function (x, y) { return x - y; });
      return quantile(sorted, lvl);
    }

    var qg = confQ(scoresAll);
    P.qGlobal = qg || Z_80;                       // Python: conf_q(scores_all) or Z_80
    P.qByArchetype = new Map();
    scoresByArch.forEach(function (scores, a) {
      if (scores.length >= P.minBucket) P.qByArchetype.set(a, confQ(scores));
      // thin buckets fall back to qGlobal at forecast time
    });
    return P;
  }

  // ============================================================ public API

  function fitPriors(trainSessions, opts) {
    opts = opts || {};
    var o = {
      alpha: opts.alpha !== undefined ? opts.alpha : 0.20,
      minBucket: opts.minBucket !== undefined ? opts.minBucket : 20,
      kOverride: opts.kOverride !== undefined ? opts.kOverride : null,
      groupKey: opts.groupKey || "project"
    };
    var regimes = opts.regime ? [opts.regime] : ["oracle", "description"];
    var priors = { opts: o };
    for (var i = 0; i < regimes.length; i++) {
      priors[regimes[i]] = fitRegime(trainSessions, regimes[i], o);
      if (opts.retrieval) {
        // Index defaults to the same records the priors were fitted on. The caller may pass
        // `records` to index a wider history; the strictly-earlier gate makes that safe.
        var src = opts.retrieval.records || trainSessions;
        priors[regimes[i]].retrieval = buildRetrieval(src, regimes[i], opts.retrieval);
      }
    }
    return priors;
  }

  function calibrate(priors, calibSessions) {
    ["oracle", "description"].forEach(function (r) {
      if (priors[r]) calibrateRegime(priors[r], calibSessions);
    });
    return priors;
  }

  function forecast(session, priors, mode) {
    var P = priors && priors[mode];
    if (!P) throw new Error("forecast: priors missing for mode '" + mode + "'");
    var mus = blend(session, P);
    var band = reconstruct(session, mus[0], mus[1], P);
    band.sort(function (x, y) { return x - y; });     // guarantee P10 <= P50 <= P90
    return { p10: band[0], p50: band[1], p90: band[2] };
  }

  return {
    Z_80: Z_80,
    ARCHETYPES: ARCHETYPES,
    classifyArchetype: classifyArchetype,
    fitPriors: fitPriors,
    calibrate: calibrate,
    forecast: forecast,
    // retrieval internals, exported for the leakage test and offline evaluation
    buildRetrieval: buildRetrieval,
    retrieveNeighbourhood: retrieveNeighbourhood,
    jaccard: jaccard,
    recencyWeightedMedian: recencyWeightedMedian
  };
});
