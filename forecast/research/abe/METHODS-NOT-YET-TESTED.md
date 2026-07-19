# TOP-1: ABE methods not yet tested

**Thirty-second read:** Try training-only, robust-scaled Manhattan retrieval first. It is the cheapest clean test of the open similarity problem, it directly addresses the outlier-scaling weakness identified in the ABE literature, and it changes only which analogies are selected. Test kNN conformalized quantile bands second because they target width directly. Nothing here is a validation result. Tonight's only task-level corpus has 849 eligible rows. The corrected screen analyzed only the first 719, which contain just 12 unique normalized prompt excerpts, with one excerpt appearing 706 times. The chronological fit window has no robustly active prompt-vector dimensions. Colin's user-labelled export and the other small export are aggregate-only, so neither can support an ABE backtest. The old 130-row holdout is compromised because a discarded pre-fix diagnostic inspected its prompt identities. Its outcomes were not scored by the corrected harness, but a fresh future holdout is required.

## Decision

The single method I would try first is **robust-scaled Manhattan retrieval with fixed `k = 3` and matched fallback frequency**.

Why:

1. Similarity is the unresolved part of TOP's retrieval gain. The supplied attribution says recency accounts for 57.9% of that gain.
2. It is a clean, low-effort ablation. Keep the point estimator, empirical-Bayes blend, calibration, exact-repeat path, recency fallback, and output format fixed.
3. Shepperd's retrospective identifies a concrete defect in standardized Euclidean distance: one outlier changes the standard deviation and compresses every other distance on that feature. Robust scale estimates remove that failure mode. [Shepperd 2025](https://arxiv.org/abs/2501.14582)
4. The ABE evidence for sophisticated similarity and weighting schemes is not reliable enough to justify starting with genetic search, fuzzy logic, or a learned ensemble.

This is a research priority, not a claim that Manhattan will narrow TOP's band. The ABE papers measured point error, not calibrated P90/P10 width. Robust median and MAD scaling is a TOP-specific synthesis motivated by the literature, not a replicated ABE result.

## What is already tested, and therefore excluded

The research branch already contains or has tested:

- exact normalized-prompt repeats;
- fixed `k = 3` word 3-gram Jaccard retrieval;
- a Jaccard similarity floor with recency fallback;
- a five-day recency-weighted global median;
- log-cost neighbor medians and empirical-Bayes blending;
- weighted similarity using Jaccard, prompt length, project, session position, and recency;
- neighborhood dispersion or stability gating;
- minimum-history abstention;
- a project-wide residual candidate;
- archetype-local recency; and
- a nested global conformal width scale.

The supplied overnight benchmark says coverage was 89%, median P90/P10 width was 69x against a 10x target, feature weighting reached 28x width but worsened the primary metric, neighborhood stability worsened performance, and 57.9% of retrieval gain was attributable to recency. I did not find a committed evaluator or result artifact that independently reproduces those four figures. They must remain labelled **user-supplied overnight results**.

## What the literature actually supports

### Similarity measures

