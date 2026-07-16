"""
TOP-3 (Athena) prompting coach: metadata-only nudge prototype.

WHAT THIS IS
------------
A runnable sketch of the coach specified in README.md. It demonstrates that the
documented cost-wasting patterns can be detected, and their addressable cost bounded,
from REQUEST METADATA ALONE, without ever reading prompt text. It also implements the
override-rate kill switch that stops the coach being annoying.

Everything runs on SYNTHETIC metadata generated in this file. There are no real prompts
and no real costs here. Every number printed is arithmetic over that synthetic metadata
and describes the synthetic trace only. This is a proof of mechanism, not evidence about
real usage. See README.md for the design, the citations, and the honest limits.

WHAT IT SHOWS
-------------
1. The coach consumes only a per-request metadata record: token counts, block sizes,
   client-side SHA-256 digests (Tier 1), and the provider `usage` object. No prompt text.
2. Detector B1 (history resend): input tokens grow with turn count while the cache is not
   engaged, so the whole transcript is re-paid at full price every turn. The coach projects
   the EXACT repriced cost delta a conversation-level cache breakpoint would unlock.
3. Detector A2 (silent cache invalidator): a leading block whose size is stable but whose
   digest changes every request, with cache reads stuck at zero. The coach localizes the
   block and reports an UPPER BOUND on addressable tokens (it cannot price it exactly,
   because it never reads the volatile bytes).
4. Guard: on a healthy trace (cache already engaged, stable prefix) the coach emits ZERO
   nudges. Manufacturing work on an efficient workload would falsify the design.
5. The override-rate kill switch auto-disables a rule the (synthetic) user keeps
   overriding, while a genuinely useful rule survives.

Pricing uses Anthropic's documented input-side multipliers (cache write 1.25x for the
5-minute TTL, cache read 0.1x, uncached input 1.0x); see README.md sources. Costs are in
units of ONE UNCACHED INPUT TOKEN, so no dollar figure is assumed or implied. Output
tokens are excluded because these structural nudges do not change output.

Dependencies: Python standard library only. Deterministic given the seed.

Run:
    python coach_sim.py            # all four scenarios
    python coach_sim.py --seed 7   # different synthetic draw
"""

from __future__ import annotations

import argparse
import hashlib
import random
from dataclasses import dataclass, field


# ----------------------------------------------------------------------------
# Documented input-side pricing multipliers (Anthropic prompt caching docs).
# Units: price of one UNCACHED input token = 1.0. No currency is assumed.
# ----------------------------------------------------------------------------
UNCACHED = 1.0
CACHE_WRITE_5M = 1.25
CACHE_READ = 0.10


# ----------------------------------------------------------------------------
# The only thing the coach is allowed to see: metadata, never prompt text.
# ----------------------------------------------------------------------------
@dataclass
class Block:
    """One content block. `digest` is a client-side hash (Tier 1); the coach never
    reads the underlying text. `tokens` and `role` are Tier 0 metadata."""
    role: str          # 'system' | 'user' | 'assistant' | 'tool'
    tokens: int
    digest: str        # sha256 hex of synthetic content (stands in for Tier 1 signal)


@dataclass
class Usage:
    """The provider usage object, returned on every response. Pure telemetry (Tier 0)."""
    input_tokens: int = 0                    # uncached input, full price
    cache_creation_input_tokens: int = 0     # written to cache this request (~1.25x)
    cache_read_input_tokens: int = 0         # served from cache this request (~0.1x)
    output_tokens: int = 0                    # not affected by these nudges


@dataclass
class RequestMeta:
    session_id: str
    idx: int
    model_id: str
    tool_digest: str
    blocks: list[Block]
    usage: Usage


def digest(label: str) -> str:
    """Client-side one-way hash. Demonstrates that equality/change of a block can be
    detected without reading its content. `label` is synthetic, not a real prompt."""
    return hashlib.sha256(label.encode("utf-8")).hexdigest()


def input_cost(u: Usage) -> float:
    """Input-side request cost in units of one uncached input token."""
    return (u.input_tokens * UNCACHED
            + u.cache_creation_input_tokens * CACHE_WRITE_5M
            + u.cache_read_input_tokens * CACHE_READ)


