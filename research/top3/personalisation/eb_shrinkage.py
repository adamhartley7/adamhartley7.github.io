"""
TOP-3 (Athena) personalisation prototype: empirical-Bayes / Buhlmann shrinkage
of a population cost forecast toward a user's own residuals.

WHAT THIS IS
------------
TOP-1 (Icarus) is meant to produce a *population* forecast of an AI task's cost:
a low / likely / high range, i.e. a set of quantiles. Averaged over everyone that
forecast can be well calibrated, yet still be systematically off-centre for any one
person whose true cost sits above or below the crowd.

TOP-3 (Athena) is the idea of personalising that forecast. This script prototypes
one concrete, boring, well-understood way to do it: Buhlmann credibility (a form of
empirical Bayes). We shrink the population forecast toward a correction estimated
from the user's own past residuals, with the amount of shrinkage growing as the user
accumulates observations.

Everything here runs on a SYNTHETIC dataset with known parameters. It is a proof of
*mechanism* under assumptions we control, not evidence about real AI cost data. See
README.md for the falsifiable hypothesis and the honest limits.

WHAT IT DOES
------------
1. Generates synthetic per-user AI task costs in log space:
      y_ui = g(size_ui) + theta_u + eps_ui
   where g() is a known population log-median map (what TOP-1 is assumed to provide),
   theta_u ~ N(0, tau^2) is a stable per-user offset, and eps_ui ~ N(0, sigma^2) is
   within-user task noise. Cost = exp(y).
2. Estimates sigma^2 (within-user) and tau^2 (between-user) from a TRAIN cohort with a
   standard one-way random-effects method-of-moments estimator (Buhlmann-Straub style).
   That gives the credibility constant k = sigma^2 / tau^2. Nothing about the test users
   is assumed known.
3. For each TEST user, walks their tasks in time order. Before task i it uses the i
   residuals seen so far to form a credibility-weighted personal offset and a posterior-
   predictive spread, then forecasts quantiles for task i. At i = 0 (cold start) the
   personalised forecast is identical to the population baseline by construction.
4. Scores population-only vs personalised with average pinball loss over a grid of
   quantiles (an approximation to CRPS) and with interval coverage, broken down by how
   much history the user has and by how far the user sits from the crowd.
5. Re-runs the whole thing with tau = 0 (users are identical). This is the falsification
   guard: if "personalisation" still showed a gain there, it would be fitting noise.

Dependencies: numpy only (no scipy). Deterministic given the seed.

Run:
    python eb_shrinkage.py            # main scenario + tau=0 ablation
    python eb_shrinkage.py --seed 7   # different synthetic draw
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import numpy as np


# ----------------------------------------------------------------------------
# Standard-normal inverse CDF (quantile function).
# Peter Acklam's rational approximation, abs error < ~1.15e-9 on (0,1).
# Source: https://web.archive.org/web/20151030215612/http://home.online.no/~pjacklam/notes/invnorm/
# Used instead of scipy.stats.norm.ppf so the script has no scipy dependency.
# ----------------------------------------------------------------------------
_A = (-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
      1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00)
_B = (-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
      6.680131188771972e+01, -1.328068155288572e+01)
_C = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
      -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00)
_D = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
      3.754408661907416e+00)
_P_LOW = 0.02425


def norm_ppf(p: float) -> float:
    """Inverse standard-normal CDF for a single probability in (0, 1)."""
    if not 0.0 < p < 1.0:
        raise ValueError("p must be in the open interval (0, 1)")
    if p < _P_LOW:
        q = np.sqrt(-2.0 * np.log(p))
        return (((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5]) / \
               ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0)
    if p > 1.0 - _P_LOW:
        q = np.sqrt(-2.0 * np.log(1.0 - p))
        return -(((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5]) / \
               ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0)
    q = p - 0.5
    r = q * q
    return (((((_A[0] * r + _A[1]) * r + _A[2]) * r + _A[3]) * r + _A[4]) * r + _A[5]) * q / \
           (((((_B[0] * r + _B[1]) * r + _B[2]) * r + _B[3]) * r + _B[4]) * r + 1.0)


# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
@dataclass
class Config:
    n_users: int = 400          # total synthetic users (half train, half test)
    n_tasks: int = 24           # tasks per user
    a: float = 0.6931           # g intercept  (log-median at size 0; exp(0.6931) ~ $2.0)
    b: float = 2.0              # g slope in size  (size in [0,1] -> up to +2.0 in log space)
    tau: float = 0.5            # between-user std in log space (the personal offset)
    sigma: float = 0.6          # within-user task-noise std in log space
    # quantile grid used for average pinball loss (a CRPS-like proper score):
    q_levels: tuple = (0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95)


def g(size: np.ndarray, cfg: Config) -> np.ndarray:
    """Known population log-median map (what TOP-1 is assumed to supply)."""
    return cfg.a + cfg.b * size


# ----------------------------------------------------------------------------
# Synthetic data
# ----------------------------------------------------------------------------
@dataclass
class Dataset:
    user: np.ndarray     # int user id per task
    size: np.ndarray     # feature in [0,1] per task
    y: np.ndarray        # observed log-cost per task
    theta: np.ndarray    # true per-user offset, indexed by user id (for diagnostics only)


def generate(cfg: Config, rng: np.random.Generator, tau_override: float | None = None) -> Dataset:
    tau = cfg.tau if tau_override is None else tau_override
    theta = rng.normal(0.0, tau, size=cfg.n_users) if tau > 0 else np.zeros(cfg.n_users)

    users, sizes, ys = [], [], []
    for u in range(cfg.n_users):
        size = rng.uniform(0.0, 1.0, size=cfg.n_tasks)
        eps = rng.normal(0.0, cfg.sigma, size=cfg.n_tasks)
        y = g(size, cfg) + theta[u] + eps
        users.append(np.full(cfg.n_tasks, u))
        sizes.append(size)
        ys.append(y)
    return Dataset(np.concatenate(users), np.concatenate(sizes),
                   np.concatenate(ys), theta)


# ----------------------------------------------------------------------------
# Empirical-Bayes variance estimation on the TRAIN cohort.
# One-way random-effects method of moments (Buhlmann-Straub style, unbalanced-safe).
# ----------------------------------------------------------------------------
def estimate_variances(residuals_by_user: list[np.ndarray]) -> tuple[float, float]:
    """Return (sigma2_hat, tau2_hat) from a list of per-user residual arrays."""
    groups = [r for r in residuals_by_user if r.size >= 1]
    U = len(groups)
    n = np.array([r.size for r in groups], dtype=float)
    N = float(n.sum())

    # Pooled within-user variance (needs users with n>=2).
    ss_within = sum(float(((r - r.mean()) ** 2).sum()) for r in groups if r.size >= 2)
    df_within = float(sum((r.size - 1) for r in groups if r.size >= 2))
    sigma2 = ss_within / df_within if df_within > 0 else 0.0

    # Between-user component via ANOVA method of moments.
    grand = float(np.concatenate(groups).mean())
    means = np.array([r.mean() for r in groups])
    ss_between = float((n * (means - grand) ** 2).sum())
    denom = N - (n ** 2).sum() / N          # effective "n0 * (U-1)"
    if denom > 0:
        tau2 = (ss_between - (U - 1) * sigma2) / denom
    else:
        tau2 = 0.0
    tau2 = max(tau2, 0.0)                    # variance components are non-negative
    return sigma2, tau2


# ----------------------------------------------------------------------------
# Scoring
# ----------------------------------------------------------------------------
def pinball(actual: float, forecast: float, q: float) -> float:
    """Pinball (quantile) loss for quantile level q. Lower is better."""
    d = actual - forecast
    return q * d if d >= 0 else (q - 1.0) * d


# bucket a history size n into a human-readable label + sort key
def bucket(n: int) -> tuple[int, str]:
    if n <= 3:
        return n, f"n={n}"
    if n <= 5:
        return 4, "n=4-5"
    if n <= 8:
        return 6, "n=6-8"
    if n <= 12:
        return 9, "n=9-12"
    return 13, "n=13-23"


@dataclass
class Accum:
    pin_base: float = 0.0
    pin_pers: float = 0.0
    count: int = 0            # number of (task) forecasts
    cover_base: int = 0       # times actual fell inside the 80% interval
    cover_pers: int = 0
    interval_count: int = 0


def evaluate(cfg: Config, rng: np.random.Generator, tau_override: float | None = None):
    ds = generate(cfg, rng, tau_override=tau_override)

    # Precompute z for each quantile level, and the 80% interval bounds.
    zq = {q: norm_ppf(q) for q in cfg.q_levels}
    z10, z90 = norm_ppf(0.10), norm_ppf(0.90)

    # Split users into train (variance estimation) and test (evaluation).
    all_users = np.arange(cfg.n_users)
    train_users = all_users[all_users % 2 == 0]
    test_users = all_users[all_users % 2 == 1]

    resid = ds.y - g(ds.size, cfg)          # observed residual vs population median

    # --- Empirical Bayes on train cohort ---
    train_res = [resid[ds.user == u] for u in train_users]
    sigma2, tau2 = estimate_variances(train_res)
    k = (sigma2 / tau2) if tau2 > 1e-12 else float("inf")   # credibility constant
    base_var = sigma2 + tau2                                # population marginal spread

    # --- Walk each test user's tasks in order (expanding history) ---
    overall = Accum()
    by_bucket: dict[int, Accum] = {}
    # per-user warm coverage, stratified later by true offset tercile
    warm_records = []   # (theta_u, hit_base, hit_pers) for tasks with n>=8

    for u in test_users:
        idx = np.where(ds.user == u)[0]
        r_u = resid[idx]
        size_u = ds.size[idx]
        y_u = ds.y[idx]
        gm_u = g(size_u, cfg)
        theta_u = ds.theta[u]

        run_sum = 0.0
        for i in range(idx.size):
            n = i                                   # residuals available before task i
            r_bar = run_sum / n if n > 0 else 0.0
            Z = n / (n + k) if np.isfinite(k) else 0.0
            shift = Z * r_bar
            pred_var = sigma2 + tau2 * (1.0 - Z)    # posterior-predictive spread

            actual = float(np.exp(y_u[i]))
            sd_base = np.sqrt(base_var)
            sd_pers = np.sqrt(pred_var)
            gmi = gm_u[i]

            # average pinball over the quantile grid, in cost (dollar) space
            pb_base = pb_pers = 0.0
            for q in cfg.q_levels:
                f_base = float(np.exp(gmi + sd_base * zq[q]))
                f_pers = float(np.exp(gmi + shift + sd_pers * zq[q]))
                pb_base += pinball(actual, f_base, q)
                pb_pers += pinball(actual, f_pers, q)
            pb_base /= len(cfg.q_levels)
            pb_pers /= len(cfg.q_levels)

            # 80% interval coverage
            lo_b = float(np.exp(gmi + sd_base * z10)); hi_b = float(np.exp(gmi + sd_base * z90))
            lo_p = float(np.exp(gmi + shift + sd_pers * z10)); hi_p = float(np.exp(gmi + shift + sd_pers * z90))
            hit_b = int(lo_b <= actual <= hi_b)
            hit_p = int(lo_p <= actual <= hi_p)

            overall.pin_base += pb_base; overall.pin_pers += pb_pers
            overall.count += 1
            overall.cover_base += hit_b; overall.cover_pers += hit_p
            overall.interval_count += 1

            key, _ = bucket(n)
            acc = by_bucket.setdefault(key, Accum())
            acc.pin_base += pb_base; acc.pin_pers += pb_pers; acc.count += 1
            acc.cover_base += hit_b; acc.cover_pers += hit_p; acc.interval_count += 1

            if n >= 8:
                warm_records.append((theta_u, hit_b, hit_p))

            run_sum += r_u[i]                       # reveal task i's residual for next step

    return {
        "sigma2": sigma2, "tau2": tau2, "k": k,
        "overall": overall, "by_bucket": by_bucket,
        "warm_records": warm_records,
        "true_sigma2": (cfg.sigma ** 2),
        "true_tau2": ((cfg.tau if tau_override is None else tau_override) ** 2),
    }


# ----------------------------------------------------------------------------
# Reporting
# ----------------------------------------------------------------------------
def pct(base: float, pers: float) -> str:
    if base == 0:
        return "  n/a"
    return f"{100.0 * (pers - base) / base:+6.1f}%"


def report(title: str, res: dict, cfg: Config) -> None:
    print("=" * 74)
    print(title)
    print("=" * 74)
    print(f"  true within-user  sigma^2 = {res['true_sigma2']:.4f}   "
          f"EB estimate = {res['sigma2']:.4f}")
    print(f"  true between-user tau^2   = {res['true_tau2']:.4f}   "
          f"EB estimate = {res['tau2']:.4f}")
    kstr = "inf" if not np.isfinite(res["k"]) else f"{res['k']:.3f}"
    print(f"  credibility constant k = sigma^2/tau^2 = {kstr}"
          "   (Z = n/(n+k); n tasks -> weight on the user)")
    print()

    ov = res["overall"]
    print(f"  Average pinball loss over {ov.count} test forecasts "
          f"(cost/dollar units, lower is better):")
    print(f"    population-only : {ov.pin_base / ov.count:.4f}")
    print(f"    personalised    : {ov.pin_pers / ov.count:.4f}   "
          f"({pct(ov.pin_base, ov.pin_pers)} vs population)")
    print(f"  80% interval coverage (target 0.80):")
    print(f"    population-only : {ov.cover_base / ov.interval_count:.3f}")
    print(f"    personalised    : {ov.cover_pers / ov.interval_count:.3f}")
    print()

    print("  Learning curve (pinball loss vs how many past tasks the user has):")
    print("    history        n_fc   pop-only   personal   change   cover_pop cover_pers")
    labels = {0: "n=0", 1: "n=1", 2: "n=2", 3: "n=3", 4: "n=4-5",
              6: "n=6-8", 9: "n=9-12", 13: "n=13-23"}
    for key in sorted(res["by_bucket"]):
        a = res["by_bucket"][key]
        print(f"    {labels[key]:<12} {a.count:>6}   "
              f"{a.pin_base / a.count:8.4f}   {a.pin_pers / a.count:8.4f}   "
              f"{pct(a.pin_base, a.pin_pers)}   "
              f"{a.cover_base / a.interval_count:8.3f}  {a.cover_pers / a.interval_count:8.3f}")
    print()

    # Conditional calibration: coverage by how far the user sits from the crowd.
    warm = res["warm_records"]
    if warm:
        thetas = np.array([w[0] for w in warm])
        hb = np.array([w[1] for w in warm])
        hp = np.array([w[2] for w in warm])
        lo, hi = np.quantile(thetas, [1 / 3, 2 / 3])
        strata = [("below crowd  (low offset)", thetas <= lo),
                  ("near crowd   (mid offset)", (thetas > lo) & (thetas < hi)),
                  ("above crowd  (high offset)", thetas >= hi)]
        print("  Per-user 80% coverage for WARM users (n>=8), by true offset tercile:")
        print("    stratum                        n_fc   cover_pop  cover_pers")
        for name, mask in strata:
            if mask.sum() == 0:
                continue
            print(f"    {name:<28} {int(mask.sum()):>6}   "
                  f"{hb[mask].mean():9.3f}  {hp[mask].mean():10.3f}")
        print("    (population-only is calibrated on average but drifts off-target in the")
        print("     tails; personalisation restores per-user coverage. This is the point.)")
    print()


def main() -> None:
    ap = argparse.ArgumentParser(description="TOP-3 empirical-Bayes shrinkage prototype")
    ap.add_argument("--seed", type=int, default=20260716)
    args = ap.parse_args()

    cfg = Config()
    print()
    print("TOP-3 (Athena) personalisation prototype - empirical-Bayes / Buhlmann shrinkage")
    print(f"SYNTHETIC data. seed={args.seed}. numpy {np.__version__}. Not real AI cost data.")
    print(f"Users={cfg.n_users} (half train / half test), tasks/user={cfg.n_tasks}, "
          f"quantile grid={cfg.q_levels}")
    print()

    rng = np.random.default_rng(args.seed)
    res_main = evaluate(cfg, rng)
    report("SCENARIO A: users differ (true tau = %.2f). Personalisation should help." % cfg.tau,
           res_main, cfg)

    rng2 = np.random.default_rng(args.seed + 1)
    res_ablate = evaluate(cfg, rng2, tau_override=0.0)
    report("SCENARIO B (falsification guard): users identical (true tau = 0). "
           "Personalisation should NOT help.", res_ablate, cfg)

    print("Reading: in A, personalisation should cut pinball loss as history grows while")
    print("keeping coverage near 0.80 and fixing the tail miscoverage of the population")
    print("forecast. In B, EB should estimate tau^2 ~ 0, hold Z ~ 0, and show ~no change.")
    print("If B showed a gain, the method would be fitting noise. See README.md for limits.")


if __name__ == "__main__":
    main()
