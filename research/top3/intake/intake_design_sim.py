"""
TOP-3 (Athena) MCQ intake: design-time power and analysis-pinning tool.

WHAT THIS IS
------------
A study-sizing and analysis-freezing tool for the evaluation protocol in README.md. It
does TWO things and claims nothing else:

1. Sizes the experiment under STATED ASSUMPTIONS. Because there is no pilot data, the
   real variance components are unknown, so a single required sample size does not exist.
   Instead we simulate the within-subject data-generating process under a GRID of assumed
   noise levels and the PRE-REGISTERED minimum detectable effect (MDE), and report the
   number of participants needed for 80% power in each case. Every variance number here is
   an ASSUMPTION we type in; every sample size is a consequence of those assumptions.

2. Pins the analysis. It runs the exact within-participant RANDOMISATION test the real
   study will use (numpy only, no scipy, distribution-free, deterministic given the seed),
   so the analysis code is frozen before any real data is collected. It also runs the
   REFUTATION NULL (true effect = 0) and confirms the test's false-positive rate matches
   alpha, i.e. the test does not manufacture an effect where there is none.

WHAT THIS IS NOT
----------------
This tells you NOTHING about whether the intake works. There is no real transcript, no
real user, and no measured effect anywhere in this file. The outcome values are drawn from
a Gaussian model we wrote down; they describe that synthetic model only. Passing here means
"the pinned analysis is calibrated and the study is sizeable under these assumptions",
not "the intake reduces wasted turns". See README.md for the design and its honest limits.

THE OUTCOME MODELLED
--------------------
Illustrative primary outcome: correction turns per task (H2 in README.md), where the
treatment is hypothesised to REDUCE the count, so the true effect beta is negative. The
data-generating process is a crossed within-subject model:

    y[p, task] = mu + u[p] + v[task] + beta * treat + eps

    u[p]    ~ N(0, sd_part^2)    between-participant offset (cancels in the paired contrast)
    v[task] ~ N(0, sd_task^2)    between-task offset (each task used once, so it does NOT
                                 cancel; it is noise in the within-participant contrast)
    eps     ~ N(0, sd_resid^2)   residual (session-to-session, incl. model nondeterminism)

The point of the within-subject design is that u[p] drops out of each participant's
C3-minus-C0 difference. The script demonstrates that by comparing the pinned within-
subject test against a naive between-subjects test on the SAME simulated data: the paired
test needs far fewer participants because it removes the between-participant offset.

PRE-REGISTERED CONSTANTS (decision thresholds, frozen before data; NOT measurements)
    MDE            = 1.0 correction turns per task (smallest reduction worth detecting)
    alpha          = 0.05, one-sided in the hypothesised direction
    target power   = 0.80

ASSUMED INPUTS (typed-in assumptions, varied over a grid; NOT measurements)
    sd_part, sd_task, sd_resid    (see GRID below)

Dependencies: numpy only. Deterministic given the seed.

Run:
    python intake_design_sim.py            # default grid + analysis-pin checks
    python intake_design_sim.py --seed 7   # different synthetic draw
"""

from __future__ import annotations

import argparse
import numpy as np


# --------------------------------------------------------------------------------------
# Pre-registered decision thresholds (frozen BEFORE data; these are commitments, not data)
# --------------------------------------------------------------------------------------
MDE = 1.0            # smallest reduction in correction turns per task worth detecting
ALPHA = 0.05         # one-sided significance level, hypothesised direction (treatment lowers)
TARGET_POWER = 0.80  # sample-size target


# --------------------------------------------------------------------------------------
# Data-generating process (a MODEL we wrote down, not reality)
# --------------------------------------------------------------------------------------
def simulate(rng, n_part, n_per_cond, beta, sd_part, sd_task, sd_resid):
    """Return outcome array y of shape (n_part, T) and a fixed condition layout.

    Each participant does T = 2 * n_per_cond tasks, half assigned to C0 (treat=0) and half
    to C3 (treat=1). The first n_per_cond columns are C3, the rest C0 (a fixed layout; the
    randomisation test below permutes labels, so the layout choice does not bias anything).
    """
    T = 2 * n_per_cond
    treat = np.zeros(T)
    treat[:n_per_cond] = 1.0  # first half are C3 (treatment)

    u = rng.normal(0.0, sd_part, size=(n_part, 1))      # participant offsets
    v = rng.normal(0.0, sd_task, size=(n_part, T))       # per-task offsets (each task once)
    eps = rng.normal(0.0, sd_resid, size=(n_part, T))    # residual noise
    y = u + v + beta * treat[None, :] + eps              # mu folds into u; irrelevant to contrasts
    return y, treat


