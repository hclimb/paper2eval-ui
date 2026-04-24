# Pipeline

Seven phases turn an arxiv paper into a sealed research challenge. Each phase saves its work to `state.json`, so if the pipeline crashes on phase 4, you don't re-run phases 0-3.

```
Phase 0   pregate       Should we bother?                (alphaxiv + 1 LLM call)
Phase 1   ingest        PDF → markdown                   (multi-pass vision API)
Phase 1b  verify        Are these resources real?         (Claude Code agent)
Phase 2   analyze       Problem, numbers, reward curve    (6 LLM passes + deterministic)
Phase 3   scout         GPU sizing + timeouts             (1 LLM call + math)
Phase 4   skeleton      Generate task directory           (deterministic codegen)
Phase 4.5 leak_audit    Can a PhD reconstruct the method? (frontier LLM reviewer)
Phase 4a  populate      Download models/data to volumes   (modal run)
Phase 4b  build         Docker + evaluate.py + baseline   (Claude Code agent on GPU)
Phase 5   validate      Structural lint                   (no API calls)
```

Orchestrator: `src/paper2eval/cli.py:run_pipeline()`.

## Phase 0: Pregate

**`phases/pregate.py`**

Fetches paper metadata via `alphaxiv paper --json`. One cheap Opus call decides: worth processing or not?

1. Has computational experiments (not theory/surveys)
2. Has quantitative results (concrete numbers)
3. Reproducible in a sandbox (open weights, public data)

Also grabs the GitHub repo URL and HuggingFace model/dataset IDs from alphaxiv metadata so downstream phases don't have to re-fetch them.

**Cost:** ~$0.02. If it rejects, nothing else runs.

## Phase 1: Ingest

**`phases/ingest.py`**

Fetches PDF, runs `read_paper_with_vision()`:

1. Split into 2-page chunks
2. **Pass 1:** Sonnet vision API extraction (temp=0, max 32k tokens)
3. **Pass 2:** Verification against original (catch dropped rows, wrong numbers)
4. **Pass 3:** Table-specific counting (only when tables detected)

Chunks run in parallel. If output hits max_tokens, the chunk splits in half. Arxiv requests route through jihad proxy when available.

**Output:** `state.paper_content` (full markdown), `state.paper_title`, `state.arxiv_metadata`.

## Phase 1b: Verify

**`phases/verify.py`**

A Claude Code agent with web access goes and checks whether every resource the paper mentions actually exists:

- **Models:** HF repo ID, params, architecture, size_gb, gated, usage_role (base/teacher/eval-only/comparison/output)
- **Datasets:** columns, splits with row counts, config
- **Benchmarks:** scope (exact/variant/subset/different_data), question/answer columns, sample rows, coverage notes
- **External corpora:** GitHub/Zenodo/archive URLs with file listings

Safety net: if a model is tagged with this paper's arxiv ID on HuggingFace, it's probably the paper's trained checkpoint — not something the agent should start from. Those get marked `output` role.

Everything downstream requires `verified=True`. If the LLM hallucinated a HuggingFace ID in pass 1, it dies here.

**Runs in parallel with Pass 2a** — no shared mutable state between them.

**Output:** `state.exploration` → typed `Exploration` object. Saved to `verified_resources.json`.

## Phase 2: Analyze

Six passes, wired together by `phases/analyze/orchestrator.py` with hard gates between them.

### Pass 1: Comprehension (`pass1.py`)

Two sub-passes:
- 1a: `has_computational_experiments`, `primary_method`, `methods`, `framework`, `compute`
- 1b: models, datasets, benchmarks, open-source repos, external dependencies

Gate: no computational experiments → stop.

### Pass 2a: Problem Framing (`pass2a.py`)

Describes what's wrong without saying how the paper fixes it:
- `problem` — 1-3 sentences on the limitation before this paper (no method names)
- `solution_brief` — the actual method, internal only, never shown to agent
- `suitability` — high/medium/low

Gate: low suitability → stop.

### Pass 2b: Metric Extraction (`pass2b.py`)

~130-line prompt, 4-step procedure:

1. Inventory all results tables
2. Per-benchmark: concrete numbers
3. Pick ONE benchmark (must be in verified IDs)
4. Fill: baseline (model, value, direction, hyperparameters), paper_best, benchmark (hf_id, split, eval_protocol, eval_derivation), training_corpus (URLs, files)

Four gates (any one kills the paper):

- **Viability:** `abs(paper_best - baseline) / abs(baseline)` must be ≥ 0.001 (0.1%). If a paper claims an improvement of 90.1 vs 90.0 on a 90-point baseline, that's 0.11% — too small for a meaningful reward curve. This catches papers where the "improvement" is within noise.

- **Direction:** paper_best must actually be better than baseline in the metric's direction. If the metric is `higher_is_better` but paper_best < baseline, something's wrong — either the LLM misread the table or the metric direction is flipped. Pipeline stops rather than building a broken task.

- **Buildability:** `benchmark.hf_id` must be non-empty. Some papers evaluate on custom harnesses (run the code, check the output manually) or proprietary test sets. If there's no HuggingFace dataset to evaluate against, we can't build an automated eval. Correctly rejected.