# ----------------------------------------------------------------------------
# Synthetic metadata generators (these stand in for recorded real traces).
# ----------------------------------------------------------------------------
def make_history_resend(rng: random.Random, n_turns: int = 8,
                        system_tokens: int = 3000) -> list[RequestMeta]:
    """Stateless multi-turn loop with NO caching: every turn re-sends the whole
    transcript at full price. This is the B1 pattern."""
    reqs: list[RequestMeta] = []
    history: list[Block] = [Block("system", system_tokens, digest("system-preamble"))]
    for t in range(n_turns):
        u_tok = rng.randint(150, 400)
        user = Block("user", u_tok, digest(f"user-{t}"))
        prompt_blocks = list(history) + [user]
        prompt_tokens = sum(b.tokens for b in prompt_blocks)
        a_tok = rng.randint(200, 500)
        reqs.append(RequestMeta(
            session_id="hist", idx=t, model_id="model-x",
            tool_digest=digest("tools-none"),
            blocks=prompt_blocks,
            # No caching engaged: everything billed as uncached input.
            usage=Usage(input_tokens=prompt_tokens, output_tokens=a_tok),
        ))
        # The assistant reply becomes part of history for the next turn.
        history.append(user)
        history.append(Block("assistant", a_tok, digest(f"assistant-{t}")))
    return reqs


def make_silent_invalidator(rng: random.Random, n: int = 6,
                            system_tokens: int = 4000) -> list[RequestMeta]:
    """A leading system block of CONSTANT size whose digest changes every request
    (an injected timestamp/UUID), so the cache never reads. This is the A2 pattern."""
    reqs: list[RequestMeta] = []
    for i in range(n):
        # Same size every request, different content each time -> different digest.
        sys_block = Block("system", system_tokens, digest(f"system-with-timestamp-{i}"))
        q = Block("user", rng.randint(100, 300), digest(f"q-{i}"))
        prompt_tokens = sys_block.tokens + q.tokens
        reqs.append(RequestMeta(
            session_id="silent", idx=i, model_id="model-x",
            tool_digest=digest("tools-none"),
            blocks=[sys_block, q],
            usage=Usage(input_tokens=prompt_tokens,
                        cache_read_input_tokens=0, output_tokens=rng.randint(100, 300)),
        ))
    return reqs


def make_healthy(rng: random.Random, n_turns: int = 8,
                 system_tokens: int = 4000) -> list[RequestMeta]:
    """A well-structured session: a stable cached prefix, cache engaged from turn 1.
    The coach MUST stay silent here (the do-no-harm guard)."""
    reqs: list[RequestMeta] = []
    carried = 0
    sys_digest = digest("system-frozen")   # stable across the whole session
    history_tokens = system_tokens
    for t in range(n_turns):
        u_tok = rng.randint(150, 400)
        blocks = [Block("system", system_tokens, sys_digest),
                  Block("user", u_tok, digest(f"user-{t}"))]
        prompt_tokens = history_tokens + u_tok
        if t == 0:
            usage = Usage(input_tokens=u_tok, cache_creation_input_tokens=system_tokens)
        else:
            # Prior prefix read from cache; only the new turn is uncached/written.
            usage = Usage(input_tokens=u_tok, cache_read_input_tokens=carried)
        a_tok = rng.randint(200, 500)
        usage.output_tokens = a_tok
        reqs.append(RequestMeta(
            session_id="healthy", idx=t, model_id="model-x",
            tool_digest=digest("tools-frozen"), blocks=blocks, usage=usage))
        carried = prompt_tokens                 # everything so far is now cacheable
        history_tokens = prompt_tokens + a_tok  # reply joins history for next turn
    return reqs


# ----------------------------------------------------------------------------
# Detectors. Each reads ONLY RequestMeta (metadata + usage). No prompt text.
# ----------------------------------------------------------------------------
@dataclass
class Finding:
    rule: str
    detail: str
    observed_input_cost: float
    projected_input_cost: float | None   # None when the coach cannot price it exactly
    addressable_tokens: float
    upper_bound: bool                    # True when the number is an upper bound, not a projection


