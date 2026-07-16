# TOP-3 (Athena) landscape: who else works near per-user LLM cost forecasting and AI prompting coaches

Status: this is a cited literature and product scan, not a market study and not a claim
that TOP-3 works. Its job is narrow and falsifiable in spirit: locate the public work
that sits next to TOP-3, separate what is genuinely uncommon about a per-user
cost-forecast personalisation layer from what is already standard practice, and refuse to
dress either up. Every figure quoted below was checked against the primary source and is
attributed to it; where I only have a secondary description I say so and give no number.
"I did not find X" appears several times, and it always means exactly that, not "X does
not exist" (see the limits section: single-pass, US-only, July 2026, blind to stealth and
internal work).

## What TOP-3 is, restated so the comparison is fair

TOP-3 (Athena) as specified in the sibling research folders is three separable things.
The landscape hits each differently, so they are kept apart throughout.

1. **A per-user cost-forecast personalisation layer.** TOP-1 (Icarus) is meant to produce
   a *population* forecast of what an AI task will cost (a low / likely / high range).
   TOP-3's personalisation layer shrinks that population forecast toward a correction
   learned from the individual user's own past cost residuals, using Buhlmann credibility
   (empirical Bayes), with a deliberate property that at zero user history the forecast is
   identical to the population baseline. See [`../personalisation/README.md`](../personalisation/README.md).
2. **A metadata-only prompting coach.** Deterministic nudges toward cache-friendly request
   structure, computed from the provider `usage` object and per-block token counts and
   (opt-in) hashes, with a hard rule that it never reads prompt text. See
   [`../coach/README.md`](../coach/README.md).
3. **An adaptive MCQ intake.** A short, adaptive, escapable multiple-choice clarifier that
   runs before the agent works, with a pre-registered evaluation that charges the intake
   for its own token and time cost. See [`../intake/README.md`](../intake/README.md).

## Adjacent area 1: LLM cost observability and FinOps

