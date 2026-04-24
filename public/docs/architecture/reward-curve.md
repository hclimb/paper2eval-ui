# Reward Curve

The reward curve turns a metric score (like "79.2% accuracy") into a number between 0 and 1. No LLM involved — just math. The curve lives in `claims.json` and evaluate.py reads it at runtime.

## Anchors

Four anchor points define the piecewise-linear curve:

| Anchor | Metric value | Reward | Meaning |
|--------|-------------|--------|---------|
| baseline | Paper's baseline | 0.0 | Starting point, no improvement |
| target | baseline + 50% of headroom | 0.6 | Half the paper's improvement |
| paper_best | Paper's reported best | 0.9 | Matched the paper |
| beyond | paper_best + 10% of range | 1.0 | Exceeded the paper |

Constants from `config.py`:
```
REWARD_TARGET_FRACTION  = 0.5   # target = baseline + 0.5 × (paper_best - baseline)
REWARD_TARGET_ANCHOR    = 0.6   # reward at target
REWARD_PAPER_BEST_ANCHOR = 0.9  # reward at paper_best
REWARD_OVERSHOOT_FACTOR = 0.1   # beyond = paper_best + 0.1 × full_range
REWARD_INTERPOLATION_POINTS = 7 # number of (value, reward) pairs
```

## Direction handling

For `higher_is_better`: baseline ≤ target ≤ paper_best ≤ beyond.

For `lower_is_better`: baseline ≥ target ≥ paper_best ≥ beyond (lower metric = better).

## Computation

`phases/analyze/reward.py:_build_reward_curve()`

1. Compute `full_range = abs(paper_best - baseline)`. If zero (paper claims no improvement): `full_range = abs(baseline) * 0.1` or `1.0`.
2. Compute `beyond = paper_best ± (full_range × 0.1)`, clamped to metric bounds (lower_bound, upper_bound).
3. If bounds ate the overshoot (beyond ≈ paper_best), shift paper_best reward to 1.0.
4. Normalize to progress scale: `progress = (value - baseline) / span`.
5. Sort + deduplicate anchors. When multiple anchors collapse to the same progress value (e.g., baseline == target == paper_best), only the first (lowest reward) at each progress value is kept. Without this, the interpolation would skip the 0→0.6→0.9 gradient and jump straight to 0.9 — the agent gets near-max reward for barely moving off baseline.
6. Interpolate linearly between anchors for 7 equally-spaced values from baseline to beyond.
7. Return list of `{value, reward}` tuples, rounded.

## Example: ETR paper (2604-05355)

Paper-reported: baseline 85.0, paper_best 90.6.
Runtime-measured baseline: 77.2 (rescaled — see below).

After rescaling:

| value | reward |
|-------|--------|
| 77.200 | 0.00 |
| 78.761 | 0.22 |
| 80.321 | 0.44 |
| 81.882 | 0.63 |
| 83.442 | 0.74 |
| 85.003 | 0.85 |
| 86.563 | 1.00 |

Agent achieved 79.20% → interpolated reward = **0.282**.

## Rescaling

Papers report one baseline number. When we actually run the base model through our evaluate.py, we usually get a different number (different vLLM version, different tokenizer behavior, stricter grader). The reward curve gets rescaled so the difficulty stays proportionally the same.

**`phases/build/rescale.py:_rescale_claims_for_scope()`**

The idea: preserve what fraction of the theoretical headroom the paper closed.

```
paper_improvement = paper_best - paper_baseline
paper_headroom = metric_bound - paper_baseline
fraction_closed = paper_improvement / paper_headroom

agent_headroom = metric_bound - measured_baseline
scoped_paper_best = measured_baseline + (fraction_closed × agent_headroom)
target = measured_baseline + 0.5 × (scoped_paper_best - measured_baseline)
```

For ETR:
```
paper: 90.6 - 85.0 = 5.6 improvement, (100 - 85.0) = 15.0 headroom → 37.3% closed
rescaled: 77.2 + (0.373 × 22.8) = 85.712 paper_best_equivalent
target: 77.2 + 0.5 × (85.712 - 77.2) = 81.456
```

Rescaling updates:
- `claims.json` — baseline_value, target_value, paper_best_value, reward_thresholds
- `instruction.md` — all occurrences of the old numbers
- `seed/log.jsonl` — baseline entry

`claims.json._meta.scope_rescaled = true` records that rescaling happened, with `paper_baseline`, `paper_best`, `measured_baseline`, and `rescale_method`.

## Why runtime baseline differs

Common causes:
- Different tokenizer/chat template handling between paper's eval and ours
- Different vLLM version behavior
- Paper evaluated on a different data split or subset
- Different answer extraction logic (regex differences)
- Different grader strictness (math_verify vs PRM800K sympy grader: 4.4pp gap on ETR)

We trust what we actually measured, not what the paper says. The paper's number is kept in `_meta` so you can always see the original.

## Quantization check

After rescaling, `_check_quantization()` verifies the reward curve has enough resolution:

```
step_size = metric_range / benchmark_n_rows
n_steps = curve_range / step_size
```

If `n_steps < MIN_REWARD_CURVE_STEPS` (5), the metric is too coarse for meaningful interpolation. The task gets flagged but not rejected — the warning goes into `claims.json._meta`.

## Reading the curve at runtime

`evaluate.py` loads `claims.json`, extracts `reward_thresholds`, and calls `interpolate_reward(accuracy, thresholds)`:

```python
def interpolate_reward(accuracy, thresholds):
    pts = sorted(thresholds, key=lambda x: x["value"])
    if accuracy <= pts[0]["value"]:
        return pts[0]["reward"]
    if accuracy >= pts[-1]["value"]:
        return pts[-1]["reward"]
    for i in range(len(pts) - 1):
        v0, r0 = pts[i]["value"], pts[i]["reward"]
        v1, r1 = pts[i + 1]["value"], pts[i + 1]["reward"]
        if v0 <= accuracy <= v1:
            t = (accuracy - v0) / (v1 - v0)
            return r0 + t * (r1 - r0)
    return pts[-1]["reward"]
```

The reward is written to `/logs/verifier/reward.txt` as a plain float string.