def detect_history_resend(reqs: list[RequestMeta], min_turns: int = 4) -> Finding | None:
    """B1: input tokens rise with turn count, cache reads stay ~0. Project the exact
    repriced cost a conversation-level breakpoint would unlock."""
    if len(reqs) < min_turns:
        return None
    reads = sum(r.usage.cache_read_input_tokens for r in reqs)
    inputs = [r.usage.input_tokens for r in reqs]
    rising = inputs[-1] > inputs[0] * 1.5
    if reads > 0 or not rising:
        return None

    observed = sum(input_cost(r.usage) for r in reqs)

    # Counterfactual: breakpoint on the last block each turn.
    #   turn 0 writes the whole prompt at 1.25x.
    #   turn t>0 reads the prior turn's prompt at 0.1x and writes the new delta at 1.25x.
    projected = 0.0
    prev_prompt = 0
    for t, r in enumerate(reqs):
        prompt = r.usage.input_tokens
        if t == 0:
            projected += prompt * CACHE_WRITE_5M
        else:
            carried = prev_prompt
            new = prompt - carried
            projected += carried * CACHE_READ + max(new, 0) * CACHE_WRITE_5M
        prev_prompt = prompt

    addressable = observed - projected
    return Finding(
        rule="B1 history-resend",
        detail=(f"{len(reqs)} turns, input tokens {inputs[0]} -> {inputs[-1]}, "
                f"cache reads observed = {reads}"),
        observed_input_cost=observed,
        projected_input_cost=projected,
        addressable_tokens=addressable,
        upper_bound=False,
    )


def detect_silent_invalidator(reqs: list[RequestMeta]) -> Finding | None:
    """A2: leading block, stable size, digest changes every request, cache reads = 0.
    Report an UPPER BOUND on addressable tokens (cannot price exactly without reading
    the volatile bytes)."""
    if len(reqs) < 3:
        return None
    lead = [r.blocks[0] for r in reqs if r.blocks]
    if len(lead) < 3:
        return None
    sizes = {b.tokens for b in lead}
    digs = {b.digest for b in lead}
    reads = sum(r.usage.cache_read_input_tokens for r in reqs)
    stable_size = len(sizes) == 1
    changing_digest = len(digs) == len(lead)     # a new digest every request
    if not (stable_size and changing_digest and reads == 0):
        return None

    lead_tokens = lead[0].tokens
    # Upper bound: if the whole leading block could be cached (i.e. the volatile part
    # were moved out), every request after the first would read it at 0.1x instead of 1.0x.
    n = len(reqs)
    observed_lead = lead_tokens * UNCACHED * n
    best_case_lead = lead_tokens * CACHE_WRITE_5M + lead_tokens * CACHE_READ * (n - 1)
    addressable = observed_lead - best_case_lead
    return Finding(
        rule="A2 silent-invalidator",
        detail=(f"block[0] size stable at {lead_tokens} tok across {n} requests, "
                f"digest changes every request, cache reads = 0"),
        observed_input_cost=sum(input_cost(r.usage) for r in reqs),
        projected_input_cost=None,
        addressable_tokens=addressable,
        upper_bound=True,
    )


def run_coach(reqs: list[RequestMeta]) -> list[Finding]:
    findings = []
    for det in (detect_history_resend, detect_silent_invalidator):
        f = det(reqs)
        if f is not None:
            findings.append(f)
    return findings


# ----------------------------------------------------------------------------
# Override-rate kill switch (README: The kill metric).
# ----------------------------------------------------------------------------
@dataclass
class RuleGovernor:
    min_samples: int = 8
    theta_kill: float = 0.5
    window: int = 20
    history: dict[str, list[str]] = field(default_factory=dict)  # rule -> outcomes
    killed: set[str] = field(default_factory=set)

    def record(self, rule: str, outcome: str) -> None:
        """outcome in {'accept', 'snooze', 'mute'}."""
        self.history.setdefault(rule, []).append(outcome)
        if self._override_rate(rule) is not None and self.is_active(rule):
            rate = self._override_rate(rule)
            surfaced = len(self.history[rule][-self.window:])
            if surfaced >= self.min_samples and rate >= self.theta_kill:
                self.killed.add(rule)

    def _override_rate(self, rule: str) -> float | None:
        outs = self.history.get(rule, [])[-self.window:]
        if not outs:
            return None
        overrides = sum(1 for o in outs if o in ("snooze", "mute"))
        return overrides / len(outs)

    def override_rate(self, rule: str) -> float:
        r = self._override_rate(rule)
        return 0.0 if r is None else r

    def is_active(self, rule: str) -> bool:
        return rule not in self.killed


