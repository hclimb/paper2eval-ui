# claims.json

`claims.json` is the eval contract — the single file that says what the task measures, what the baseline is, what the target is, and how metric values turn into rewards. Skeleton writes it, evaluate.py reads it at runtime, and rescale might rewrite it in between when the measured baseline doesn't match the paper's.

## Schema

```json
{
  "slug": "beat-math500",
  "paper_id": "2604.05355",
  "paper_title": "ETR: Entropy Trend Reward for ...",
  "research_goal": "Design and implement a ...",
  "difficulty": "medium",

  "benchmark_hf_id": "HuggingFaceH4/MATH-500",
  "benchmark_name": "MATH500",
  "benchmark_config": "default",
  "benchmark_scope": "exact",
  "benchmark_split": "test",
  "held_out_parquet": "/mnt/eval/.parsed/HuggingFaceH4___MATH-500__default/test.parquet",

  "eval_type": "raw benchmark metric",
  "eval_protocol": "Each of the 500 MATH500 problems is formatted with ...",
  "eval_derivation": "Evaluate each row of the test split directly ...",

  "metric_name": "accuracy",
  "metric_description": "Pass@1 accuracy (%) under greedy decoding ...",
  "metric_direction": "higher_is_better",
  "metric_lower_bound": 0.0,
  "metric_upper_bound": 100.0,

  "baseline_method": "runtime measurement on scoped data ...",
  "baseline_value": 77.2,
  "target_value": 81.456,
  "paper_best_value": 85.712,

  "reward_thresholds": [
    {"value": 77.2, "reward": 0.0},
    {"value": 78.761, "reward": 0.22},
    {"value": 80.321, "reward": 0.44},
    {"value": 81.882, "reward": 0.63},
    {"value": 83.442, "reward": 0.74},
    {"value": 85.003, "reward": 0.85},
    {"value": 86.563, "reward": 1.0}
  ],

  "base_model_hf_id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
  "base_model_path": "/mnt/models/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
  "base_model_architecture": "Qwen2ForCausalLM",

  "allowed_models": ["deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"],
  "allowed_datasets": ["zwhe99/DeepMath-103K"],
  "allowed_benchmarks": ["HuggingFaceH4/MATH-500"],

  "instruction_template": "# Beat Math500\n\n**Get `accuracy` >= ...",

  "block_list": {
    "method_names": [],
    "arxiv_ids": ["2604.05355"]
  },

  "api_models": [],
  "paper_github_url": "https://github.com/Xuan1030/ETR",

  "_meta": {
    "task_slug": "paper2eval/task-01",
    "mode": "rlvr",
    "scope_rescaled": true,
    "paper_baseline": 85.0,
    "paper_best": 90.6,
    "measured_baseline": 77.2,
    "rescale_method": "headroom_fraction"
  },

  "structural_config": {
    "seeded_run_ids": ["exp_001"]
  }
}
```

## Field reference

### Identity

| Field | Type | Description |
|-------|------|-------------|
| `slug` | string | Task identifier, derived from benchmark name |
| `paper_id` | string | Arxiv ID |
| `paper_title` | string | Paper title |
| `research_goal` | string | Task description (from pass 4) |
| `difficulty` | string | "easy" / "medium" / "hard" |

### Eval target

| Field | Type | Description |
|-------|------|-------------|
| `benchmark_hf_id` | string | HuggingFace dataset ID |
| `benchmark_name` | string | Human-readable name |
| `benchmark_config` | string? | HF dataset config name |
| `benchmark_scope` | string | "exact" / "variant" / "subset" / "different_data" |
| `benchmark_split` | string | HF split name (usually "test") |
| `held_out_parquet` | string | Path on `/mnt/eval` where verifier reads data |
| `eval_type` | string | Shape of evaluation |
| `eval_protocol` | string | Exact decoding params, grading procedure |
| `eval_derivation` | string | How test set is constructed from HF data |

### Scoring

| Field | Type | Description |
|-------|------|-------------|
| `metric_name` | string | What's measured (e.g., "accuracy") |
| `metric_description` | string | Full description of the metric |
| `metric_direction` | string | "higher_is_better" / "lower_is_better" |
| `metric_lower_bound` | float? | Theoretical minimum (e.g., 0.0 for accuracy) |
| `metric_upper_bound` | float? | Theoretical maximum (e.g., 100.0 for accuracy) |
| `baseline_value` | float | Starting metric value (runtime-measured if rescaled) |
| `target_value` | float | Agent's target (baseline + 50% headroom) |
| `paper_best_value` | float? | Paper's reported best (rescaled if applicable) |
| `reward_thresholds` | list | Piecewise-linear curve: `[{value, reward}, ...]` |

### Resources

| Field | Type | Description |
|-------|------|-------------|
| `base_model_hf_id` | string | HuggingFace model ID |
| `base_model_path` | string | Path on `/mnt/models` |
| `base_model_architecture` | string | Model class (e.g., "Qwen2ForCausalLM") |
| `allowed_models` | list[string] | Models available on the volume |
| `allowed_datasets` | list[string] | Datasets available on the volume |
| `allowed_benchmarks` | list[string] | Benchmarks available on the volume |
| `api_models` | list[dict] | Models accessed via API (>80GB, teacher/judge) |
| `paper_github_url` | string | Paper's code repo URL (for eval gen agent) |

### Anti-leak

| Field | Type | Description |
|-------|------|-------------|
| `block_list.method_names` | list[string] | Terms censored from agent-visible files |
| `block_list.arxiv_ids` | list[string] | Papers blocked from alphaxiv access |
| `instruction_template` | string | Raw instruction markdown (pre-resource injection) |

### Metadata

| Field | Type | Description |
|-------|------|-------------|
| `_meta.task_slug` | string | Harbor task name |
| `_meta.mode` | string | Always "rlvr" |
| `_meta.scope_rescaled` | bool | Whether baseline measurement triggered rescaling |
| `_meta.paper_baseline` | float | Paper's original reported baseline |
| `_meta.paper_best` | float | Paper's original reported best |
| `_meta.measured_baseline` | float | Pipeline's runtime baseline measurement |
| `_meta.rescale_method` | string | "headroom_fraction" |
| `structural_config.seeded_run_ids` | list[string] | Expected run IDs in seed log (NOP check) |

## Runtime contract

evaluate.py reads claims.json every time it runs — the thresholds aren't baked into the script:

```python
with open("/tests/claims.json") as f:
    claims = json.load(f)
thresholds = claims["reward_thresholds"]
base_model_path = claims["base_model_path"]
```

This is why rescaling works without touching evaluate.py. Change the numbers in claims.json, and the next run picks them up automatically.

## Where the fields come from

claims.json pulls data from almost every phase in the pipeline:

| Field(s) | Source phase |
|----------|-------------|
| slug | Pass 4 (deterministic from benchmark name) |
| benchmark_*, eval_* | Pass 2b |
| metric_*, baseline_*, target_* | Pass 2b + reward.py + rescale.py |
| reward_thresholds | reward.py (initial) → rescale.py (updated) |
| base_model_*, allowed_* | TaskSpec projection (verify + scout) |
| block_list | Pass 3 + orchestrator post-processing |
| instruction_template | Pass 5 (deterministic) |
| paper_github_url | Pregate → comprehension.open_source.code_repo |

`task_spec.py:task_spec()` runs ~20 cross-checks before writing. If any of these sources disagree with each other, it fails loud instead of writing a broken contract.
