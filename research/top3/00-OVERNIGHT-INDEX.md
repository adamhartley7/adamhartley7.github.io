# TOP-3 (Athena) overnight research: honest index

Status: this folder is **research**, not a shipped or benchmarked product. Nothing in it
runs on real users. Every quantitative result inside is arithmetic over **synthetic** data
that the same script generated, or a figure cited from a primary source with a link. No
savings percentage, benchmark, or effect on real usage is claimed anywhere. This index
summarises what was explored overnight, what each artifact claims and (importantly) does
not claim, and the open questions for Adam to pick up.

TOP-3 (Athena) as scoped here is three separable bets, each in its own folder:
1. a per-user cost-forecast personalisation layer (`personalisation/`),
2. a metadata-only prompting coach (`coach/`),
3. an adaptive MCQ intake that clarifies before work starts (`intake/`),
plus a cited landscape scan placing all three (`landscape/`).

## What I did tonight (verification, not new claims)

I read all four artifacts and **re-ran the three Python prototypes** (Python 3.13.5, numpy
2.4.6, same as the captured runs). All three reproduce their committed `*_synthetic.txt`
outputs exactly. I also removed two stray XML closing tags (`</content></invoke>`) that had
leaked into the end of `intake/README.md` during generation; no prose was changed. I did
not write, edit, or run anything outside `research/top3/`.

## Artifact-by-artifact: claims vs non-claims

### 1. `personalisation/` - empirical-Bayes (Buhlmann) shrinkage prototype
Files: `README.md`, `eb_shrinkage.py`, `results_synthetic.txt`.

- **Claims (synthetic only).** On data whose generating process matches the estimator's
  assumptions (Gaussian, additive-in-log, stationary per-user offset), shrinking a
  population quantile forecast toward a user's own residuals lowers average pinball loss
  (-18.2% on the default seed; the README reports roughly -14% to -16% across other seeds,
  so direction stable, exact figure not), keeps 80% interval coverage on target (0.783 ->
  0.801), and fixes per-user tail miscoverage that is invisible in the average
  (below-crowd users go 0.693 -> 0.798). It is provably **inert at cold start** (n=0 is
  identical to baseline by construction), and the tau=0 falsification guard shows ~no
  change (+0.0%), i.e. it does not fit noise when there is nothing to personalise.
- **Does NOT claim.** Anything about real users. The synthetic DGP is exactly the model
  the estimator assumes, so the run is self-favouring by construction; it rules out the
  estimator being wrong *on its own terms* and gives zero evidence that real cost residuals
  are Gaussian, log-additive, or stationary (they are probably none). It also cannot be fit
  on real data yet: empirical Bayes needs a **multi-user cohort** to separate between-user
  from within-user variance, and the only real pilot data is one founder's Claude Code
  history dominated by a single repeated task.

### 2. `coach/` - metadata-only prompting coach spec + sim
Files: `README.md`, `coach_sim.py`, `results_synthetic.txt`.

