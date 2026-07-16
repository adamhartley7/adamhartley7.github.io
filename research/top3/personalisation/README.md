# TOP-3 (Athena) personalisation prototype: empirical-Bayes shrinkage

Status: research prototype on a **synthetic** dataset. Nothing here is shipped,
benchmarked on real data, or proven. This is a proof of *mechanism*, not a result
about AI cost.

## The idea in one paragraph

TOP-1 (Icarus) is meant to give a **population** forecast of an AI task's cost: a
low / likely / high range, which is just a set of quantiles. A population forecast
can be well calibrated *on average* and still be systematically off-centre for one
particular person whose real costs run above or below the crowd. TOP-3 (Athena) is
the idea of personalising the forecast. This prototype does it the boring, well
understood way: **Buhlmann credibility**, a form of empirical Bayes. We shrink the
population forecast toward a correction learned from the user's own past residuals
(observed cost minus the population forecast), giving the personal correction more
weight as the user accumulates tasks.

## The estimator

Work in log-cost space, where a per-user effect is a location shift.

- Population log-median map `g(features)` comes from TOP-1 (here: a known synthetic map).
- A user's residual on a task is `r = observed_log_cost - g(features)`.
- Prior over the user's true offset: `theta ~ N(0, tau^2)` (between-user spread).
- Task noise: `eps ~ N(0, sigma^2)` (within-user spread).

After the user has `n` tasks with mean residual `r_bar`, the credibility weight and
posterior-predictive spread are

```
k  = sigma^2 / tau^2                 # credibility constant
Z  = n / (n + k)                     # weight on the user's own data, in [0,1)
shift     = Z * r_bar                # personalised location correction
pred_var  = sigma^2 + tau^2 * (1 - Z)   # posterior-predictive variance
```

Personalised quantile `q`: `exp( g(features) + shift + sqrt(pred_var) * z_q )`.

Two properties make this safe rather than clever:

- **Cold start is free.** At `n = 0`, `Z = 0` and `pred_var = sigma^2 + tau^2`, so the
  personalised forecast is *identical* to the population baseline. It cannot do harm
  before it has evidence.
- **It converges.** As `n` grows, `Z -> 1`, the location moves to the user's true
  offset and the spread tightens from the population marginal toward the within-user
  `sigma^2`.

`sigma^2` and `tau^2` are **not assumed known**. They are estimated by empirical Bayes
from a training cohort with a standard one-way random-effects method-of-moments
estimator (Buhlmann-Straub style). See `eb_shrinkage.py`.

## Falsifiable hypothesis

> On data where users have a stable personal cost offset, shrinking the population
> quantile forecast toward each user's own residuals (Buhlmann credibility with
> empirical-Bayes-estimated variances) produces **lower average pinball loss** and
> **better per-user interval coverage** than a population-only forecast, with the gain
> growing as the user accumulates tasks and with **no harm at cold start**.
>
> Guard: if users have **no** real offset (`tau = 0`), the method must show
> essentially **no** change. A "gain" there would mean it is fitting noise, and the
> hypothesis would be falsified as stated.

Pinball loss is the standard proper scoring rule for quantile forecasts; averaged over
a grid of quantile levels it approximates CRPS. Coverage checks that an X% interval
actually contains X% of outcomes.

## What the synthetic run shows

Run: `python eb_shrinkage.py` (numpy only, deterministic). Full captured output is in
`results_synthetic.txt`. Setup: 400 synthetic users (200 train / 200 test), 24 tasks
each, true `sigma^2 = 0.36`, `tau^2 = 0.25`, seed `20260716`. These figures are from
that run, on synthetic data with a data-generating process that matches the estimator's
assumptions. **They say nothing about real users.**

**Scenario A (users differ, true `tau = 0.5`):**

- Empirical Bayes recovers the variances from the training cohort: `sigma^2` 0.354
  (true 0.36), `tau^2` 0.231 (true 0.25).
- Average pinball loss over 4800 test forecasts: population-only 1.4378, personalised
  1.1760, a **-18.2%** change on this run. Across seeds 1/7/42 the change ranged about
  -14% to -16%, so the direction is stable but the exact figure is not.
- 80% interval coverage stays on target: 0.783 population-only, 0.801 personalised.
- Learning curve: the change is 0.0% at cold start (`n = 0`, identical by construction)
  and grows to roughly -20% once the user has 6+ tasks.
- Per-user coverage tells the real story. For "warm" users (8+ tasks) split by true
  offset, the population interval under-covers users below the crowd (0.693) and
  over-covers users near the crowd (0.878); personalisation pulls every stratum back
  to about 0.80. That per-user miscalibration, invisible in the average, is the thing
  personalisation is for.

**Scenario B (falsification guard, true `tau = 0`):**

- Empirical Bayes estimates `tau^2` at 0.003 (near zero), so `k` is large, `Z` stays
  near 0, and the personalised forecast tracks the baseline.
- Average pinball loss change: **+0.0%**. Coverage unchanged (~0.80 both). The guard
  passes: no spurious gain when there is nothing to personalise.

So on synthetic data the mechanism behaves as the theory says it should. That is the
most this run can claim.

## Honest limits

- **Synthetic, and self-favouring by construction.** The data-generating process is
  exactly the model the estimator assumes (Gaussian, additive-in-log, stationary
  offset). Passing here rules *out* the possibility that the estimator is wrong on its
  own terms. It provides **zero** evidence that real AI cost residuals are Gaussian,
  additive in log space, or stationary. They are probably none of those.
- **Cold start.** By design the method gives nothing until a user has several tasks.
  `Z` only reaches ~0.85 around 8+ tasks at the `k` seen here. New users get the
  population forecast, no better.
- **Single-user corpus is the real blocker.** Empirical Bayes needs a *cohort* of
  users, each with several tasks, to estimate `tau^2` (the between-user spread) at all.
  Our only real pilot data is one founder's Claude Code history, dominated by one
  repeated task (see the honesty note on the main site). With one user you cannot
  separate `tau^2` from `sigma^2`, so this estimator cannot even be fit on real data
  yet, let alone validated.
- **Assumes a calibrated population forecast to shrink toward.** This prototype hands
  the estimator a correct `g()`. TOP-1's real early estimate is not calibrated yet
  (the site notes a typical overestimate of about 3.3x on out-of-distribution
  sessions). Residuals against a biased population forecast would carry that bias into
  the personal correction. Personalisation is a layer on top of a working base forecast,
  not a substitute for one.
- **Stationarity.** A stable per-user offset is a strong assumption. Real users switch
  projects, tools, and model tiers; a shift that drifts would need a discounted or
  state-space version of this estimator, not the flat mean used here.
- **Only the location is personalised.** The spread is shrunk analytically but the
  shape (log-normal) is fixed. Real cost distributions are likely heavier-tailed and
  more skewed.

## Nothing here is proven on real data

This is a runnable sketch of one plausible mechanism for TOP-3, with its assumptions
and failure modes written down. The next honest step is **not** a bigger synthetic run;
it is getting a multi-user corpus so `tau^2` can be estimated at all, and checking
whether real residuals look anything like the model before trusting any shrinkage.

## Files

- `eb_shrinkage.py` - the runnable prototype (numpy only, no scipy). `--seed` to vary
  the draw.
- `results_synthetic.txt` - captured stdout from the default-seed run.