- **Method-as-protocol:** An LLM judge reads `eval_protocol` alongside `solution_brief` and asks: "does the evaluation procedure describe the paper's method?" Some papers (probing, interpretability, adversarial evaluation) work like this — the thing you're measuring IS the technique. You can't hide the method from the agent if the agent has to implement the method to compute the metric. These are correctly unfixable.

### Pass 4: Task Framing (`pass4.py`)

**This is where the wall is.** Before the LLM sees problem_extraction, `_strip_for_barrier()` rips out: `solution_brief`, `failed_approaches`, citations, `eval_protocol`, `eval_type`, `eval_derivation`. The LLM can't leak what it can't see.

It frames a task: "achieve [metric] [direction] [target] on [benchmark] starting from [baseline]."

The slug comes from the benchmark name deterministically — never from LLM output. One task per paper.

### Reward Curve (`reward.py`)

Deterministic math. See [Reward Curve](reward-curve.md).

### Pass 3 + Pass 5 (parallel via ThreadPoolExecutor)

**Pass 3 (`pass3.py`):** Diagnosis steps + block list + reading list. Each step adversarially tested:
- "Could agent solve by scaling this up?" → leaks
- "Does this compute the paper's key signal?" → leaks

Reading list restricted to 4 purposes: benchmark_definition, metric_origin, model_architecture, eval_standard.

**Pass 5 (`pass5.py`):** **No LLM. Just a template.** Plugs in model + params, benchmark, metric, baseline, target, headroom. Previous versions had the LLM write a "Background" section. It leaked the method every single time.

## Phase 3: Scout

**`phases/scout/orchestrator.py`**

One LLM call figures out per-task sizing (model params, training tier, steps). Then it's all math:

- **VRAM** (`vram.py`): bf16 + adam + activations + LoRA. Cheapest GPU tier within 25% margin. Tiers: A100-40GB → A100-80GB → 2×H100 → 4×H100 → 8×H100.
- **Training time** (`timing.py`): Interpolate sec/step from benchmarks (SFT 7B=8s, DPO=20s, RL=60s on A100-80GB). Adjust for GPU speed, multi-GPU efficiency (0.85^log2(count)).
- **Timeouts** (`timeouts.py`): Verifier timeout from problem count × model size. [5h, 20h].
- **Resources** (`judgment.py`): Build `pre_download` list. Models >80GB → API-only (not downloaded).

**Output:** `state.env_spec`, `state.task_overrides`, `state.api_only_models`.

## Phase 4: Skeleton

**`phases/skeleton/generate.py`**

No LLM — just code generating files. Writes every file in the task directory (see [Task Format](../tasks/task-format.md)).

Before writing anything, `task_spec.py` runs ~20 cross-checks to make sure all the phases agree with each other. If the benchmark isn't verified, or the model isn't in the download list, or the reward curve is too short — it fails loud and tells you which phase to re-run.

**Output:** `state.task_dirs`, complete task directories.

## Phase 4.5: Leak Audit

**`phases/leak_audit.py`**

Claude reads every file the agent would see, alongside `solution_brief` and `block_list` as ground truth. The question: "could a PhD student figure out the paper's method from just these files?"

If yes — find the leaking part, rewrite it, check again. Up to 5 rounds. If it can't be cleaned, the pipeline stops.

This runs BEFORE populate, because there's no point downloading 15GB of model weights for a task that leaks the answer.

**Output:** `_leak_audit.json` with full trail.

## Phase 4a + 4b (parallel)

### Populate (`phases/populate.py`)

`modal run populate_volume.py` downloads to two volumes:
- **`/mnt/models`** — agent + verifier: models, training data, benchmarks, corpora
- **`/mnt/eval`** — verifier ONLY: same benchmark parquets, but the agent can't touch them. Harbor simply doesn't mount this volume into the agent's sandbox — it's not a rule the agent follows, it's a wall the agent can't see through.

Post-gate: verify held-out parquets exist on eval volume.

### Build (`phases/build/`)

Three stages on Modal:

1. **Smoke test** (`build.py`): `modal run build_on_modal.py` — structure check, no GPU
2. **Eval generation** (`eval_gen.py`): Claude Code agent writes evaluate.py on GPU. Gets paper's repo (clones, copies eval code verbatim), model README, volume inventory. Validated by static checks + LLM judge. 2 fix rounds max.
3. **Baseline measurement** (`rescale.py`): Runs `evaluate.py` on base model via Modal GPU. If measured != paper-reported → rescale reward curve preserving headroom fraction.

Three separate Modal images: `image` (bare, for smoke test), `eval_image` (adds Claude CLI for the eval-writing agent), `measure_image` (vllm/torch/pandas baked in — because if you pip-install them at runtime, Modal's own dependency injection shadows them and vllm breaks).

**Output:** `tests/evaluate.py`, rescaled `tests/claims.json`, rescaled `instruction.md`.

## Phase 5: Validate

**`phases/validate.py`**

Three static gates (no API, no execution):

1. **NOP:** seed log has exactly the seeded run IDs
2. **RLVR:** evaluate.py compiles + required functions + no eval-data from `/mnt/models` + claims.json monotonic
3. **LEAK:** regex scan of agent-visible files against `block_list.method_names`

Readiness gate (`utils/readiness.py`): task.toml exists, no `_build_error.txt`, build log exists, evaluate.py exists, validation passed.

**Final status:** done / incomplete / unbuildable / skipped.
