# Verifier and Reward

How evaluate.py gets written, tested, and used to score the agent. The short version: a Claude Code agent writes it by copying the paper's grading code, the pipeline validates it and measures a baseline, and then at runtime harbor uses it to score whatever the agent trained.

## The big picture

```
PIPELINE TIME (phase 4b)                    RUN TIME (harbor)
────────────────────────                    ─────────────────

1. Claude Code agent                        5. Agent trains a model,
   writes evaluate.py                          saves to /app/checkpoints/
   on a Modal GPU box                          (4+ hours, 8× A100)
         │
         ▼
2. Static validation                        6. Harbor runs test.sh
   + LLM judge                                 → evaluate.py
   (up to 2 fix rounds)                        in verifier sandbox
         │
         ▼                                  7. evaluate.py loads checkpoint,
3. measure_baseline:                           runs benchmark from /mnt/eval,
   run evaluate.py on base model               computes metric, interpolates
   via Modal GPU                               reward from claims.json,
         │                                     writes reward.txt
         ▼
4. Rescale claims.json
   if measured baseline ≠ paper's
```

Steps 1-4 happen once during task generation. Steps 5-7 happen every time the task is run.

## Step 1: Generating evaluate.py

**`phases/build/eval_gen.py:generate_eval_for_task()`**

The pipeline writes a prompt to `_eval_prompt.txt` and calls `modal run build_on_modal.py --generate-eval-mode`. On the Modal container, the `generate_eval()` function:

1. Creates a non-root `evaluator` user (Claude Code refuses `--dangerously-skip-permissions` as root)
2. Copies `uv` to the evaluator's home dir
3. Runs `claude --print --dangerously-skip-permissions` with the prompt on stdin
4. Claude Code writes `/tests/evaluate.py` inside the container
5. The script and any agent trace are returned to the local machine

### What the eval agent gets

The prompt (`_EVAL_AGENT_PROMPT`) gives the agent:

