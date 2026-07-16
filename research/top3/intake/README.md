# TOP-3 (Athena) MCQ intake: honest evaluation protocol

Status: this is a pre-registration-style **evaluation design**, not a study and not a
result. Nothing here has been run on participants. There are no measured effects,
because no experiment has been conducted. Every number in this document is either a
pre-registered decision threshold (a value we commit to *before* seeing data) or an
assumed input to a design-time power calculation, and each is labelled as such. The one
runnable artifact (`intake_design_sim.py`) is a study-sizing and analysis-pinning tool
that operates on synthetic data we generate; it sizes the experiment and freezes the
analysis code, and it says nothing about how the real intake performs.

## The idea in one paragraph

TOP-3 (Athena) is described on the site as "a personal coach that asks useful questions,
learns how you work and helps turn a rough request into a better plan." This document
covers one narrow, testable slice of that: a **short adaptive multiple-choice intake**
that runs *before* the agent starts working, to resolve the request's most consequential
ambiguities up front. The bet is the one in the working title, "clarify before you burn
tokens": a handful of cheap clicks now may prevent an expensive wrong-direction detour
later (the user redirecting, the agent redoing work, a transcript that grows while the
deliverable does not). That bet is not obviously true. Clarification has its own cost in
user time and tokens, an agent already asks its own questions reactively when it is
confused, and a fixed questionnaire can annoy more than it helps. So the point of this
document is not to assert the intake works; it is to specify an experiment that could
show it does **not**, and to commit to the analysis before any data exists.

## The intervention under test

We fix what "the intake" means precisely enough to test it, and no more.

An **adaptive MCQ intake** presents a short sequence of multiple-choice questions,
chosen before the agent does any task work, and produces a structured task brief that
seeds that work. Three properties are load-bearing and are the only ones this protocol
requires:

- **Short.** A hard cap on items (proposed cap: 5). The intake is a clarifier, not a
  form.
- **Adaptive.** The next item is selected conditional on prior answers (branching), and
  the intake **stops early** when the expected marginal reduction in task ambiguity falls
  below a threshold. A task that is already clear should trigger few or zero items.
- **Escapable.** Every item offers a small option set plus a free-form "none of these /
  other" escape, and the user can skip the intake entirely.

The exact question-selection policy (how the intake ranks candidate questions by expected
information gain, how it estimates "ambiguity") is a **separate design artifact** and is
deliberately out of scope here. This protocol treats the intake as a black box with the
three properties above, so that the evaluation does not depend on one particular
selection algorithm. If the black box helps, the next question is which policy inside it
did the work; that is a later study.

### What the intake is compared against

The naive comparison, "intake" versus "nothing", cannot isolate what we care about,
because the interesting claim is not "clarifying helps" (plausibly it does) but
"*this adaptive-MCQ machinery* helps more than cheaper clarification, and more than the
status quo." So we pre-register four conditions:

- **C0, reactive baseline.** No intake. The agent starts immediately and may still ask
  its own clarifying questions mid-task (we do not gag it). C0 is therefore
  "clarification happens reactively during work", not "no clarification at all". This is
  the honest status-quo control, and naming it correctly matters: the real contrast is
  *proactive structured* versus *reactive ad-hoc* clarification.