# ----------------------------------------------------------------------------
# Reporting
# ----------------------------------------------------------------------------
def report_findings(title: str, reqs: list[RequestMeta]) -> None:
    print("=" * 74)
    print(title)
    print("=" * 74)
    total_obs = sum(input_cost(r.usage) for r in reqs)
    print(f"  requests: {len(reqs)}   observed input-side cost: {total_obs:,.0f} "
          f"(units of one uncached input token)")
    findings = run_coach(reqs)
    if not findings:
        print("  coach output: NO NUDGES. Trace looks efficient; nothing to suggest.")
        print()
        return
    for f in findings:
        print(f"  nudge [{f.rule}]")
        print(f"    signal: {f.detail}")
        if f.projected_input_cost is not None:
            pct = 100.0 * f.addressable_tokens / total_obs if total_obs else 0.0
            print(f"    observed cost   : {f.observed_input_cost:,.0f}")
            print(f"    projected cost  : {f.projected_input_cost:,.0f}  "
                  f"(exact counterfactual for this synthetic trace)")
            print(f"    addressable     : {f.addressable_tokens:,.0f} units "
                  f"({pct:.0f}% of this trace's input-side cost)")
        else:
            tag = "UPPER BOUND" if f.upper_bound else "projection"
            print(f"    addressable     : up to {f.addressable_tokens:,.0f} units "
                  f"[{tag}; coach cannot price exactly without reading the block]")
    print()


def report_kill_switch(rng: random.Random) -> None:
    print("=" * 74)
    print("OVERRIDE-RATE KILL SWITCH (synthetic user behaviour)")
    print("=" * 74)
    gov = RuleGovernor(min_samples=8, theta_kill=0.5, window=20)
    # Two rules surfaced 24 times each. The synthetic user overrides the noisy rule most
    # of the time and accepts the useful rule most of the time.
    accept_prob = {"noisy-rule": 0.20, "useful-rule": 0.85}
    kill_point = {}
    for step in range(24):
        for rule in ("noisy-rule", "useful-rule"):
            if not gov.is_active(rule):
                continue
            outcome = "accept" if rng.random() < accept_prob[rule] else \
                      ("mute" if rng.random() < 0.15 else "snooze")
            gov.record(rule, outcome)
            if rule in gov.killed and rule not in kill_point:
                kill_point[rule] = step + 1
    for rule in ("noisy-rule", "useful-rule"):
        status = "KILLED at surfacing " + str(kill_point[rule]) if rule in gov.killed \
                 else "active"
        print(f"  {rule:<12}  surfacings={len(gov.history[rule]):>2}  "
              f"override_rate={gov.override_rate(rule):.2f}  -> {status}")
    print("    (theta_kill = 0.50, min_samples = 8, window = 20. A rule the user rejects")
    print("     as often as they accept it is auto-disabled; a useful one survives.)")
    print()


def main() -> None:
    ap = argparse.ArgumentParser(description="TOP-3 metadata-only coach prototype")
    ap.add_argument("--seed", type=int, default=20260716)
    args = ap.parse_args()

    print()
    print("TOP-3 (Athena) prompting coach - metadata-only nudge prototype")
    print(f"SYNTHETIC metadata. seed={args.seed}. No real prompts, no real costs.")
    print("Costs are in units of one uncached input token (cache write 1.25x, read 0.1x).")
    print()

    rng = random.Random(args.seed)
    report_findings("SCENARIO 1: history resend (should fire B1 with an exact projection)",
                    make_history_resend(rng))
    report_findings("SCENARIO 2: silent cache invalidator (should fire A2, upper bound)",
                    make_silent_invalidator(rng))
    report_findings("SCENARIO 3: healthy trace (guard: coach MUST stay silent)",
                    make_healthy(rng))
    report_kill_switch(rng)

    print("Reading: in 1 and 2 the coach flags documented structural waste from metadata")
    print("alone and bounds the addressable cost (exactly for B1, as an upper bound for A2).")
    print("In 3 it stays silent on an efficient trace. The kill switch removes a noisy rule")
    print("without the user having to fight it. All numbers describe the synthetic traces")
    print("only; nothing here is a claim about real usage. See README.md for limits.")


if __name__ == "__main__":
    main()