- **Claims (synthetic + cited mechanics).** Documented cost-waste patterns are detectable
  from request **metadata alone**, without ever reading prompt text: the sim fires B1
  (full-history resend) with an exact repriced-cost counterfactual (28,733 of 41,320 units,
  ~70% of that trace's input-side cost addressable) and A2 (silent cache invalidator) as an
  explicit **upper bound** (up to 17,000 units, because it cannot price bytes it never
  reads). On a healthy trace it emits **zero** nudges (the do-no-harm guard), and an
  override-rate kill switch auto-disables a noisy rule (killed at surfacing 8) while a
  useful one survives. Pricing multipliers (cache write 1.25x, read 0.1x, batch 50%, etc.)
  are cited from Anthropic and OpenAI docs with links.
- **Does NOT claim.** Any measured saving or override-rate on real usage, that users would
  act on a nudge, or that acting would not annoy them. All printed numbers describe the
  synthetic traces only. Thresholds (theta_kill, min_samples, nudge caps) are proposed
  defaults to be calibrated, not results. The nudge catalogue is a starting set, not
  complete. The staged measurement plan (Stage 1 dry-run, Stage 2 single-user pilot,
  Stage 3 A/B) is explicit that only Stage 3 can attribute cause.

### 3. `intake/` - MCQ intake honest evaluation protocol + design-time tool
Files: `README.md`, `intake_design_sim.py`, `design_power_synthetic.txt`.

- **Claims (a design, plus planning arithmetic).** This is a pre-registration-style
  **evaluation design**, not a study. It fixes four conditions (C0 reactive baseline, C1
  free-text, C2 fixed checklist, C3 adaptive MCQ), a within-subject crossed design, three
  falsifiable hypotheses (H1 clarity, H2 correction turns, H3 net value *charging the intake
  for its own cost*), and pre-registered refutation conditions. The runnable tool does two
  things only: sizes the study under a **grid of assumed** variance components (e.g. residual
  SD 2.5, 4 tasks/condition -> ~25 participants for 80% power), and pins the exact
  within-participant randomisation test, showing its refutation-null false-positive rate
  sits at alpha (0.043-0.050).
- **Does NOT claim.** Anything about whether the intake works. No participants have been
  run; every outcome value is drawn from a Gaussian model written in the file. Sample sizes
  are "required N *under these assumptions*," not measurements. The real residual SD is
  unknown, which is exactly why the output is a grid, not one number.

### 4. `landscape/` - cited scan of adjacent work (no code)
File: `README.md`.

- **Claims.** Locates seven adjacent areas (FinOps/cost observability, cost-aware
  routing/cascades, cost/output-length prediction, LLM behaviour personalisation, prompt
  optimisation/coaches, clarifying-question intake, Buhlmann credibility) and separates
  standard practice from what is uncommon. Four headline figures are stated as numbers and
  each was read from the primary source (FrugalGPT up to 98% cost cut / +4%; RouteLLM
  85/45/35% at 95% of GPT-4 quality; Anthropic prompt improver +30% and 100% word-count
  adherence; entropy-guided length 29.16% MAE reduction). Its "uncommon" finding, stated as
  a hypothesis about the *public* landscape: a cost forecast that is at once forward-looking,
  per-user calibrated, and cold-start-inert; and a coach defined by a never-read-prompt-text
  constraint acting on usage metadata for cost.
- **Does NOT claim.** Exhaustiveness (one pass, one engine, US-only, July 2026, blind to
  stealth and internal work; every "I did not find X" means exactly that). It does not
  repeat unverified secondary figures (star counts, vendor savings claims, or claimed 2026
  acquisitions of Langfuse/Helicone). Crucially it does **not** claim the uncommon
  intersection is *valuable* - novelty of an unvalidated mechanism is worth little, and
  whether it matters is empirical, not bibliographic.

## Cross-cutting limits (shared by all four)

- **No real data anywhere.** TOP-3 has no user base. The one real dataset is a single
  founder's Claude Code history dominated by one repeated task - unusable for multi-user EB
  estimation and for a within-subject clarity study.
- **Synthetic runs are proofs of mechanism, not effect.** Two of the three prototypes
  generate data that matches their own model's assumptions, so passing means "the mechanism
  behaves as the theory says," never "it works on real usage."
- **Personalisation assumes a calibrated base forecast to shrink toward.** It hands the
  estimator a correct population map. TOP-1's real early estimate is not calibrated yet (the
  main site notes a typical ~3.3x overestimate on out-of-distribution sessions); residuals
  against a biased base forecast would carry that bias into the personal correction.

## Open questions for Adam

1. **Get a multi-user corpus.** This is the real blocker for personalisation: with one user
   you cannot separate between-user from within-user variance, so the estimator cannot even
   be fit on real data, let alone validated.
2. **Do real cost residuals look anything like the model?** Check for heavy tails, skew, and
   drift before trusting any shrinkage. The output-length literature (landscape area 3) is a
   direct warning that log-normal + stationary is optimistic.
3. **Calibrate TOP-1 first.** Personalisation is a layer on a working base forecast, not a
   substitute for one.
4. **Cheapest real next step (coach):** Stage 1 is a feasible-now, observe-only dry-run over
   recorded session metadata - it bounds addressable spend and nudge volume without changing
   anyone's behaviour, so it needs no cohort.
5. **Cheapest real next step (intake):** Stage 0 is a single-user instrumentation smoke test
   to shake out transcript/token capture and get a first read on the residual SD, which
   would collapse the power grid to a real number.
6. **Thresholds are still guesses** (coach kill thresholds, intake MDE and abandonment cap):
   calibrating them is a measurement goal, not a settled result.
7. **Is the "uncommon intersection" actually valuable?** The landscape supports "TOP-3 is not
   a me-too of routing or FinOps" and supports nothing about whether it works. That question
   is empirical and currently untested.

## File map

- `personalisation/` - EB/Buhlmann shrinkage prototype (numpy), README, captured output.
- `coach/` - metadata-only coach spec + sim (stdlib only), README, captured output.
- `intake/` - MCQ intake evaluation protocol + design-time power/analysis tool (numpy),
  README, captured output.
- `landscape/` - cited scan of adjacent work, README (no code).