**What exists.** A crowded field of tools that record and attribute LLM spend. Langfuse
tracks token usage and cost per generation, broken down by usage type, attached to the
trace it records ([Langfuse token and cost tracking docs](https://langfuse.com/docs/observability/features/token-and-cost-tracking)).
Helicone provides logging and per-request cost tracking through a proxy or SDK
([Helicone cost tracking docs](https://docs.helicone.ai/guides/cookbooks/cost-tracking)).
Gateways (LiteLLM, Portkey, Cloudflare AI Gateway) price requests inline and can enforce
budgets; observability tools (Langfuse, Opik, Arize Phoenix, PostHog LLM analytics) record
and explain them. The shared mechanic is simple and exact: read the token counts the
provider returns, multiply by the published per-token price.

**How it relates to TOP-3, and where it stops.** This is the layer TOP-3's cost forecast
sits *above*, not the same thing. These tools answer "what did this cost?" after the fact,
and can attribute spend per user, per trace, per model. What I did not find in this class
is a tool that (a) forecasts a *forward* cost range for a task before it runs, and (b)
personalises that forecast toward one user's own history with a shrinkage estimator that
is inert at cold start. FinOps tooling is retrospective accounting; TOP-3's layer is a
prospective, per-user, uncertainty-quantified prediction. Those are different objects.
(Note: I saw secondary claims of 2026 acquisitions of Langfuse and Helicone in search
summaries; I did not verify them and make no claim about them here.)

## Adjacent area 2: cost-aware LLM routing and cascades

**What exists, with verified figures.** This is the most active adjacent line, and it is
about *cutting* cost by choosing what runs, not *forecasting* cost.

- **FrugalGPT** (Chen, Zaharia, Zou, 2023) proposes an LLM cascade that sends a query
  through progressively more expensive models and stops when a response is judged
  reliable. Its abstract claims it can "match the performance of the best individual LLM
  (e.g. GPT-4) with up to 98% cost reduction" or "improve the accuracy over GPT-4 by 4%
  with the same cost" ([arXiv:2305.05176](https://arxiv.org/abs/2305.05176), figures
  quoted from the abstract).
- **RouteLLM** (LMSYS, 2024) trains routers on preference data to send easy queries to
  cheaper models. The blog reports "cost reductions of over 85% on MT Bench, 45% on MMLU,
  and 35% on GSM8K" while "still achieving 95% of GPT-4's performance"
  ([LMSYS RouteLLM post](https://www.lmsys.org/blog/2024-07-01-routellm/), figures quoted
  from the post). It is open source with a public framework.
- **Commercial routers.** Martian markets a real-time model router
  ([route.withmartian.com](https://route.withmartian.com/),
  [TechCrunch coverage, 2023](https://techcrunch.com/2023/11/15/martians-tool-automatically-switches-between-llms-to-reduce-costs/))
  and Not Diamond markets a learned router that picks a model per query
  ([Not Diamond](https://www.notdiamond.ai/),
  [routing docs](https://docs.notdiamond.ai/docs/what-is-model-routing)); Not Diamond also
  maintains a curated routing bibliography
  ([awesome-ai-model-routing](https://github.com/Not-Diamond/awesome-ai-model-routing)). I
  do not quote their headline savings figures because I could not verify them against a
  primary methodology; I describe only what the products claim to do.

**How it relates to TOP-3, and the honest distinction.** Routing and forecasting are
orthogonal, and it is worth being precise because a casual reader collapses them. A router
*decides an action* (which model to call) to change cost. TOP-3's personalisation layer
*emits a prediction* (what this task will cost this user, with a range) and changes
nothing on its own. A good forecast could feed a router, but the forecast is the artifact,
and the two can each exist without the other. Two further differences: routers optimise at
the *query* level against a *population* preference model, whereas TOP-3's layer is
calibrated to the *individual user*; and routers are evaluated on quality-retention at
lower cost, whereas TOP-3's layer is evaluated on forecast *calibration* (pinball loss,
interval coverage), a different success criterion entirely. So this large, well-funded
area is adjacent but not the same bet.

## Adjacent area 3: LLM cost and output-length prediction (the closest analog to TOP-1)

**What exists.** Predicting an LLM call's cost reduces largely to predicting its output
length, and there is an active systems literature on exactly that, driven by scheduling
and batching rather than by user-facing forecasts. "Predicting LLM Output Length via
Entropy-Guided Representations" (ICLR 2026) uses the model's own hidden states and token
entropy to predict length statically and progressively, reporting a "29.16% reduction in
mean absolute error" over baselines on its ForeLen benchmark
([arXiv:2602.11812](https://arxiv.org/abs/2602.11812), figure quoted from the abstract).
Related scheduling work predicts length to pack batches and reserve memory. At the exact,
deterministic end, a large family of free "token calculators" count a prompt's *input*
tokens locally and multiply by published prices to estimate cost before sending (for
example [token-calculator.net](https://token-calculator.net/),
[pricepertoken.com](https://pricepertoken.com/token-counter)); these are exact on input
but cannot see output length or an agent's multi-turn trajectory.

**How it relates to TOP-3.** This is the nearest analog to TOP-1 (Icarus), the
*population* forecast, not to TOP-3's personalisation of it. These methods forecast at the
prompt or population level for systems purposes, and none that I found personalise a cost
forecast to an individual user, quantify per-user forecast uncertainty as a low/likely/high
range for a human, or shrink a population estimate toward a user's residuals. The
heavy-tailed, stochastic nature of output length that this literature documents is also a
direct warning to TOP-1 and TOP-3: it is evidence that the log-normal, stationary
assumptions in TOP-3's prototype are optimistic (the prototype says as much in its own
limits).

## Adjacent area 4: LLM personalisation (of behaviour and content, not of cost)

**What exists.** A fast-growing line personalises *what the model says* to a user via
memory and user modelling: memory-construction-and-retrieval systems and user-profile
injection, surveyed and productised widely (for example Apple's
["On the Way to LLM Personalization"](https://machinelearning.apple.com/research/on-the-way),
and systems such as Mem0 and MemoryBank described in that literature). The object being
personalised is the *response*: preferences, tone, recalled facts.

**How it relates to TOP-3, and the clean distinction.** TOP-3 personalises a *forecast
about the user's cost/behaviour*, not the model's answer to the user. Same word,
"personalisation," different object. I found no work in this behaviour-personalisation line
that personalises a cost or resource forecast. So the "personalisation" TOP-3 does is not
the "personalisation" this active field does, and conflating them would overstate both the
competition and the novelty.

## Adjacent area 5: prompt optimisation and prompting coaches

**What exists, with verified figures where I have them.**

- **DSPy** (Stanford NLP) reframes prompting as programming: you declare typed signatures
  and modules and let optimisers tune the prompts (and optionally weights) against a
  metric. Its README describes it as "the framework for programming, rather than prompting,
  language models" that "offers algorithms for optimizing their prompts and weights"
  ([stanfordnlp/dspy](https://github.com/stanfordnlp/dspy)). I do not quote star counts or
  "X% improvement" figures that appeared only in secondary write-ups.
- **Anthropic's Console prompt improver and generator** rewrite and generate prompt *text*
  using prompt-engineering techniques. Anthropic reports the improver raised Claude 3
  Haiku's accuracy by 30% on a Wikipedia-title-matching task and brought word-count
  adherence to 100% on a summarisation task
  ([Anthropic prompt improver announcement](https://claude.com/blog/prompt-improver),
  figures quoted from the post; [Console prompting tools docs](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-tools)).
- Numerous commercial "prompt optimiser" tools exist in the same content-rewriting mould.

**How it relates to TOP-3's coach, and where the coach is genuinely unusual.** Every tool
above shares two assumptions TOP-3's coach deliberately breaks. First, they optimise for
*quality* (accuracy, robustness, format adherence); TOP-3's coach optimises for *cost*
(cache engagement, avoided history resend), a different objective. Second, and more
sharply, they *read and rewrite the prompt text*; TOP-3's coach has a hard rule that it
never reads prompt text and acts only on the `usage` object, token counts, and opt-in
hashes. I did not find another prompting coach built on an explicit "never read the prompt"
constraint. That constraint is the uncommon part. The individual nudges themselves are not
novel: they are documented provider mechanics (prefix caching economics, Files API dedupe,
batch pricing), which the coach's own README cites. So the coach's novelty is in the
packaging and the privacy constraint, not in discovering new ways to save tokens.

## Adjacent area 6: clarifying questions and pre-task intake

**What exists.** Asking clarifying questions to resolve ambiguity is an established
research area in conversational search and question answering, now very active in the LLM
era. A 2025 survey, "Disambiguation in Conversational Question Answering in the Era of LLMs
and Agents," catalogues forms of ambiguity and LLM-enabled disambiguation strategies
([arXiv:2505.12543](https://arxiv.org/abs/2505.12543)). Benchmarks and systems for
generating and evaluating clarifying questions exist (for example AGENT-CQ,
[ACM TOIS](https://dl.acm.org/doi/10.1145/3809182) /
[arXiv:2410.19692](https://arxiv.org/abs/2410.19692); ProductAgent,
[arXiv:2407.00942](https://arxiv.org/abs/2407.00942)).

**How it relates to TOP-3's intake.** The *idea* of asking clarifying questions before
acting is not novel, and the intake spec does not claim it is. Two things are less common
in what I found. First, the framing is cost, not just answer quality: "clarify before you
burn tokens," with the pre-registered net-value hypothesis (H3) explicitly charging the
intake for its own token and time cost, so a clarity win bought with a bloated intake
counts as a loss. Second, the evaluation rigor (four conditions including active controls,
a within-subject crossed design, a pre-registered ambiguity-moderation refutation) is
stronger than a typical "does clarification help" demo. Even so, that rigor is transferred
from standard experimental methodology, not invented here; the honest contribution is
applying an existing, well-understood method carefully to this specific claim.

## Adjacent area 7: the statistical method under the personalisation layer

**What exists.** Buhlmann credibility, the estimator in TOP-3's personalisation prototype,
is a 1960s actuarial method (Buhlmann 1967) and is textbook material for insurance
experience rating: shrink a group rate toward a policyholder's own claims experience,
weighting the individual data more as it accumulates. It is an empirical-Bayes / linear
shrinkage estimator, and modern treatments state plainly that "linear credibility
estimators are also referred to as shrinkage estimators in statistics" (for example
[Loss Data Analytics, ch. 9, Experience Rating Using Credibility Theory](https://openacttexts.github.io/Loss-Data-Analytics/ChapCredibility.html);
[general optimal Buhlmann credibility, Insurance: Mathematics and Economics](https://www.sciencedirect.com/science/article/abs/pii/S0167668722000245)).
The same shrinkage idea is standard in hierarchical Bayesian modelling and in recommender
systems.

**How it relates to TOP-3.** The math is deliberately old and boring, and the prototype
says so on purpose ("the boring, well understood way"). Applying credibility shrinkage to
per-user LLM *cost residuals* is a domain transfer, not a new estimator. So none of the
novelty of TOP-3's personalisation layer can honestly be located in the statistics; the
statistics are a feature precisely because they are unsurprising and hard to get wrong.

## What is genuinely uncommon versus what is standard

Kept blunt on purpose.

**Not novel (standard practice, cited above):**

- Measuring and attributing LLM spend per user, model, trace (area 1).
- Cutting cost by routing or cascading across models (area 2).
- Forecasting population-level LLM cost / output length for scheduling (area 3).
- Personalising a model's *responses* via memory and user modelling (area 4).
- Rewriting *prompt text* to improve quality (area 5).
- Asking clarifying questions to resolve ambiguity (area 6).
- Credibility / empirical-Bayes shrinkage as an estimator (area 7).

**Uncommon, as far as this scan found (stated as a hypothesis about the public
landscape, not a proof):**

- A cost forecast that is at once *forward-looking*, *per-user calibrated*, and *shrunk
  from a population baseline so that it is provably inert at cold start*. The pieces all
  exist separately; the intersection is what I did not find already built. This is the core
  of TOP-3's personalisation bet.
- A prompting coach defined by a *never-read-the-prompt-text* constraint, acting on usage
  metadata alone to target *cost* structure. Each nudge is known provider mechanics; the
  constraint-plus-packaging is the uncommon part.

**Uncommon but cheap:** novelty of an *unvalidated* mechanism is worth little. Every
"uncommon" item above is unproven on real users (the prototypes run on synthetic data; the
intake protocol has run on nobody). An idea nobody has shipped might be un-shipped because
it does not work, not because nobody thought of it. The landscape can tell us TOP-3 is not
a me-too of routing or FinOps; it cannot tell us the intersection is *valuable*. That is
the real open question, and it is empirical, not bibliographic.

## Where TOP-3 actually sits

The public market has three mature things: tools that *measure* spend after the fact,
routers that *reduce* spend by switching models, and academic methods that *forecast*
population cost for scheduling. What is thin is a cost signal that is simultaneously
personal to one user, predictive rather than retrospective, and fed back to that user as a
forecast (and, via the coach, as structural advice). TOP-3 is a bet on that intersection.
The bet's weakest joint is not the estimator (old and safe) and not the mechanics (cited
and real); it is the two unproven assumptions the whole thing rests on: that a stable,
learnable per-user cost offset exists in real usage, and that a personalised forecast plus
metadata nudges change user behaviour enough to matter over just measuring or just routing.
Both are empirical and both are currently untested (see every sibling README's limits).

## Limits of this landscape review

- **One pass, one engine, one region, one date.** US-only web search, July 2026, a handful
  of queries. Not systematic, not exhaustive, and the field moves weekly.
- **Blind to non-public work.** Stealth startups, unpublished internal tooling at the
  labs, and private forks are invisible here. Every "I did not find" is bounded by that.
- **Verified versus described.** The four headline figures I state as numbers (FrugalGPT
  98% / +4%, RouteLLM 85% / 45% / 35% at 95% quality, Anthropic improver +30% and 100%,
  entropy-length 29.16% MAE) were each read from the primary source and are attributed to
  it. Everything else is described qualitatively on purpose, because I would not verify the
  underlying number; secondary blog figures (star counts, vendor savings claims, claimed
  acquisitions) are deliberately omitted rather than repeated.
- **Not a neutral observer.** This review was commissioned to place TOP-3, so its
  "uncommon" findings should be read as claims to be checked, not settled facts. The
  honest posture is that the landscape supports "TOP-3 is not a copy of an existing
  category," and supports nothing at all about whether TOP-3 works.

## Sources

Cost observability and FinOps:
- Langfuse, Token and cost tracking: https://langfuse.com/docs/observability/features/token-and-cost-tracking
- Helicone, Cost tracking cookbook: https://docs.helicone.ai/guides/cookbooks/cost-tracking

Cost-aware routing and cascades:
- FrugalGPT (Chen, Zaharia, Zou, 2023), arXiv:2305.05176: https://arxiv.org/abs/2305.05176
- RouteLLM (LMSYS, 2024): https://www.lmsys.org/blog/2024-07-01-routellm/
- Martian: https://route.withmartian.com/ ; TechCrunch (2023): https://techcrunch.com/2023/11/15/martians-tool-automatically-switches-between-llms-to-reduce-costs/
- Not Diamond: https://www.notdiamond.ai/ ; routing docs: https://docs.notdiamond.ai/docs/what-is-model-routing ; bibliography: https://github.com/Not-Diamond/awesome-ai-model-routing

Cost / output-length prediction:
- Predicting LLM Output Length via Entropy-Guided Representations (ICLR 2026), arXiv:2602.11812: https://arxiv.org/abs/2602.11812
- Token calculators (representative): https://token-calculator.net/ ; https://pricepertoken.com/token-counter

LLM personalisation (behaviour / content):
- Apple, On the Way to LLM Personalization: https://machinelearning.apple.com/research/on-the-way

Prompt optimisation and prompting coaches:
- DSPy (Stanford NLP): https://github.com/stanfordnlp/dspy
- Anthropic, Prompt improver announcement: https://claude.com/blog/prompt-improver
- Anthropic, Console prompting tools docs: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-tools

Clarifying questions and intake:
- Disambiguation in Conversational QA in the Era of LLMs and Agents: A Survey (2025), arXiv:2505.12543: https://arxiv.org/abs/2505.12543
- AGENT-CQ, ACM TOIS: https://dl.acm.org/doi/10.1145/3809182 ; arXiv:2410.19692: https://arxiv.org/abs/2410.19692
- ProductAgent, arXiv:2407.00942: https://arxiv.org/abs/2407.00942

Credibility / empirical-Bayes shrinkage:
- Loss Data Analytics, ch. 9 (Experience Rating Using Credibility Theory): https://openacttexts.github.io/Loss-Data-Analytics/ChapCredibility.html
- A general optimal approach to Buhlmann credibility theory, Insurance: Mathematics and Economics: https://www.sciencedirect.com/science/article/abs/pii/S0167668722000245