# --------------------------------------------------------------------------------------
# The PINNED analysis: within-participant randomisation test (this is frozen before data)
# --------------------------------------------------------------------------------------
def _paired_stat(y, treat_mask):
    """Mean over participants of (mean C3 outcome - mean C0 outcome) within participant.

    y and treat_mask broadcast to shape (n_perm, n_part, T); treat_mask has exactly T/2
    ones along the last axis. Returns one statistic per leading (permutation) index, so many
    permutations evaluate in a single vectorised call.
    """
    n_per_cond = treat_mask.shape[-1] // 2
    s1 = (y * treat_mask).sum(axis=-1) / n_per_cond          # (n_perm, n_part) sum over C3 tasks
    s0 = (y * (1.0 - treat_mask)).sum(axis=-1) / n_per_cond  # (n_perm, n_part) over C0 tasks
    return (s1 - s0).mean(axis=-1)                            # (n_perm,) average the paired diffs


def within_randomisation_p(rng, y, treat, n_perm):
    """One-sided p-value for 'treatment lowers the outcome' via within-participant label
    permutation. Under H0 the condition label is exchangeable among each participant's
    tasks, so we permute labels within each participant independently.
    """
    n_part, T = y.shape
    y3 = y[None, :, :]                                     # (1, n_part, T), broadcasts over perms
    obs = _paired_stat(y3, treat[None, None, :])[0]        # observed statistic (scalar)

    # Permute the label vector independently within each participant, for each of n_perm draws.
    base = treat.copy()                                   # (T,) with T/2 ones
    keys = rng.random((n_perm, n_part, T))                # random keys per (perm, participant, task)
    order = np.argsort(keys, axis=-1)                     # a random permutation of columns per row
    perm_masks = base[order]                              # (n_perm, n_part, T) shuffled labels
    null = _paired_stat(y3, perm_masks)                   # (n_perm,) null statistics

    # Left tail: treatment is hypothesised to make the outcome smaller (obs negative).
    p = (1 + np.sum(null <= obs)) / (n_perm + 1)          # add-one for a valid permutation p
    return p, obs


# --------------------------------------------------------------------------------------
# A naive BETWEEN-subjects test on the SAME data, to show why pairing is worth it.
# Pools all C3 tasks vs all C0 tasks across participants, ignoring who did which.
# --------------------------------------------------------------------------------------
def between_randomisation_p(rng, y, treat, n_perm):
    flat_y = y.reshape(-1)
    n_part, T = y.shape
    flat_treat = np.tile(treat, n_part).astype(bool)
    n1 = flat_treat.sum()

    def stat(mask):
        return flat_y[mask].mean() - flat_y[~mask].mean()

    obs = stat(flat_treat)
    idx = np.arange(flat_y.size)
    null = np.empty(n_perm)
    for b in range(n_perm):
        pick = rng.permutation(idx)[:n1]
        m = np.zeros(flat_y.size, dtype=bool)
        m[pick] = True
        null[b] = stat(m)
    p = (1 + np.sum(null <= obs)) / (n_perm + 1)
    return p, obs


# --------------------------------------------------------------------------------------
# Monte-Carlo power: fraction of simulated studies in which the pinned test rejects H0.
# --------------------------------------------------------------------------------------
def power_at(rng, n_part, n_per_cond, beta, sd_part, sd_task, sd_resid,
             n_sims, n_perm, test="within"):
    rejects = 0
    for _ in range(n_sims):
        y, treat = simulate(rng, n_part, n_per_cond, beta, sd_part, sd_task, sd_resid)
        if test == "within":
            p, _ = within_randomisation_p(rng, y, treat, n_perm)
        else:
            p, _ = between_randomisation_p(rng, y, treat, n_perm)
        if p <= ALPHA:
            rejects += 1
    return rejects / n_sims


def required_participants(rng, n_per_cond, sd_part, sd_task, sd_resid,
                          candidate_P, n_sims, n_perm, test="within"):
    """Smallest participant count in candidate_P reaching TARGET_POWER at beta = -MDE."""
    curve = []
    answer = None
    for P in candidate_P:
        pw = power_at(rng, P, n_per_cond, -MDE, sd_part, sd_task, sd_resid,
                      n_sims, n_perm, test=test)
        curve.append((P, pw))
        if answer is None and pw >= TARGET_POWER:
            answer = P
            break  # smallest sufficient P found; no need to try larger
    return answer, curve