The original formal ABE implementation used equally weighted, standardized Euclidean distance over project features, then pooled the nearest one to three projects. It evaluated point predictions on nine datasets containing 275 projects. [Shepperd and Schofield 1997](https://doi.org/10.1109/32.637387)

The field did not converge on one universally best similarity measure:

- Idri, Amazal, and Abran mapped 65 ABE studies published through 2012. Euclidean distance dominated practice. Fuzzy logic, grey relational analysis, genetic algorithms, and feature or case selection appeared often, but the reported evaluations were heterogeneous and overwhelmingly used point metrics such as MMRE, MdMRE, and Pred(25). [Idri et al. 2015](https://doi.org/10.1016/j.infsof.2014.07.013)
- The verified abstract of a six-measure comparison across 12 industrial datasets and 952 cases says Euclidean and Manhattan generally produced accurate point estimates. The full tables and the other measures were not available for verification, and the study did not evaluate prediction intervals. [Phannachitta 2017](https://doi.org/10.1109/SKIMA.2017.8294126)
- Ranked voting avoids combining feature magnitudes. Each feature ranks candidate projects, then Borda, Copeland, or Maximin aggregates those ranks. The original study used nine datasets and leave-one-out evaluation, reported promising point performance, and required no standardization. This has not become a replicated winner. [Azzeh and Alseid 2013](https://doi.org/10.1049/iet-sen.2012.0119)
- Feature subset selection matters. Equal weights are often suboptimal, but no particular global weighting algorithm consistently wins. Search-heavy results are especially exposed to tuning and dataset-selection bias. [Shepperd 2025](https://arxiv.org/abs/2501.14582), [Li, Xie, and Goh 2009](https://doi.org/10.1016/j.jss.2008.06.001)
- There is no universal `k`. Comparative work reports substantial variation across datasets. A dynamic `k` should not be treated as inherently better. [Chinthanet et al. 2016](https://doi.org/10.1145/2851613.2851974)

The practical conclusion is modest: test simple metrics, scale features robustly, freeze a small candidate set, and choose only on a chronological development window. Do not infer a winning metric from the literature.

### Findings that are relatively solid

These are the conclusions I would rely on:

1. **Feature representation and feature selection matter.** Using every available field with equal weight is generally a poor default. This conclusion appears across the review and retrospective literature.
2. **Standard-deviation scaling is outlier-sensitive.** This is a mathematical property, not a contestable benchmark result. One extreme observation can compress the rest of a feature.
3. **Simple adaptation deserves priority over complex adaptation.** A later comparison of eight adaptation methods, four feature selectors, 12 datasets, and 951 projects found simple linear approaches more stable than genetic-algorithm and neural-network alternatives on point metrics. [Phannachitta et al. 2017](https://doi.org/10.1007/s10664-016-9434-8)
4. **ABE is competitive, not universally superior.** Reviews comparing analogy with regression are mixed. [Mair and Shepperd 2005](https://doi.org/10.1109/ISESE.2005.1541858), [Shepperd 2025](https://arxiv.org/abs/2501.14582)
5. **Evaluation must use a meaningful baseline and effect sizes.** Standardised Accuracy was proposed because common relative-error measures can give unsafe rankings and because beating random guessing is a necessary sanity check. [Shepperd and MacDonell 2012](https://doi.org/10.1016/j.infsof.2011.12.008)

### Findings that are contested or do not transfer

- **TEAK and neighborhood stability:** the paper reported improvement on ten datasets by pruning unstable regions, but TOP's own test worsened. Do not recommend it again. [Kocaguneli et al. 2012](https://doi.org/10.1109/TSE.2011.27)
- **A universally optimal feature-weighting method:** unsupported. Positive papers use different datasets, objectives, and search budgets. TOP's own weighting result is mixed.
- **Genetic, neural, fuzzy, grey-relational, or stacking methods as the next move:** some papers claim point-error gains, but replication is thin and configuration freedom is high.
- **Blind dynamic `k`:** no stable winner exists across datasets.
- **Raw bootstrap percentiles of ABE estimates as a production prediction interval:** those percentiles mainly describe estimator uncertainty. They can omit the irreducible variation of a new run and look falsely narrow. A later software-effort paper also identified an invalid confidence-interval versus prediction-interval comparison in the original analysis. [Angelis and Stamelos 2000](https://doi.org/10.1023/A:1009897800559), [Jørgensen and Sjøberg 2003](https://doi.org/10.1016/S0950-5849(02)00188-X)

## Interval width, the part most ABE papers did not study

Most ABE research optimizes a point estimate. It does not establish that an improved point metric produces a narrower calibrated interval.

There are four useful exceptions or adjacent results:

1. **Empirical software-effort residual intervals.** Jørgensen and Sjøberg separate similarity for the point estimate from similarity in expected uncertainty. They select earlier projects with similar uncertainty, take empirical signed-error percentiles, and form an asymmetric interval. On 145 tasks, their empirical 60% interval achieved 58% hit rate with median relative width 0.30, and their empirical 90% interval achieved 85% with width 0.82. A 15-task experiment contained only five regression test tasks, so its 80% hit and width comparison is illustrative, not strong replication. [Primary PDF](https://web-backend.simula.no/sites/default/files/publications/SE.4.Joergensen.2003.b.pdf)
2. **Normalized kNN conformal prediction.** Papadopoulos, Vovk, and Gammerman scale residual nonconformity by neighbor distance, neighbor-label dispersion, or both. On six general regression datasets, their locally normalized regions were usually tighter while empirical error stayed near the requested level. This was not software-effort data. TOP should test only the donor-distance component because neighbor-label dispersion overlaps the failed stability experiment. [Papadopoulos et al. 2011](https://doi.org/10.1613/jair.3198)
3. **Conformalized Quantile Regression, CQR.** CQR fits lower and upper conditional quantiles, then conformalizes them with held-out residuals. It was shorter than its leading comparators on ten of 11 general regression datasets at similar coverage. This is strong width-specific evidence, but not ABE evidence. [Romano, Patterson, and Candes 2019](https://arxiv.org/abs/1905.03222)
4. **Software-effort conformal intervals.** Ridge-regression conformal prediction on three traditional software-effort datasets measured both miss rate and relative width near nominal coverage. It supports conformal evaluation in this domain, but it used random repeated cross-validation and a matrix-based model, not chronological ABE. [Papadopoulos, Papatheocharous, and Andreou 2009](https://www.researchgate.net/publication/220827776_Reliable_Confidence_Intervals_for_Software_Effort_Estimation)

The rule for TOP is simple: compare width only at matched coverage, report upper-tail and lower-tail misses separately, and reject any narrower result obtained by spending the error budget on expensive overruns.

## Ranked methods not yet tested

The ranking is my inference of expected band-width reduction divided by implementation effort. The cited papers did not evaluate TOP's 69x failure.

| Rank | Candidate | Expected width benefit | Effort | Evidence fit |
|---:|---|---|---|---|
| 1 | Robust-scaled Manhattan retrieval | Medium to high | 0.5 to 1 day | ABE point evidence, width transfer unverified |
| 2 | kNN empirical-quantile CQR | High | 1 to 2 days | Strong general width evidence, not ABE |
| 3 | Local asymmetric residual intervals | Medium | 0.5 to 1 day | Direct software-effort width evidence, limited replication |
| 4 | Borda ranked-voting retrieval | Medium | 1 day | ABE point evidence, no width evidence |
| 5 | Recency-weighted conformal calibration | Medium | 0.5 day | Strong drift theory, no TOP result |
| 6 | Donor-distance-normalized conformal | Medium | 1 day | kNN width evidence, not software effort |
| 7 | Linear size adaptation | Low to medium | 0.5 day | Replicated ABE point evidence, transfer uncertain |
| 8 | Analogy-X signal gate | Indirect | 1 to 2 days | ABE suitability test, limited original evidence |
| 9 | Bai-style token-component model | High long-term | Several days plus new data | Direct agent-token evidence, no interval result |
| 10 | Shortest conditional interquantile interval | Medium to high | 2 days | 2026 general width evidence, small-data risk |

### 1. Robust-scaled Manhattan retrieval

**Plain English:** turn each prompt into a small pre-run numeric vector, scale each dimension by its typical variation, then choose donors with the smallest sum of absolute scaled differences.

**Why it may narrow width:** an outlier cannot inflate a MAD in the same way it inflates a standard deviation. Unrelated high-cost donors should enter fewer neighborhoods, reducing calibrated residuals and donor heterogeneity.

**Dependency-free browser JavaScript:**

1. Normalize prompt text with NFKC, lower case, and collapsed whitespace.
2. Hash word unigrams into 48 signed bins with 32-bit FNV-1a, L2-normalize the bins, and append `log1p(wordCount)`, unique-word ratio, and digit fraction. These exact dimensions are a TOP implementation proposal, not an ABE paper result.
3. On the fit window only, compute each dimension's median and `scale = 1.4826 * MAD`. If MAD is zero, use `IQR / 1.349`. If both are zero, ignore the dimension.
4. Compute `distance = mean(abs(xq[d] - xi[d]) / scale[d])` over active dimensions.
5. Set `similarity = 1 / (1 + distance)`, rank ascending distance, and retain fixed `k = 3`.
6. Preserve exact repeats. Break equal distances by most recent donor.
7. Match the baseline's analogy-acceptance rate on calibration by choosing the distance threshold from similarities alone, without looking at costs. This prevents a changed fallback rate from masquerading as a better metric.

**Effort and evaluation:** 0.5 to 1 day. Treat robust-vector Manhattan versus trigram Jaccard as a representation-plus-metric package, not a one-variable metric test. Keep the same tasks, point estimator, empirical-Bayes blend, band construction, fallback count, and calibration. Compare Manhattan with Euclidean on the same robust-scaled vector to isolate the distance metric. If the package advances, separately ablate the vector representation and robust scaling. Compare paired development-task coverage, median `P90/P10`, median absolute log error, and log interval score, then freeze before a fresh future holdout.

### 2. kNN empirical-quantile CQR

**Plain English:** let nearby historical costs propose a narrow or wide raw interval for each task, then use held-out residuals to correct that interval to the requested coverage.

**Why it may narrow width:** a single global uncertainty multiplier pays for the hardest cases everywhere. Local quantiles can assign less width to dense, predictable neighborhoods and more to difficult ones.

**Dependency-free browser JavaScript:**

1. Keep the baseline Jaccard `k = 3` point `p50` fixed.
2. Retrieve a separately frozen `kq`, starting with `20`, using only earlier fit records and the frozen similarity metric.
3. In log-cost space, let `qlo(x)` and `qhi(x)` be the empirical 10th and 90th percentiles of those donor costs.
4. For calibration row `i`, compute `s_i = max(qlo_i - y_i, y_i - qhi_i)`.
5. Sort scores and choose rank `ceil((nCal + 1) * 0.80)`, clamped to the sample. For TOP, apply `s* = max(0, selectedScore)` so a negative correction cannot tighten a raw interval past the displayed point. This is a conservative TOP rendering guard, not part of the original CQR result.
6. Return `exp(min(logP50, qlo(x) - s*))` and `exp(max(logP50, qhi(x) + s*))`. Keep the existing point as the displayed P50 and assert `P10 <= P50 <= P90`.

**Effort and evaluation:** 1 to 2 days. Run a band-only ablation. Freeze `kq` and raw quantiles on development. Report marginal coverage, upper and lower tail misses, median and 90th-percentile width, and log interval score. The finite-sample CQR guarantee assumes exchangeability. TOP is chronological and drifting, so the theorem must not be claimed; the temporal holdout decides whether it transfers.

### 3. Local asymmetric residual intervals

**Plain English:** learn how this model usually misses for tasks with similar uncertainty, including whether misses are more often above than below the point estimate.

**Why it may narrow width:** intended provider, intended model, harness, and source can have different residual spreads. Pooling all regimes forces every task to carry the worst regime's tails. Asymmetry also avoids wasting equal width below zero-cost-like regions when the risk is mostly upward.

**Dependency-free browser JavaScript:**

1. Generate out-of-sample chronological calibration residuals `r_i = log(actual_i) - log(p50_i)` from the unchanged point model.
2. Store residual arrays at a frozen hierarchy using only values known before launch: `intendedProvider|intendedModel|harness|source`, then `intendedModel|harness`, then `source`, then global. Never use the model that actually completed the run if it was not fixed before launch.
3. Require at least 30 independent episodes in a bucket. Fall back otherwise.
4. Use empirical lower and upper order statistics at 10% and 90%.
5. Return `[min(p50, p50 * exp(r10)), max(p50, p50 * exp(r90))]` and assert that the displayed point remains inside the interval.
6. Give rows from the same recurring episode total weight one, rather than treating each loop iteration as independent evidence.

**Effort and evaluation:** 0.5 to 1 day. Run a point-fixed band ablation. Do not optimize the fallback hierarchy on the final holdout. Report width only beside achieved coverage. Tonight's diagnostic harness used only archetype and global residual buckets because the available `model_primary` field may describe the realized run and is therefore inadmissible as a pre-run feature. The local band widened the primary P90/P10 diagnostic, so it needs clean multi-person data before another run.

### 4. Borda ranked-voting retrieval

**Plain English:** each feature votes on which historical prompts are closest, and the donor with the best combined rank wins. Raw feature units never get added together.

**Why it may narrow width:** one extreme value cannot dominate all other features. It can select a more coherent donor set without fitting unstable global weights.

**Dependency-free browser JavaScript:**

1. For every earlier candidate, compute five nonredundant pre-run comparisons: word 3-gram Jaccard, log word-count gap, unique-word-ratio gap, digit-fraction gap, and project match.
2. Each comparison ranks all candidates. Use average ranks for ties.
3. Sum the five ranks. Lowest total rank is best. Keep fixed `k = 3` for the first ablation.
4. Break remaining ties by recency. Do not include recency as a voter in the similarity-only test.
5. Test the paper's dynamic tied-winner set only as a later, separate `k` ablation.

**Effort and evaluation:** about 1 day. Replace only donor ordering. Hold fallback frequency and all downstream estimation fixed. Compare Borda with Jaccard and robust Manhattan on the same held-out tasks.

### 5. Recency-weighted conformal calibration

**Plain English:** recent forecasting mistakes count more when deciding today's band.

**Why it may narrow width:** old pricing and agent-behavior regimes may create residual tails that no longer apply. The current attribution already says recency carries much of retrieval's gain.

**Dependency-free browser JavaScript:**

1. For calibration residual `R_i = abs(log(actual_i) - log(p50_i))`, set `w_i = 2^(-ageDays_i / 5)`.
2. Normalize calibration weights together with a test-point mass of `1` placed at positive infinity.
3. Take the weighted 80th percentile. If the finite residual mass cannot reach 80%, return an infinite interval or abstain. Never silently drop the test mass.
4. Return `exp(log(p50) +/- q)`.

This adapts nonexchangeable conformal inference to TOP. The cited method provides coverage-gap bounds under drift, not unconditional exact coverage under arbitrary change. [Barber et al. 2022](https://arxiv.org/abs/2202.13415)

**Effort and evaluation:** about 0.5 day. Fix the five-day half-life, matching the existing recency mechanism. Compare against unweighted conformal on the same development window. Report effective calibration weight and abstention or infinite-band count.

### 6. Donor-distance-normalized conformal

**Plain English:** widen a band when even the nearest donors are far away, and narrow it when the query sits in a dense part of history.

**Why it may narrow width:** donor dissimilarity is a pre-run signal. A global residual scale ignores it.

**Dependency-free browser JavaScript:**

1. For each fit and calibration query, sum distances to its `k = 3` earlier donors: `d_i`.
2. Let `lambda_i = d_i / median(d_fit)`.
3. Fix `gamma = 1` and calibrate `score_i = abs(y_i - p_i) / (gamma + lambda_i)` in log space.
4. Let `q` be the finite-sample 80th-percentile score.
5. Return `p_i +/- q * (1 + lambda_i)` in log space.

Do not add the paper's neighbor-label standard-deviation term in the first test. That overlaps TOP's failed neighborhood-stability mechanism.

**Effort and evaluation:** about 1 day. Run a band-only ablation with fixed point estimates. Check that width is monotone in donor distance, then compare width at matched coverage.

### 7. Linear size adaptation

**Plain English:** if a retrieved task was half the apparent size of the new one, scale its historical cost before using it.

**Why it may narrow width:** semantically similar tasks can have different amounts of work. Adjusting donors to a common pre-run size may reduce their spread.

**Dependency-free browser JavaScript:**

1. Freeze one size proxy before evaluation, preferably local prompt-token count because it exists before execution.
2. For each donor, set `adjustedLogCost = donorLogCost + log(querySize / donorSize)`.
3. Use adjusted donor costs in the current median, empirical-Bayes, and interval pipeline.
4. Clamp only impossible sizes, such as zero, with a documented minimum of one token. Do not tune exponents on the test set.

**Effort and evaluation:** about 0.5 day. Run a donor-adaptation-only ablation. Prompt length is not proven to represent agentic task size, so report this as a transfer test. Reject if point error or width improves by sacrificing coverage.

### 8. Analogy-X signal gate

**Plain English:** before trusting similarity, test whether feature closeness is actually associated with cost closeness in the current history.

**Why it may narrow width:** when similarity carries no real cost signal, recency-only fallback may be less noisy than an arbitrary neighborhood.

**Dependency-free browser JavaScript:**

1. On fit data only, build the upper triangle of a pairwise feature-distance matrix.
2. Build the corresponding upper triangle of `abs(logCost_i - logCost_j)`.
3. Compute Pearson correlation between the two vectors.
4. Run 999 outcome-label permutations with a fixed, committed PRNG seed.
5. Gate similarity on a predeclared effect-size threshold and permutation `p` threshold. If the gate fails, use recency-only.
6. Any greedy feature selection stays inside the fit fold.

The original Analogy-X demonstration used one real dataset and random controls; a follow-up did not establish clear superiority. Treat it as a diagnostic gate, not a proven accuracy upgrade. [Keung, Kitchenham, and Jeffery 2008](https://doi.org/10.1109/TSE.2008.34)

**Effort and evaluation:** 1 to 2 days. Compare recency-only, similarity-only, and gated combination. The key metric is whether the gate avoids width inflation without lowering coverage.

### 9. Bai-style token-component and stochastic-floor model

**Plain English:** predict the expensive pieces separately and acknowledge that repeated runs of the same task still vary.

**Why it may narrow width:** a single total-cost band mixes prompt ingestion, cache behavior, generated output, pricing changes, and true run-to-run randomness. Conditioning the predictable components separately can remove avoidable heterogeneity, while an independently measured stochastic floor prevents the interval from becoming falsely narrow.

**What Bai et al. measured:** OpenHands ran all 500 SWE-bench Verified tasks four times with each of eight frontier models. Full conversation history was carried forward each round. Input context dominated cost. The same model and task averaged roughly a 2x most-expensive to least-expensive run ratio, while some individual ratios reached 30x. Human difficulty had only modest rank association with token use, Kendall `tau-b = 0.32`, 95% CI `[0.25, 0.38]`. [Bai et al. 2026](https://arxiv.org/pdf/2604.22750)

Their self-prediction method let the same agent inspect the repository and tools without attempting the fix. It used one worked example, asked for separate input and output estimates, and ran three predictions per task. Input and output Pearson correlations were weak to moderate, at most 0.39, all models underestimated, and prediction overhead ranged from 5% to 229% of execution cost. It did not produce or evaluate prediction intervals.

**Transfer to TOP:**

1. Store intended provider, model, harness, cache policy, source, and pricing regime as explicit pre-run strata.
2. Read only pre-run fields already present in the uploaded local export. Optional repository file-count, byte, and test-command buckets must be computed by the local collector before launch. The browser analyzer must not fetch or inspect a repository.
3. Use the frozen robust-distance method to retrieve `k = 20` earlier donors. For each token component, take `median(log1p(tokens))` as its point forecast.
4. On calibration rows, retain the four-component residual vector `actualLogTokens - predictedLogTokens`. For a query, add every retained residual vector to its four component points, apply `expm1`, clamp only negative token counts to zero, and price each joint scenario with the versioned rate table. Taking total-cost quantiles from joint scenarios preserves observed component correlation.
5. Conformalize the resulting lower and upper total-cost quantiles exactly as in candidate 2. Do not sum separately estimated component quantiles because that does not produce a valid total-cost quantile.
6. Estimate a within-task stochastic floor only from genuine independent reruns of the same task under the same intended model and harness. Until those reruns exist, report that component as unestimated rather than inventing it.
7. Never use repeated file views or edits as pre-run features. Bai observed them after execution.

**Effort and evaluation:** several days plus a new task-level export. Evaluate component calibration, total-cost coverage, and width by model and harness. Do not copy Bai's self-prediction into the offline analyzer because it requires an agent run, adds cost, conflicts with the zero-network rule, and was downward biased.

Two reproducibility cautions are worth recording. The paper's displayed GPT-5 cached-input formula appears inconsistent with its stated cached-input rate, and the released code does not clearly expose the semantic Setup, Explore, Fix, Validate, and Closeout labelling procedure. Token-count conclusions are unaffected, but neither detail should be copied without verification.

### 10. Shortest conditional interquantile intervals

**Plain English:** among many conditional quantiles, choose the shortest contiguous interval that contains enough calibrated probability mass rather than always using equal tails.

**Dependency-free browser JavaScript:** estimate a small grid of nearest-neighbor log-cost quantiles, such as `T = 5` or `10`. For every candidate count `k`, enumerate each contiguous `k`-bin span and retain the shortest. On calibration, score a row by the smallest `k` whose interval contains it. Choose the finite-sample 80% order statistic of those scores, then emit the shortest test interval with that many bins.

Conditional Interquantile Regression reported shorter intervals than CQR in skewed general-regression settings, but its published experiments had thousands of training and calibration rows. TOP has much less independent data. A shortest interval can also spend most misses on expensive overruns, so upper-tail misses must be constrained separately. [Guo, Luo, and Zhou 2026](https://arxiv.org/abs/2601.02769)

**Effort and evaluation:** about two days. Run only after ordinary CQR, with fixed `T`, separate upper-tail reporting, and no claim that equal-tailed budgeting risk has been preserved.

## Tonight's research screen and why it cannot select a method

The new harness is [`backtest-abe-screen.cjs`](./backtest-abe-screen.cjs). It reads the private CSV in memory, emits aggregate metrics only, freezes the original 55/20/10/15 chronological boundaries before any sensitivity filter, enforces strictly earlier donors, and fits the predictor on fit rows only for both calibration and development. `runScreen` neither accesses the reserved row objects nor scores them, which a throwing proxy test enforces. The CLI loader does parse the full CSV to construct and sort the eligible corpus, so it is not itself a holdout-preserving import boundary. A discarded pre-fix diagnostic also inspected the reserved rows' prompt identities. The old 130-row holdout is therefore compromised and cannot be used as an unbiased final test. A fresh future holdout must be isolated at collection or import time. The harness has 55 synthetic checks in [`test-backtest-abe-screen.cjs`](./test-backtest-abe-screen.cjs).

### Data eligibility

| Source | Available material | ABE eligible? | Reason |
|---|---|---:|---|
| Adam | 849 eligible task rows with prompt excerpt, chronology, and realized cost | Diagnostic only | corrected screen analyzes 719 pre-holdout rows; 12 unique normalized excerpts, 707 duplicate rows, maximum multiplicity 706 |
| Adam, first exact prompt only | 12 retained fit rows | No | frozen boundaries leave 0 retained calibration rows and 0 retained development rows; the reserved count stays 130 and those rows are not scanned by this sensitivity |
| Colin, user-labelled attachment | aggregate of 20 sessions and 904 usage records | No | no per-task prompt features, chronology, or realized task cost |
| Separate 17-session export | aggregate only, identity not embedded | No | no per-task analogy rows; not attributed to Sam without proof |
| Sam | no verified task-level export found | No | a person-level ABE result cannot be constructed honestly |

No raw prompt, project, model, timestamp, session identifier, or questionnaire content was copied into Git.

### Diagnostic-only development screen

These figures are not comparable with the supplied 69x benchmark. This screen uses a deliberately simple point-and-band harness, while the 84 development rows contain one unique normalized excerpt and are not independent. The fit window has 12 unique excerpts among 466 rows and zero robustly active prompt-vector dimensions.

| Diagnostic method | Development n | Coverage | Median P90/P10 | Mean log interval score |
|---|---:|---:|---:|---:|
| Five-day recency point, symmetric conformal band | 84 | 85.71% | 1.682x | 0.706 |
| Jaccard `k = 3`, symmetric conformal band | 84 | 86.90% | 1.702x | 0.691 |
| Fixed Jaccard `k = 3` point, local asymmetric residual band | 84 | 83.33% | 1.736x | 0.676 |
| Fixed Jaccard `k = 3` point, `k = 20` neighbor quantiles plus CQR correction | 84 | 85.71% | 1.712x | 0.685 |

The only honest interpretation is:

- Neither tested interval method narrowed the primary median P90/P10 relative to the Jaccard symmetric band. CQR was 1.712x versus 1.702x, and the local asymmetric band was 1.736x.
- CQR's log interval score was slightly lower, but it also had slightly lower coverage and a wider secondary relative-width metric. Correlated repeats make all such differences unsuitable for method selection.
- Manhattan, Euclidean, Borda, donor-distance normalization, recency-weighted conformal, and Jaccard produced indistinguishable aggregate results because the fit geometry had zero active robust dimensions and was dominated by one repeated prompt. That is a data failure, not evidence of equivalence.
- Exact-prompt capping leaves 12 fit rows and no calibration or development rows inside the frozen boundaries, so the sensitivity is explicitly not run.

### Verification counts

- New research harness: 55 of 55 checks passed.
- Existing retrieval leakage suite: 10 of 10 checks passed.
- Existing ABE leakage and admissibility suite: 18 of 18 checks passed.
- Total executed behavioral checks: 83 of 83 passed. Both new JavaScript files also passed `node --check`.

## Evaluation contract for the next real test

Before collecting and opening a fresh final holdout, write and commit a candidate-specific protocol with these rules:

1. **Target:** one future run's API-equivalent cost, not a four-run mean and not a subscription price.
2. **Split:** preserve chronology. Fit transformations and similarity features on fit only, calibrate later, select at most one candidate on development, then evaluate once on a newly collected holdout. Keep the compromised old 130-row slice diagnostic-only.
3. **People:** report Adam, Sam, and Colin separately. Pool only after person-level results and with no person-specific tuning.
4. **Independence:** one recurring episode gets total bootstrap weight one. Report an exact-prompt-capped sensitivity.
5. **Primary width:** median `P90/P10`, plus 90th-percentile `P90/P10`. Keep the vault's `(P90-P10)/P50` metric as a secondary view.
6. **Coverage:** report overall, upper-tail misses, lower-tail misses, and answered-task coverage if the method can abstain.
7. **Point diagnostics:** median absolute log error, mean log bias, Standardised Accuracy against a frozen guessing baseline.
8. **Combined diagnostic:** log interval score, with `alpha = 0.20`.
9. **Paired uncertainty:** block-bootstrap candidate-minus-baseline differences by independent task episode and report intervals, not only a best value.
10. **Decision gate:** no advancement if width improves by violating the pre-registered coverage floor or increasing expensive upper-tail misses beyond the frozen tolerance.
11. **Ablation:** recency-only, similarity-only, and combined. Keep fallback frequency matched when comparing similarity metrics.
12. **Disclosure:** publish every attempted frozen candidate, including failures. Do not convert any result into a public savings or accuracy claim.

## Data needed for a real cross-person ABE test

The next consented research-safe export needs one row per completed task with:

- a user-local opaque task ID and episode ID;
- relative chronological order or a coarse time bucket;
- intended provider, model, harness, and source;
- irreversible prompt features or shingles computed locally, not raw prompt text;
- pre-run prompt length and optional repository size buckets;
- realized input, cache-read, cache-write, and output tokens;
- versioned API-equivalent realized cost; and
- an exact-repeat or same-episode flag.

It should exclude prompt text, repository paths, filenames, session transcripts, questionnaire free text, credentials, and original project names.

## Primary sources

- [Shepperd, Reflections after 28 years, 2025](https://arxiv.org/abs/2501.14582)
- [Idri, Amazal, and Abran, systematic mapping and review, 2015](https://doi.org/10.1016/j.infsof.2014.07.013)
- [Shepperd and Schofield, original ABE study, 1997](https://doi.org/10.1109/32.637387)
- [Kocaguneli et al., essential assumptions and TEAK, 2012](https://doi.org/10.1109/TSE.2011.27)
- [Shepperd and MacDonell, evaluating prediction systems, 2012](https://doi.org/10.1016/j.infsof.2011.12.008)
- [Bai et al., agent token consumption, 2026](https://arxiv.org/pdf/2604.22750)
- [Jørgensen and Sjøberg, empirical effort intervals, 2003](https://doi.org/10.1016/S0950-5849(02)00188-X)
- [Romano, Patterson, and Candes, CQR, 2019](https://arxiv.org/abs/1905.03222)
- [Papadopoulos, Vovk, and Gammerman, kNN conformal prediction, 2011](https://doi.org/10.1613/jair.3198)
- [Azzeh and Alseid, ranked voting, 2013](https://doi.org/10.1049/iet-sen.2012.0119)
- [Keung, Kitchenham, and Jeffery, Analogy-X, 2008](https://doi.org/10.1109/TSE.2008.34)
