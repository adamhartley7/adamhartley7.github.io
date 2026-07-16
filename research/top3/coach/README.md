# TOP-3 (Athena) prompting coach: honest, metadata-only nudges

Status: research spec plus a synthetic prototype. Nothing here is shipped, A/B tested,
or benchmarked on real users. This is a design of a mechanism and a plan to test it,
not a claim that it saves money. Every figure in this document is either a cited fact
from a provider's own documentation (with a link) or an arithmetic identity. There are
no measured savings, because we have not measured any.

## The idea in one paragraph

TOP-3 (Athena) is described on the site as "a personal coach that asks useful questions,
learns how you work and helps turn a rough request into a better plan." This spec covers
one narrow, testable slice of that: a coach that suggests concrete, evidence-based changes
to how a user's AI requests are **structured**, so the same work costs fewer tokens. The
design has one hard rule that shapes everything else: **the coach operates on request
metadata and structure only, and never on the text of the prompt.** It does not read what
you wrote. It reads how much you wrote, how it was arranged, and what the provider's usage
accounting says came back. From those signals alone it can spot the well documented ways
that a prompt wastes tokens (a cache that never engages, a whole conversation re-sent at
full price every turn, a large document re-uploaded again and again) and nudge you to fix
the structure. It is deliberately not an LLM in the loop: the nudges are deterministic
functions of numbers, so "honest rules, not magic" is literal here. There is no model
guessing your intent, and the coach adds essentially no cost of its own.

## The hard constraint: metadata and structure only

"Never operates on prompt text content" is a privacy and trust decision, and it is also
what makes the coach cheap and honest. We define two tiers, and the default is the strict
one.

**Tier 0, usage-only (default).** The coach consumes only what the provider already
returns and what the client already knows without inspecting text:

- The `usage` object on each response: `input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`. For Anthropic these fields are
  documented and returned on every request
  ([prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
- Per-request timing (relative), the turn count in a session, the number of content blocks,
  and each block's token count and role (system / user / assistant / tool).
- The model id and whether the tool set changed between requests (as a count, and as a
  digest of the serialized tool list, never the tool descriptions).

This tier touches zero prompt text. It is pure telemetry, and most of the cost nudges
below are derivable from it alone.

**Tier 1, structural digests (opt-in).** To point at *which* block is the culprit rather
than just saying "something in your prefix changes every request," the coach can also
consume a per-block SHA-256 digest computed client-side. A digest lets the coach detect
"this exact block reappeared" or "this block changed" without reading a single word. The
honest caveat: computing a hash does pass the content through a one-way function locally,
and a hash confirms sameness, not meaning. It is not a secrecy guarantee for low-entropy
content (an adversary who already has a candidate string can confirm a guess). What Tier 1
does guarantee is that the coach never reads, stores, or transmits plaintext; it acts on
fixed-length digests and integer token counts only. Tier 1 is off unless the user turns
it on, and every nudge that needs it degrades gracefully to a vaguer Tier 0 version if it
is off.

## Why structure-level nudges can work at all

The coach is only worth building if the cost of an AI request really does depend on its
structure in ways a user can control. It does, and the mechanics are documented by the
providers themselves.

**Prompt caching is a prefix match.** Anthropic caches the exact token prefix up to a
marked breakpoint; any byte change anywhere in the prefix invalidates the cache from that
point on. The render order is `tools`, then `system`, then `messages`, and a change at one
level invalidates that level and everything after it
([Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
OpenAI's automatic caching works the same way: it is an "exact prefix match" and their own
guidance is to "place static content like instructions and examples at the beginning of
your prompt, and put variable content, such as user-specific information, at the end"
([OpenAI prompt caching](https://platform.openai.com/docs/guides/prompt-caching)).

**The economics are fixed and published.** On Anthropic, a cache read costs 0.1x the base
input token price, a 5-minute-TTL cache write costs 1.25x, and a 1-hour-TTL write costs 2x
([Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
So repeated, correctly-cached prefix tokens are billed at roughly a tenth of their
uncached price, and the break-even is small: a 5-minute entry pays for itself on the second
read (1.25 + 0.1 = 1.35 versus 2.0 uncached), a 1-hour entry on the third (2.0 + 0.2 = 2.2
versus 3.0). There are at most 4 breakpoints per request, and a prefix shorter than the
model's minimum cacheable length silently will not cache at all.

**Ordering guidance points the same way.** Anthropic's long-context guidance is to "put
longform data at the top: place your long documents and inputs near the top of your prompt,
above your query, instructions, and examples," and reports that queries at the end can
improve response quality "by up to 30% in tests"
([Anthropic long-context tips](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/long-context-tips)).
That 30% is Anthropic's stated result about answer **quality**, not cost, and we do not
repurpose it as a savings figure. We cite it only because the ordering it recommends (stable
longform content first, variable query last) is exactly the ordering that prefix caching
rewards. The two goals coincide.

So the opportunity is real: two independent providers document that stable-first,
volatile-last structure is both better for quality and cheaper to run, and that getting it
wrong quietly wastes tokens. The coach's job is to notice, from metadata, when a user is on
the wrong side of that line.

## The nudge catalogue

Each nudge below lists the metadata signal that triggers it, the suggestion, the cited
evidence, the guard that stops it firing when it would not pay off, and what it will
explicitly not claim. All signals are Tier 0 unless marked Tier 1.

### A. Cache efficiency

**A1. Cache never engaged on a repeated prefix.**
Signal: across N recent requests in a session, `cache_read_input_tokens` is 0, yet the
leading blocks are large and recur (Tier 0: same leading block token counts and a stable
total prefix size above the model's cache floor; Tier 1: identical leading-block digests).
Suggestion: add a cache breakpoint at the end of the stable prefix.
Evidence: repeated prefix tokens bill at 0.1x once cached
([Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
Guard: do not fire unless the repeated prefix clears the model's minimum cacheable length
and is reused at least twice inside the TTL (break-even, see Economics).
Will not claim: a specific dollar saving. It reports addressable tokens, not delivered
savings.

**A2. Silent cache invalidator.** (Tier 1 for localization; Tier 0 can only say "your
prefix is changing.")
Signal: a leading block's token count is stable across requests but its digest changes
every request, and `cache_read_input_tokens` stays 0. This is the fingerprint of an
injected timestamp, UUID, or unsorted serialization sitting in the cached region.
Suggestion: move the volatile element after the last breakpoint, or make it deterministic.
Evidence: prefix-match invalidation; silent invalidators are a documented failure mode
([Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
Guard: the coach reports *which block position* changes and that its size is stable; it
does not and cannot say what the changing bytes are, because it never reads them. The
diagnosis is handed to the user, who can see their own content.
Will not claim: knowledge of the offending text.

**A3. Volatile-first ordering.**
Signal: the block that changes most often (highest digest-change frequency over a window,
Tier 1; or the block whose size varies most, Tier 0) sits *before* one or more large stable
blocks. Because caching is a prefix match, an early change invalidates everything after it.
Suggestion: reorder so stable content precedes volatile content.
Evidence: Anthropic ("longform data at the top, above your query") and OpenAI ("static
content at the beginning ... variable content at the end")
([Anthropic long-context](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/long-context-tips),
[OpenAI](https://platform.openai.com/docs/guides/prompt-caching)).
Guard: only fire when the stable blocks after the volatile one are large enough that the
lost cache reads clear break-even.
Will not claim: that reordering changes the answer. (It may, per Anthropic's quality note,
but the coach's claim is scoped to cost.)

**A4. Tool or model churn inside a session.**
Signal: the tool-list digest or the model id changed between consecutive requests in one
session.
Suggestion: keep the tool set and model stable within a session; if you need modes, pass
the mode as message content rather than swapping tools.
Evidence: tool definitions render at position 0, so changing them invalidates the entire
cache; caches are model-scoped
([Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
Guard: ignore single-request sessions and intended model switches the user has flagged.
Will not claim: that the user's tool changes were unnecessary, only that they cost the
cache.

### B. Avoiding needless context reloading

**B1. Full-history resend growth.**
Signal: in a stateless multi-turn loop, `input_tokens` grows roughly linearly with turn
count while output stays flat and `cache_read_input_tokens` is near 0. Every turn re-sends
and re-pays for the whole transcript at full price.
Suggestion: place a conversation-level cache breakpoint on the last turn so each turn reads
the prior transcript from cache, or adopt server-side context management (compaction /
context editing).
Evidence: multi-turn caching pattern; compaction summarizes earlier context server-side
([Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)).
Guard: require at least a few turns and a rising input-token trend before firing.
Will not claim: a specific saving; it projects the repriced token delta as addressable.

**B2. Re-uploaded document.** (Tier 1.)
Signal: the same large block (same digest and size) reappears across many *separate*
requests, uncached.
Suggestion: upload the document once via the Files API and reference it by `file_id`, or
use a 1-hour cache for bursty reuse.
Evidence: the Files API lets a file be referenced across requests without re-sending, and
is billed as input only when used
([Anthropic Files API](https://platform.claude.com/docs/en/build-with-claude/files));
1-hour TTL keeps entries alive across gaps
([Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
Guard: only fire when reuse count and timing clear the 1-hour break-even.
Will not claim: that the document is unnecessary.

**B3. Below the cache floor (a guard, not a nudge).**
Signal: a repeating prefix is under the model's minimum cacheable length.
Action: suppress A1/A3. A breakpoint here would pay the write premium and never read.
Evidence: prefixes under the model minimum silently do not cache
([Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
This is the coach declining to give advice that cannot pay off.

### C. Batch and async (only with an explicit user flag)

**C1. Latency-insensitive bulk.**
Signal: many structurally similar requests (same model, same tool digest, similar sizes)
fired in a tight burst, AND the user has marked the workload non-interactive.
Suggestion: use the Batch API, which processes asynchronously at 50% of standard price
([Anthropic batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)).
Guard: **never infer interactivity.** The non-interactive flag must be set explicitly by
the user or the calling workload, because guessing wrong (telling someone in a live session
to batch) is exactly the annoyance failure the kill metric exists to catch.
Will not claim: latency is acceptable to the user; that is theirs to declare.

## Economics guards (do no harm)

The coach must never recommend a change whose own overhead exceeds the saving. Two guards,
both computable from metadata:

- **Break-even on caching.** With write 1.25x and read 0.1x for a 5-minute entry, caching a
  prefix of `P` tokens reused `k` times inside the TTL costs `1.25P + 0.1P(k-1)` versus
  `kP` uncached; it wins once `k >= 2`. For a 1-hour entry (write 2x) it wins once
  `k >= 3`. A1, A3, B1, and B2 only fire when the observed reuse count and inter-request
  timing clear the relevant threshold. (Multipliers from the Anthropic docs above.)
- **Cache-floor guard (B3).** No caching nudge fires below the model's minimum cacheable
  prefix length.

The coach itself uses no model call to decide a nudge, so its marginal cost is arithmetic
over the usage object. A coach that spent tokens to save tokens would be self-defeating, so
this is a design invariant, not an optimization.

## The kill metric: override-rate

The failure mode of any coach is not being wrong, it is being annoying: correct-but-unwanted
nudges that the user has to keep swatting away. Override-rate is the metric that catches
this, and it is wired directly to a kill switch so the system removes its own noise rather
than making the user fight it.

**Nudge lifecycle.** Every surfaced nudge ends in one of three states: `ACCEPTED` (the user
applied or acknowledged the suggestion), `SNOOZED` (dismissed this instance), or `MUTED`
(the user asked to stop seeing this rule).

**Definition.** For a rule `r`, over a rolling window of its last `W` surfacings:

```
override_rate(r) = (SNOOZED + MUTED) / SURFACED        # equivalently 1 - acceptance rate
```

**Per-rule kill.** When `SURFACED(r) >= min_samples` and `override_rate(r) >= theta_kill`,
the rule auto-disables. It stops surfacing until the user re-enables it. Proposed defaults,
stated as hypotheses to be calibrated, not proven constants: `min_samples = 8`,
`theta_kill = 0.5`. The reading of 0.5 is deliberate: if the user rejects a nudge as often
as they accept it, it is not earning its interruption.

**Global kill.** If the aggregate override-rate across all active rules exceeds
`theta_global` (proposed 0.4) over the last `M` surfacings (proposed 50), the whole coach
mutes itself for a cooldown period. One bad rule should not poison the user's trust in the
rest; sustained aggregate rejection means back off entirely.

**Independent caps (annoyance is not only about being wrong).** Regardless of override-rate,
the coach obeys a hard nudge budget: at most `K` nudges per session and per day, deduped so
the same rule does not fire twice on the same underlying pattern. Nudges surface as an
end-of-session digest or an ambient indicator, never as a mid-task interrupt. Interruption
timing is its own annoyance lever, independent of correctness, so the coach controls it
directly rather than trusting the content of the nudge to carry the day.

The `coach_sim.py` prototype implements this override-rate kill switch and demonstrates it
auto-disabling a deliberately noisy rule on a synthetic override trace.

## Measurement plan: does it cut cost without annoying?

TOP-3 has no user base yet, and the only real pilot data (per the sibling
[personalisation prototype](../personalisation/README.md)) is one founder's Claude Code
history dominated by a single repeated task. So the honest plan is staged, cheapest and
most feasible first, gold standard last, with each stage clear about what it can and cannot
show.

**Two outcomes, always measured together.**

1. Cost. Cost per task or per session in dollars, computed from the usage object with the
   provider's published per-token prices and cache multipliers. This is exact, not modeled:
   `cost = input * 1.0 + cache_write * mult_w + cache_read * 0.1 + output * out_mult`, times
   the base price.
2. Annoyance. Override-rate (the kill metric), nudges per session, whether and when the user
   muted the coach (time-to-first-mute), and how many rules got auto-killed. A coach that
   cuts cost but gets muted has failed, so neither number is reported without the other.

**Stage 1, counterfactual dry-run (feasible now, observe-only).** Run the coach over
recorded session metadata in observe-only mode. For each nudge it would emit, compute the
counterfactual cost delta from metadata alone, using only mechanics we can price exactly
(cache read versus write multipliers, Files API dedupe, batch 50%). Example for B1: if a
conversation breakpoint had been present, the re-sent prefix on turn `t` would bill at 0.1x
after one 1.25x write instead of full price; the repriced delta is exact arithmetic over the
recorded token counts. This bounds two things without changing anyone's behavior: the
**addressable spend** the coach flags, and the **nudge volume** it would generate (a proxy
for annoyance). It is honest because it never claims behavior change: the output is "spend
the coach could point at," not "spend it saved." It also cannot prove users would accept the
advice, so it is an upper bound on opportunity and a first read on noise, nothing more.

**Stage 2, single-user interventional pilot.** Turn the coach on for the founder's own usage.
Log nudges, accept/snooze/mute decisions, and the realized cost series. Look for a
within-subject before/after change in cost per unit work, and track override-rate live.
This is underpowered and confounded (one user, one dominant task, learning effects, no
control), so it is a smoke test of the mechanism end to end, not evidence of an effect size.

**Stage 3, randomized A/B (the gold standard, later).** Once a cohort exists, randomize
users or sessions to coach-on versus coach-off. Report intent-to-treat on cost (coach
assigned, regardless of whether nudges were accepted) and per-protocol (among accepted
nudges, did the targeted metric move in the projected direction), alongside the annoyance
outcomes. Only this stage can establish that the coach causes lower cost.

**Falsifiable hypothesis.**

> On workloads with structural waste (an uncached repeated prefix, a re-sent transcript, a
> re-uploaded document), a metadata-only coach that nudges toward cache-friendly structure
> reduces measured cost per unit work relative to no coach, while keeping override-rate below
> the per-rule kill threshold, with the accepted nudges accounting for the cost reduction.
>
> Guard: on workloads with **no** structural waste (cache already engaged, stable prefix,
> no history bloat) the coach must stay essentially **silent**, and any nudges it does emit
> must show no cost improvement when accepted. A coach that keeps nudging, or claims savings,
> on an already-efficient workload is manufacturing work, and the hypothesis is falsified as
> stated.

The prototype's "already good" synthetic scenario is exactly this guard: on a healthy trace
the coach must produce zero nudges.

## Honest limits

- **No results.** This document contains no measured savings and no measured override-rates,
  because none have been measured. The prototype's numbers are arithmetic on synthetic
  metadata that we generated, and describe that synthetic trace only. They demonstrate the
  mechanism, not an effect on real usage.
- **The dry-run measures opportunity, not outcome.** Stage 1 can tell us how much spend the
  coach would point at and how many nudges it would fire. It cannot tell us whether users
  would act, or whether acting would annoy them. Only Stages 2 and 3 touch that, and only
  Stage 3 can attribute cause.
- **Provider-specific mechanics.** The concrete numbers (1.25x / 2x / 0.1x, 4 breakpoints,
  cache floors, batch 50%) are Anthropic's and OpenAI's current documented values and will
  drift. The coach must read them from a config that tracks the provider docs, not hard-code
  them, or its break-even guards silently go wrong.
- **Metadata is coarser than content.** Refusing to read prompt text is a real constraint,
  not just a virtue. A2 can localize a changing block but cannot name the offending token; a
  content-reading linter could. We accept the coarser signal for the privacy guarantee, and
  we should verify the coarser signal is still actionable enough (part of what the pilot
  tests).
- **Thresholds are guesses.** `theta_kill`, `theta_global`, `min_samples`, and the nudge caps
  are proposed defaults, not calibrated values. Calibrating them is a measurement goal, not a
  settled result.
- **Selection of what to nudge is itself a hypothesis.** We chose caching, history reloading,
  and document reuse because their mechanics are documented and their cost is exactly
  priceable from metadata. Other structural wastes may exist that metadata cannot see; the
  catalogue is a starting set, not a claim of completeness.

## Files

- `README.md` - this spec.
- `coach_sim.py` - a runnable prototype (Python standard library only, deterministic) that
  implements two metadata-only detectors (history-resend and silent cache invalidator), the
  exact counterfactual cost arithmetic, the "stay silent on a healthy trace" guard, and the
  override-rate kill switch, over four synthetic scenarios. `--seed` to vary the draw.
- `results_synthetic.txt` - captured stdout from the default-seed run.

## Sources

- Anthropic, Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
  (cache write 1.25x for 5-minute TTL and 2x for 1-hour TTL, cache read 0.1x, up to 4
  breakpoints, `tools -> system -> messages` prefix hierarchy, model-dependent minimum
  cacheable length, silent invalidators).
- Anthropic, Long context prompting tips:
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/long-context-tips
  ("put longform data at the top, above your query"; queries at the end can improve response
  quality up to 30% in tests, a quality claim, cited here only for the ordering principle).
- OpenAI, Prompt caching: https://platform.openai.com/docs/guides/prompt-caching
  (automatic, exact prefix match, activates at 1024+ tokens, "static content at the
  beginning ... variable content at the end").
- Anthropic, Files API: https://platform.claude.com/docs/en/build-with-claude/files
  (upload once, reference by `file_id` across requests).
- Anthropic, Batch processing: https://platform.claude.com/docs/en/build-with-claude/batch-processing
  (asynchronous processing at 50% of standard price).
- Anthropic, Compaction: https://platform.claude.com/docs/en/build-with-claude/compaction
  (server-side summarization of earlier context for long conversations).