- **C1, free-text elaboration.** A single open prompt ("anything else I should know
  before I start?"), no structure, no options. Active control for the generic effect of
  being asked to specify more.
- **C2, fixed checklist.** The same multiple-choice surface as C3 but a fixed, generic,
  non-adaptive item set (no branching, no early stop). Active control for "structured
  questions" without the adaptivity.
- **C3, adaptive MCQ intake.** The treatment defined above.

The active controls (C1, C2) exist because participants cannot be blinded to the fact
that they were asked questions. Without them, any benefit of C3 over C0 could be a
demand or placebo effect ("the tool made me think harder, so I gave a better prompt").
C1 and C2 equalise that "I was asked extra things" experience, so a C3-over-C1/C2
difference is attributable to the adaptive-MCQ content rather than to the mere act of
being interrupted with questions.

## Falsifiable hypotheses

The site's claim has two halves, "improves task-clarity" and (by implication of "burn
tokens") "reduces wasted work". We separate them so each can fail on its own.

> **H1 (clarity).** Before doing task work, an agent that has run the adaptive MCQ intake
> (C3) restates the task with **higher fidelity to the user's pre-committed intent** than
> an agent with no intake (C0).
>
> **H2 (wasted turns).** On the same tasks, C3 produces **fewer correction turns** (user
> turns whose function is to fix a misunderstanding of the task) than C0.
>
> **H3 (net value).** C3 lowers the **total interaction cost to an accepted deliverable,
> counting the intake's own cost** (tokens and user time), relative to C0. This is the
> "clarify before you burn tokens" claim taken literally, including the price of
> clarifying.
>
> **Mechanism attribution (Stage 2).** C3 beats not only C0 but also the active controls
> C1 (free-text) and C2 (fixed checklist) on H2 and H3. If C3 only beats C0 and merely
> ties C1/C2, the honest reading is "clarifying up front helps; the *adaptive MCQ
> specifically* adds no measurable value over cheaper clarification."

The hypothesis is **supported** only if H2 (the mechanism) and H3 (the net value) both
move in the predicted direction beyond a pre-registered minimum effect, with H1
corroborating the *why*. Note the deliberately hostile structure: H2 can pass while H3
fails, if the intake's own cost eats the saving. We report that outcome as "mechanism
real, not net-positive at this intake length" rather than burying it, because it is a
real and useful result (it says: shorten the intake).

## Within-subject design

**Why within-subject.** The dominant sources of variance here are the *person* (some
users write clear prompts, some ramble) and the *task* (some requests are inherently
ambiguous). A between-subjects design would have to overcome both with sample size. A
within-subject design makes each participant their own control across conditions and each
task its own control across conditions, removing the person-level and task-level offsets
from the contrast. That is the same logic as pairing in a paired t-test, extended to a
crossed design.

**Unit of analysis: the task.** Each participant completes several tasks; each task is
assigned to one condition. Tasks are drawn from a fixed pool, pre-classified by
ambiguity (see the refutation section), and assigned so that within each participant the
conditions are balanced across ambiguity levels.

**Counterbalancing.** Condition order within a participant follows a Williams design (a
balanced Latin square that also balances first-order carryover), so that learning and
fatiguing effects are distributed evenly across conditions rather than confounded with
them. Tasks are never repeated within a participant (no participant does "the same task
with and without intake"), because a repeated task would leak the answer.

**The pre-registered analysis model.** A cross-classified mixed-effects model with
participant and task as crossed random effects:

```
outcome ~ condition + ambiguity_stratum + condition:ambiguity_stratum
          + (1 | participant) + (1 | task)
```

Contrasts of interest, all pre-registered and directional (one-sided in the hypothesised
direction): C3 - C0 (headline), and in Stage 2, C3 - C1 and C3 - C2 (attribution). The
`condition:ambiguity_stratum` interaction is the refutation test (below).

**Model nondeterminism.** The agent is a fixed model id, version, system prompt, tool
set, and temperature across all conditions; only the intake module differs. Even so, the
same prompt yields different transcripts run to run. Where budget allows we run R
replicate sessions per (task, condition) cell and add `(1 | session)` nested in task;
where it does not, we run one session per cell and absorb this into residual variance.
Either way we state plainly that model nondeterminism is a noise source we damp but
cannot eliminate.

**Blinding.**

- **Raters are blinded to condition.** Correction-turn coding and success scoring are
  done on the *working* transcript with the intake preamble stripped, so a C0, C1, C2, or
  C3 working transcript is structurally indistinguishable to a rater. Clarity-fidelity
  (H1) is scored on the agent's pre-work restatement, presented without revealing which
  intake produced it.
- **Two independent raters**, a fixed written codebook, disagreements adjudicated blind
  by a third. We report inter-rater reliability (Krippendorff's alpha for the ordinal
  clarity rubric, Cohen's kappa for the binary correction-turn labels) and pre-register a
  **minimum reliability of 0.60**, below which the rated outcome is declared unusable and
  only the objective outcomes are interpreted. We do not rescue a noisy rating post hoc.
- **Participants cannot be blinded** to receiving questions; the active controls C1/C2
  are how we handle that, not a blind we pretend to have.

**Pre-committed intent (the ground truth for clarity and success).** Before any
interaction, the participant privately writes and timestamps an **acceptance brief**:
what a correct deliverable must contain, in their own words. The agent never sees it.
Raters use it to score H1 (does the agent's restatement match the intent?) and task
success (does the final deliverable satisfy the brief?). Locking it *before* the session
prevents hindsight drift, the tendency to reconstruct "what I wanted" after seeing what
you got. Self-reported intent is itself imperfect and often underspecified; we note this
honestly, but the noise is shared across conditions, so it inflates variance without
biasing the C3 - C0 contrast.

## The metric

We pre-register one primary outcome per hypothesis, plus secondaries and cost/annoyance
measures. Objective outcomes come from the provider `usage` object and the transcript
structure and are exact; rated outcomes come from the blinded codebook.

**H2 primary (wasted turns), rated: correction-turn count per task.** A working turn is
one user-to-agent exchange after the intake. A turn is coded `CORRECTION` when its
function is to fix a misunderstanding of the task (redirect, restate, reject-and-clarify,
"no, I meant..."), as opposed to `ADVANCE` (moves the accepted deliverable forward) or
`ELABORATE` (adds detail the agent could not have known). The primary outcome is the
count of `CORRECTION` turns. The codebook, the boundary cases, and worked examples are
pinned before rating. Intake items are **not** working turns; they are intervention cost,
counted separately below.

**H3 primary (net value), objective: total tokens to accepted completion, intake
included.** Summed input, output, and cache tokens across the whole interaction from
task start (including the intake exchange) to the user accepting the deliverable,
right-censored at a per-task turn cap. Computed exactly from the `usage` object. This is
the literal "burn tokens" quantity, and it charges the intake for its own cost, so a
clarity win bought with a bloated intake will show up here as no net gain.

**H1 primary (clarity), rated: intent-fidelity of the pre-work restatement.** Before
touching the task, the agent emits a one-paragraph restatement ("here is what I
understand you want"). Two blinded raters score its fidelity to the pre-committed
acceptance brief on a pinned ordinal rubric (proposed 0-4: contradicts / misses the core
/ partial / substantially matches / fully matches). This measures the clarity half
directly and is the proposed mediator (intake raises clarity, which lowers waste).

**Secondary outcomes.**

- Turns to accepted completion (objective, right-censored at the cap).
- Task success: binary, does the final deliverable satisfy the pre-committed acceptance
  brief, scored blind. A cost win that comes with a success drop is not a win.
- Wall-clock time to completion (noisy; secondary only).

**Intake cost and annoyance (do-no-harm, mirroring the coach's override-rate).** Items
asked, time to answer them, intake **abandonment rate** (participant skips or bails), and
a post-task friction rating. H3 exists precisely so a clarity gain bought with excessive
user burden does not count as success. We also pre-register an annoyance kill analog: if
intake abandonment exceeds a pre-set rate, the intake is judged too long regardless of
its clarity effect. (This is the intake-side echo of the coach spec's override-rate kill
switch in the sibling [`coach`](../coach/README.md) design.)

**Decision rule.** One-sided tests in the hypothesised direction at alpha = 0.05, with
the two co-primary confirmatory outcomes (H2 and H3) controlled together by Holm so their
family-wise error stays at 0.05. Support requires **both** H2 and H3 to reach
significance **and** their point estimates to exceed the pre-registered minimum
detectable effect (MDE), so that a statistically significant but trivially small effect
is not reported as a win. Effect sizes and confidence intervals are reported for every
outcome regardless of significance, and a result whose CI spans zero (or lies below the
MDE) is reported as "no detected benefit," not spun. The MDE, the model, the primary
outcomes, and a fixed stopping rule (no optional stopping, no adding participants after a
peek) are all frozen before data collection.

## Pre-registered refutation condition

This is the core of an honest design: the conditions under which we will say the idea
failed, committed to in advance.

**1. Ambiguity moderation (the sharp one).** The clarity mechanism predicts the benefit
is **concentrated in ambiguous tasks and absent in already-clear tasks**, because an
unambiguous task has nothing to clarify. We pre-register the `condition:ambiguity`
interaction and require:

- effect(ambiguous) > effect(clear), with the interaction significant, **and**
- effect(clear) not significantly positive.

If the intake shows an equal or larger "benefit" on the pre-classified *clear* stratum as
on the *ambiguous* stratum, then whatever it is doing is not clarification (there was
nothing to clarify), and H1's mechanism is **refuted** even if the pooled average looks
good. That pattern would point to a placebo, demand, or experimenter effect, which is
exactly why this test exists. Tasks are classified into the ambiguity strata *before* the
study by raters blind to the hypothesis, using the pre-committed acceptance briefs, and
that classification is frozen.

**2. Net-value kill.** If C3 lowers correction turns (H2 passes) but does **not** lower
net total tokens or time (H3 fails), because the intake's own cost eats the saving, then
the "clarify before you burn tokens" value claim is **refuted at this intake length**,
even though the mechanism is real. We report this outcome explicitly rather than reporting
H2 alone.

**3. No-better-than-simpler kill (Stage 2).** If C3 does not beat both C1 (free-text) and
C2 (fixed checklist) on the primary outcomes, the *specific adaptive-MCQ design* is
**refuted as adding value over cheaper clarification**, even if "clarify up front"
generally helps. We would then keep the cheap clarification and drop the machinery.

**4. Reliability kill.** If the rated outcomes fail the pre-set inter-rater reliability
floor (0.60), those outcomes are declared **unmeasurable in this protocol** and dropped;
we interpret only the objective outcomes and say so.

**5. Harm.** If C3 significantly *increases* correction turns, net cost, or abandonment
relative to C0 on any stratum, the intake is doing harm on that stratum and is refuted
there regardless of average behaviour.

## Threats to validity and honest limits

- **Demand / placebo is the main threat.** A user asked questions may simply try harder.
  The active controls (C1, C2) and the ambiguity-moderation refutation are the two
  defences; neither is airtight, and we do not claim the design fully neutralises demand
  effects, only that it makes them detectable.
- **Contamination / learning.** A user who experiences the MCQ intake may learn to
  pre-specify and carry that into their C0 tasks, making C0 look better and shrinking the
  measured effect. For a "helps" claim this bias is *conservative* (it works against us),
  which is the safe direction, but we still use non-repeated tasks and model order
  effects rather than ignore it.
- **Model nondeterminism.** The same prompt gives different transcripts. We fix
  version/temperature and replicate where possible, but residual noise remains and we
  report it as such.
- **Rater subjectivity.** "Correction turn" and "clarity fidelity" are judgments.
  Codebook, blinding, two raters, adjudication, a reliability floor, and the reliability
  kill are the mitigations; the honest fallback is the objective token/turn counts, which
  need no rater.
- **Construct validity of the task pool.** Lab tasks with a knowable acceptance brief are
  clean but artificial; real in-the-wild tasks are valid but lack ground truth for
  clarity and success. We pre-register both an in-lab controlled-task arm (clean H1/H3)
  and an opportunistic in-the-wild arm (process metrics only, no clarity ground truth).
  Neither arm alone is decisive.
- **Intent self-report.** The acceptance brief is a fallible proxy for true intent; it
  adds variance shared across conditions.
- **Ceiling and floor.** Trivial tasks leave no waste to remove; impossible tasks fail
  regardless of clarity. Both are handled by the ambiguity stratification, and degenerate
  tasks are excluded by a pre-registered screen.
- **External validity.** Any finding is about our task pool, our model, and our
  participant sample. It is not a general law about intakes.
- **No data yet.** Like the sibling prototypes, TOP-3 has no user base. The only real
  pilot data (per the [personalisation](../personalisation/README.md) prototype) is one
  founder's Claude Code history dominated by a single repeated task, which is unusable for
  a within-subject clarity study. So the first feasible step is not this full experiment.

## Staged feasibility

Cheapest and least conclusive first, gold standard last, each stage explicit about what
it cannot show.

- **Stage 0 (feasible now, single user, instrumentation smoke test).** The founder runs a
  handful of self-authored tasks through C0 and C3, pre-committing acceptance briefs, to
  shake out the plumbing: transcript capture, exact token accounting, whether the
  correction-turn codebook is usable, whether intake abandonment is logged. This is a test
  of the *measurement apparatus*, not of the effect. One user, self-authored tasks, and
  obvious non-blinding mean it can prove the pipeline runs and nothing about whether the
  intake helps.
- **Stage 1 (small cohort, two conditions).** C0 versus C3, powered to the pre-registered
  MDE per the design simulation. Establishes whether the whole idea helps at all in our
  setting.
- **Stage 2 (cohort, four conditions).** Add C1 and C2 to attribute any Stage 1 effect to
  the adaptive MCQ specifically rather than to clarification in general.

## The design simulation (`intake_design_sim.py`)

Because we have no pilot data, we cannot know the real variance components, so we cannot
compute a single required sample size. What we *can* do, and what standard
pre-registration asks for, is two things, both of which this script does:

1. **Size the study under stated assumptions.** Simulate the crossed within-subject
   data-generating process under a *grid* of assumed variance components and the
   pre-registered MDE, and report the participants-by-tasks needed for a target power
   (proposed 80%). Every variance input is labelled an assumption; every output is
   "required N *under these assumptions*." This is planning arithmetic, not a claim about
   the intake.
2. **Pin the analysis and check the refutation logic.** The script runs the exact
   within-participant randomisation test the real study will use (numpy only, no scipy,
   distribution-free, deterministic given the seed), so the analysis code is frozen before
   any real data. It also simulates the refutation null (the clear-task stratum, true
   effect zero) and confirms the decision rule's false-positive rate matches alpha, i.e.
   that the test does not manufacture a significant effect where there is none.

The script asserts nothing about real intake performance. It sizes the experiment and
freezes the analysis. Captured output is in `design_power_synthetic.txt`.

## Files

- `README.md` - this protocol.
- `intake_design_sim.py` - a runnable design-time power and analysis-pinning tool (numpy
  only, deterministic). Simulates the within-subject design under assumed variance
  components, reports required sample size for a target power at the pre-registered MDE,
  runs the frozen within-participant randomisation test, and verifies the refutation-null
  false-positive rate. `--seed` to vary the draw.
- `design_power_synthetic.txt` - captured stdout from the default-seed run.

## Sources

- TOP-3 (Athena) description, this repository's `index.html`: "a personal coach that asks
  useful questions, learns how you work and helps turn a rough request into a better
  plan." The MCQ intake is the "asks useful questions ... turn a rough request into a
  better plan" slice of that.
- Sibling honest-research designs in this repo:
  [`../coach/README.md`](../coach/README.md) (the override-rate kill switch mirrored here
  as the intake abandonment kill) and
  [`../personalisation/README.md`](../personalisation/README.md) (the single-user data
  limitation shared by all TOP-3 work).
</content>
</invoke>