- **The paper's GitHub repo URL** — first instruction is `git clone --depth 1` and find their eval/grading code
- **The base model's README** — chat templates, generation defaults, tokenizer quirks
- **The full TaskSpec as JSON** — metric, baseline, target, benchmark, model path, eval_protocol
- **A volume inventory** — every model, dataset, benchmark on the volume with paths and access patterns
- **Benchmark sample rows** — column names, data types, actual example values so the agent sees the format
- **A scope declaration** — exact (implement verbatim) vs scoped (implement for what's on the volume)

### The verbatim-copy mandate

The prompt demands the agent copy grading code **verbatim** from the paper's repository:

> Copy it VERBATIM into evaluate.py. Do not paraphrase, do not "improve", do not reconstruct from your knowledge of the underlying recipe — even when you recognize the recipe.

This matters more than you'd think. On the ETR paper, the difference between the paper's PRM800K grader and an alternative (`math_verify`) was **4.4 percentage points** on identical model outputs. Tiny formatting differences (`\text{Evelyn}` vs `Evelyn`, `(2, 4)` vs `(2,4)`) add up across 500 problems.

### The contract

evaluate.py must expose two functions:

```python
def run_benchmarks(checkpoints: list, base_model_path: str) -> dict:
    """Returns {"primary": {"agent": float, "base_model": float}}"""

def main() -> None:
    """Reads claims.json, discovers checkpoint, runs eval, writes reward.txt"""
```

Key constraints:
- **Reward thresholds read from claims.json at runtime** — not hardcoded. The pipeline rescales claims.json after evaluate.py is written. Hardcoded thresholds go stale.
- **base_model is always a fresh measurement** — never echo the paper's number. The pipeline calls `run_benchmarks([], base_model_path)` to calibrate.
- **Eval data from `/mnt/eval/` only** — never `/mnt/models/`. The agent can write to `/mnt/models/`; reading eval data from there defeats held-out isolation.
- **No network access** — no urllib, requests, httpx, curl, git, socket. All data from mounted volumes.
- **Install deps inside run_benchmarks()** — not at module level. The pipeline's compile-test runs `exec_module()` which triggers module-level code. Paper-specific libs (e.g., `pylatexenc`) go in a `subprocess.check_call(["uv", "pip", "install", "--system", ...])` at the top of `run_benchmarks()`.

## Step 2: Validation

After the agent writes evaluate.py, two validation passes run back-to-back.

### Static checks (`_validate_eval_static()`)

1. **Syntax:** `ast.parse()` — unrecoverable if this fails
2. **Required functions:** `run_benchmarks` and `main` must exist as top-level defs
3. **Eval data leak:** AST scan for reads from `/mnt/models` that look like benchmark data access. This is the structural anti-tampering defense — if evaluate.py reads the eval set from the agent-writable volume, the agent could overwrite it.
4. **TASK_UNBUILDABLE:** If the agent wrote a `sys.exit(2)` stub, short-circuit everything else

### LLM judge (`_judge_eval_implementation()`)

A separate Opus call reads the script alongside the eval spec and decides if they match. The prompt looks like this (simplified):

```
Decide whether this evaluate.py honestly implements the eval protocol below.

## Protocol the script should implement
{eval_protocol}       ← e.g., "greedy decoding, max 16384 tokens, PRM800K grader"

## Derivation (how the test set is constructed)
{eval_derivation}     ← e.g., "evaluate each row of HuggingFaceH4/MATH-500 test split"

## Scope
{benchmark_scope}     ← "exact" / "variant" / "subset"

## The script
```python
{the actual evaluate.py source}
```

FAIL only on silent substitution of DATA, DERIVATION, or METRIC.
Everything else is implementation detail — not your call.
```

"Silent substitution" means the script quietly does something different from what the protocol says:
- Loads a different dataset than what's on the volume
- Computes a different metric (e.g., F1 when the protocol says accuracy)
- Adds filters the protocol doesn't mention (e.g., "only English examples")
- Drops filters the protocol requires (e.g., ignoring a difficulty threshold)
- Falls back to approximations when data is "missing" instead of crashing

The judge doesn't care about variable names, code organization, which vLLM wrapper you use, or whether you wrote the grader as a class or a function. Just: does it score the right data with the right metric?

### Fix loop

If either check fails, all errors are bundled into a single feedback string. A fix agent (Claude Code, local, no Modal cost) edits evaluate.py. The validation loop re-runs. Up to **2 total attempts** (initial + 1 fix round).

If validation still fails after 2 attempts, the task build fails.

## Step 3: Baseline measurement

**`phases/build/rescale.py:_measure_baseline_on_modal()`**

Runs `modal run build_on_modal.py --measure-baseline-mode`. On Modal, the `measure_baseline()` function:

1. Loads evaluate.py via `importlib.exec_module()` (same as a compile-test, but on a GPU box)
2. Calls `run_benchmarks([], base_model_path)` — empty checkpoints list = base model only
3. Returns `{"score": float}` (the base_model accuracy)

This runs on `measure_image` — an image with vllm, torch, pandas, pyarrow **baked in** at build time. This avoids Modal's `/__modal/deps` shadowing bug where Modal's injected `typing_extensions` predates what vllm needs.

### Trivial-pass detection

If the measured baseline already exceeds the paper's target:

```
TRIVIAL-PASS DETECTED: base scores 89.3 on its own, paper target is 87.8.
Agent submits empty checkpoint → wins. Rejecting.
```

The task is rejected. An agent that does nothing would score above target.

## Step 4: Rescaling

**`phases/build/rescale.py:_rescale_claims_for_scope()`**

Papers report one baseline number. When we actually run the model, we almost always get a different number — different vLLM version, different tokenizer, stricter grader. So the reward curve gets rescaled.

The idea: preserve what **fraction of the theoretical headroom** the paper closed.

```
relevant_bound = upper_bound (for higher_is_better) or lower_bound
paper_headroom = relevant_bound - paper_baseline
frac_closed = (paper_best - paper_baseline) / paper_headroom
agent_headroom = relevant_bound - measured_baseline
scoped_paper_best = measured_baseline + frac_closed × agent_headroom
target = measured_baseline + 0.5 × (scoped_paper_best - measured_baseline)
```

Then `_build_reward_curve()` recomputes the 7-point piecewise-linear curve from the new anchors.

Three files get rewritten:
- **claims.json** — baseline_value, target_value, paper_best_value, reward_thresholds, `_meta.scope_rescaled=true`
- **instruction.md** — every occurrence of the old numbers replaced with rescaled ones (regex, word-boundary-safe)
- **seed/log.jsonl** — baseline entry updated with measured value

evaluate.py is NOT regenerated — it reads thresholds from claims.json at runtime, so the new curve takes effect automatically.

## Steps 5-7: Runtime (harbor)

After the pipeline finishes, the task directory is handed to harbor for execution.

### Step 5: Agent trains

Harbor builds the docker image from `environment/Dockerfile`, creates a sandbox with `/mnt/models` mounted (read-write), and drops Claude Code (opus 4.7) into the container.

The agent's prompt is `instruction.md`. It has 4+ hours to:
1. Install ML dependencies via `uv pip install`
2. Read the lab notebook, explore the data
3. Train a model (SFT, DPO, RL, whatever it decides)
4. Save the best checkpoint to `/app/checkpoints/`

The agent does NOT have access to `/mnt/eval`. It does NOT see evaluate.py. It does NOT see claims.json's reward thresholds.

### Step 6: Verifier runs

When the agent exits (or times out), harbor creates a **separate verifier sandbox** from the same image, but with BOTH volumes mounted:
- `/mnt/models` (the agent's workspace, including `/app/checkpoints/`)
- `/mnt/eval` (the held-out benchmark data — agent never saw this)

Harbor runs `tests/test.sh`:

```bash
#!/bin/bash
set -uo pipefail
echo "=== Evaluator: Beat Math500 ==="
mkdir -p /logs/verifier /logs/artifacts
cd /app
python3 /tests/evaluate.py
if [ $? -ne 0 ]; then
    echo "0.0" > /logs/verifier/reward.txt
    echo "=== FAILED (evaluate.py crashed) ==="
    exit 1
fi
echo "=== Done ==="
```

If evaluate.py crashes for any reason (missing dependency, OOM, data issue), reward is 0.0.

### Step 7: Scoring

`evaluate.py`'s `main()` function:

1. Reads `/tests/claims.json` — extracts `reward_thresholds` and `base_model_path`
2. Discovers the agent's best checkpoint in `/app/checkpoints/` (handles LoRA adapters, full checkpoints, checkpoint-N dirs)
3. Calls `run_benchmarks(checkpoints, base_model_path)`:
   - Loads held-out data from `/mnt/eval/.parsed/<repo>/<split>.parquet`
   - Runs inference via vLLM (greedy decoding, paper-specific params)
   - Grades answers using paper-verbatim grading code
   - Returns `{"primary": {"agent": accuracy, "base_model": base_accuracy}}`
4. Interpolates reward from the threshold curve:
   - Below baseline → 0.0
   - Between two thresholds → linear interpolation
   - Above the curve → 1.0
5. Writes the reward float to `/logs/verifier/reward.txt`

Harbor reads `reward.txt` and records it in `result.json`.

## The two-volume isolation

This is the structural guarantee that makes the whole thing work:

```
AGENT SANDBOX                    VERIFIER SANDBOX
─────────────                    ────────────────
/mnt/models  ← read/write       /mnt/models  ← read-only
                                 /mnt/eval    ← read-only (agent NEVER sees this)
/app/        ← agent workspace   /app/        ← same workspace (agent's outputs)
                                 /tests/      ← claims.json + evaluate.py
```

The agent CAN:
- Read/write anything in `/mnt/models`
- Install packages, run arbitrary code
- Overwrite benchmark files in `/mnt/models/.parsed/`

The agent CANNOT:
- See `/mnt/eval` (not mounted)
- Modify evaluate.py or claims.json (in `/tests/`, read-only at runtime)
- Know the reward thresholds
- See the eval protocol or grading code

The verifier reads benchmark data from `/mnt/eval`, not `/mnt/models`. So even if the agent overwrites the benchmark files in `/mnt/models`, the verifier scores against its own clean copy. This isn't a rule the agent follows — it's a mount that the agent's container doesn't have. You can't tamper with a volume you can't see.

## The three images

Why three separate Modal images for one task:

| Image | What it adds | Used by | Why separate |
|-------|-------------|---------|-------------|
| `image` | Nothing (bare base) | `smoke()` | Fast structural check, no GPU |
| `eval_image` | Claude Code CLI | `generate_eval()` | Agent needs Claude to write code |
| `measure_image` | vllm, torch, pandas, pyarrow | `measure_baseline()` | ML deps baked in to sidestep Modal's `/__modal/deps` shadowing bug |

The shadowing bug: Modal puts its own `typing_extensions` and `pydantic` at `/__modal/deps` in every container. If you pip-install vllm at runtime, Python finds Modal's old `typing_extensions` first and vllm crashes. Baking vllm into the image at build time means it's installed before Modal's injection happens, so it wins the import race.

## Failure modes

From the ETR run (the first shipped paper):

### 1. Verifier crash (reward = 0.0)

evaluate.py crashed with `ModuleNotFoundError: No module named 'pandas'`. The verifier sandbox (from the minimal Dockerfile) didn't have pandas. The eval-gen prompt at the time incorrectly told the agent that foundation libs were pre-installed.

**Fix shipped:** prompt now says "assume NOTHING is pre-installed" and makes the agent list every dependency in a `uv pip install` call inside `run_benchmarks()`.

### 2. Grader mismatch (4.4pp gap)

The agent used `math_verify` (lenient) and got 83.60%. The verifier used the paper's PRM800K grader (strict) and got 79.20%. Same model, same outputs. The entire gap is answer formatting — `\text{Evelyn}` vs `Evelyn`, that kind of thing, times 500 problems.

**Lesson:** this is why the verbatim-copy mandate exists. Reconstructing a grader from memory — even when you know the recipe — drifts on edge cases that cost real points.

### 3. Method ceiling

Plain SFT got the agent to 79.20% (reward 0.282). The target was 81.456. The paper's actual method — entropy trend reward in GRPO — is what closes that gap. The agent never discovered it because the task didn't leak it. That's the system working as designed.

## What reward = 0 looks like

The ETR run got 0.282 — a partial success. Here's what total failures look like.

**Verifier crash** (real, from the ETR run's first attempt):
```
=== Evaluator: Beat Math500 ===
Traceback (most recent call last):
  File "/tests/evaluate.py", line 542, in run_benchmarks
    import pandas as pd
ModuleNotFoundError: No module named 'pandas'
=== FAILED (evaluate.py crashed) ===
```
`reward.txt` contains `0.0`. `result.json` records `"rewards": {"reward": 0.0}` with no exception — the crash is in the grading script, not harbor.

**Agent didn't save a checkpoint** (illustrative — what the verifier output would look like):
```
[eval] Base model only: /mnt/models/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B
[eval] Base accuracy: 77.20%
[eval] Final: accuracy=77.20%  reward=0.000000
```
`find_best_checkpoint()` found nothing in `/app/checkpoints/`. evaluate.py scored the base model. 77.20 <= baseline (77.2), so reward = 0.0.

**Agent trained but made it worse** (illustrative):
```
[eval] Base model: /mnt/models/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B
[eval] Base accuracy: 77.20%
[eval] Agent (full ckpt): /app/checkpoints
[eval] Agent accuracy: 76.80%
[eval] Final: accuracy=76.80%  reward=0.000000
```
76.80 < baseline, so reward = 0.0. The agent made the model worse.

**Agent timed out:**
Harbor hard-kills the sandbox at `agent.timeout_sec`. Whatever's in `/app/checkpoints/` at that moment gets scored. If the rsync daemon synced a checkpoint to the volume, it might score above zero. If the agent was mid-training and never saved — reward = 0.0.