# --------------------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="TOP-3 MCQ intake design-time power tool")
    ap.add_argument("--seed", type=int, default=20260716)
    ap.add_argument("--sims", type=int, default=200, help="Monte-Carlo studies per cell")
    ap.add_argument("--perm", type=int, default=200, help="permutations per randomisation test")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)

    print("TOP-3 (Athena) MCQ intake - design-time power and analysis-pinning tool")
    print("=" * 78)
    print("NOT A RESULT. Every outcome value is drawn from a Gaussian model written down in")
    print("this file. This sizes the study under ASSUMPTIONS and freezes the analysis; it")
    print("says nothing about whether the real intake reduces wasted turns. See README.md.")
    print()
    print(f"Seed {args.seed} | Monte-Carlo studies/cell {args.sims} | permutations/test {args.perm}")
    print("Pre-registered thresholds (frozen before data, NOT measured):")
    print(f"    MDE          = {MDE} correction turns/task reduction")
    print(f"    alpha        = {ALPHA} (one-sided, treatment lowers the outcome)")
    print(f"    target power = {TARGET_POWER}")
    print()

    # Assumed variance components. THESE ARE TYPED-IN ASSUMPTIONS, VARIED OVER A GRID.
    sd_part = 2.0   # between-participant SD (cancels in the paired contrast)
    sd_task = 1.0   # between-task SD (does not cancel; noise in the contrast)
    resid_grid = [1.5, 2.5, 3.5]   # assumed residual SD (incl. model nondeterminism)
    tasks_per_cond_grid = [2, 4]   # tasks per condition per participant (design load knob)
    candidate_P = [10, 15, 20, 25, 30, 40, 50, 60, 80]

    print("ASSUMED inputs (NOT measured): between-participant SD = %.1f, between-task SD = %.1f"
          % (sd_part, sd_task))
    print("Design knob: tasks per condition per participant (more tasks/person -> fewer people)")
    print()

    print("-" * 78)
    print("1. REQUIRED PARTICIPANTS for 80% power, by assumed residual noise and task load")
    print("-" * 78)
    print("   (within-subject randomisation test, the pinned analysis)")
    print()
    header = "   residual SD |" + "".join(f"  tpc={t:<2d}" for t in tasks_per_cond_grid)
    print(header)
    for sd_resid in resid_grid:
        row = f"   {sd_resid:>10.1f} |"
        for tpc in tasks_per_cond_grid:
            ans, _curve = required_participants(
                rng, tpc, sd_part, sd_task, sd_resid, candidate_P, args.sims, args.perm)
            cell = f"{ans:>3d}" if ans is not None else f">{candidate_P[-1]}"
            row += f"  {cell:>6s}"
        print(row)
    print()
    print("   Read as: 'IF residual SD is X and each participant does Y tasks per condition,")
    print("   THEN about N participants give 80%% power to detect a %.1f-turn reduction.'" % MDE)
    print("   The real residual SD is unknown, which is exactly why this is a grid, not a")
    print("   single number. Stage 0 (README.md) exists to get a first read on that SD.")
    print()

    # Illustrate why the within-subject design is worth it: same data, naive between test.
    print("-" * 78)
    print("2. WHY WITHIN-SUBJECT: within vs between power on identical simulated data")
    print("-" * 78)
    sd_resid = 2.5
    tpc = 4
    P_demo = 30
    pw_within = power_at(rng, P_demo, tpc, -MDE, sd_part, sd_task, sd_resid,
                         args.sims, args.perm, test="within")
    pw_between = power_at(rng, P_demo, tpc, -MDE, sd_part, sd_task, sd_resid,
                         args.sims, min(args.perm, 120), test="between")
    print(f"   At {P_demo} participants, {tpc} tasks/condition, residual SD {sd_resid},")
    print(f"   between-participant SD {sd_part} (large on purpose):")
    print(f"       within-subject (paired) power  = {pw_within:.2f}")
    print(f"       between-subject (naive) power   = {pw_between:.2f}")
    print("   The paired test removes the between-participant offset, so it detects the same")
    print("   effect with far fewer people. That offset is why the design is within-subject.")
    print()

    # Refutation-null calibration: true effect zero -> false-positive rate must be ~ alpha.
    print("-" * 78)
    print("3. REFUTATION-NULL CALIBRATION: true effect = 0, false-positive rate must be ~ alpha")
    print("-" * 78)
    print("   This is the 'does the test manufacture an effect where there is none' check.")
    print("   In the protocol the clear-task stratum has (by construction) nothing to clarify,")
    print("   so a well-behaved test must reject at about alpha there, not more.")
    fp_sims = max(args.sims, 400)  # more sims for a stable false-positive estimate
    for sd_resid in [1.5, 2.5, 3.5]:
        fp = power_at(rng, 30, 4, 0.0, sd_part, sd_task, sd_resid,
                      fp_sims, args.perm, test="within")
        flag = "ok (~alpha)" if fp <= ALPHA + 0.03 else "HIGH - test miscalibrated"
        print(f"   residual SD {sd_resid}:  false-positive rate = {fp:.3f}   [{flag}]")
    print()
    print("   A false-positive rate near %.2f means the pinned test does not invent effects;" % ALPHA)
    print("   a rate well above it would invalidate the analysis before any real data is run.")
    print()

    print("=" * 78)
    print("Again: this file sizes the study and freezes the analysis under ASSUMPTIONS.")
    print("It contains no evidence about the intake. That evidence would come from Stages")
    print("1-2 in README.md, which have not been run.")


if __name__ == "__main__":
    main()
