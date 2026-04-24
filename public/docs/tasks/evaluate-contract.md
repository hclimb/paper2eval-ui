# evaluate.py Contract

`evaluate.py` is the grading script. A Claude Code agent writes it during phase 4b by cloning the paper's GitHub repo and copying their eval code. It runs in the verifier sandbox after the agent finishes.

The agent never sees it. It lives in `tests/`, and the agent's container doesn't have write access to that directory.

## Required API

### `run_benchmarks(checkpoints: list, base_model_path: str) -> dict`

Evaluates the agent's checkpoint and the base model on the benchmark.

**Parameters:**
- `checkpoints` — list of checkpoint paths. Usually `["/app/checkpoints"]` or `[]` for base-only evaluation.
- `base_model_path` — path to the base model on `/mnt/models` (from `claims.json`)

**Returns:**
```python
{
    "primary": {
        "agent": float,      # agent's checkpoint metric value
        "base_model": float   # base model metric value (fresh measurement)
    }
}
```

Both are always fresh measurements — `base_model` is never a hardcoded constant. This is how the pipeline catches trivial-pass situations (base model already beats the target).

### `main() -> None`

Entry point for the verifier. Reads claims.json, discovers the best checkpoint, calls `run_benchmarks()`, interpolates reward, writes the result.

```python
def main():
    with open("/tests/claims.json") as f:
        claims = json.load(f)
    
    thresholds = claims["reward_thresholds"]
    base_model_path = claims["base_model_path"]
    
    ckpt = find_best_checkpoint("/app/checkpoints")
    checkpoints = [ckpt] if ckpt else []
    
    results = run_benchmarks(checkpoints, base_model_path)
    agent_acc = results["primary"]["agent"]
    
    reward = interpolate_reward(agent_acc, thresholds)
    
    os.makedirs("/logs/verifier", exist_ok=True)
    with open("/logs/verifier/reward.txt", "w") as f:
        f.write(str(reward))
```

Must have an `if __name__ == "__main__": main()` guard.

## Paths

| Path | Mount | Who reads | Contents |
|------|-------|-----------|----------|
| `/tests/claims.json` | Image COPY | evaluate.py | Reward thresholds, model path, metadata |
| `/tests/evaluate.py` | Image COPY | Verifier (harbor) | This file |
| `/mnt/eval/.parsed/<repo>/<split>.parquet` | eval volume | evaluate.py | Held-out benchmark data |
| `/mnt/models/<model-id>` | models volume | evaluate.py | Base model weights |
| `/app/checkpoints/` | Agent workspace | evaluate.py | Agent's trained model |
| `/logs/verifier/reward.txt` | Verifier output | Harbor | Final reward float |

**This is important:** eval data MUST come from `/mnt/eval`, not `/mnt/models`. The agent can write to `/mnt/models` — if evaluate.py reads the benchmark from there, the agent could overwrite the answers. The validate phase checks for this with an AST scan.

## Checkpoint discovery

`find_best_checkpoint(checkpoints_dir)` searches `/app/checkpoints/` in order:

1. Directory itself has `adapter_config.json` or `config.json` → it IS the model
2. Named subdirs: `best_model/`, `best/`, `final/` → check for config files
3. `checkpoint-N/` subdirs → pick highest step number

Handles both LoRA adapters (`adapter_config.json`) and full checkpoints (`config.json`).

When a LoRA adapter is detected, evaluate.py loads the base model with `enable_lora=True` and evaluates both base (no adapter) and agent (with adapter) in a single vLLM instance. For full checkpoints, it evaluates sequentially (base model, free GPU memory, then checkpoint).

## Dependency installation

Paper-specific dependencies (e.g., `pylatexenc` for LaTeX grading) are installed inside `run_benchmarks()`:

```python
subprocess.check_call(
    ["uv", "pip", "install", "--system", "--quiet", "pylatexenc"]
)
```

The big libs (vllm, torch, pandas, transformers) need to already be in the environment. In the verifier sandbox they come from the Dockerfile. In `measure_baseline` they're baked into the Modal image. The first shipped run crashed because pandas was missing from the verifier — that's how we learned this the hard way.

## No network access

evaluate.py can't use the network. No `urllib`, `requests`, `httpx`, `curl`, `wget`, `git`, `socket` — nothing that talks to the internet. Everything comes from the mounted volumes. The static validator scans the AST for banned imports.

## TASK_UNBUILDABLE

If the eval-gen agent determines the benchmark has no usable held-out data or the evaluation is fundamentally impossible, it writes a stub:

```python
def main():
    print("TASK_UNBUILDABLE: <reason>", file=sys.stderr)
    sys.exit(2)

def run_benchmarks(checkpoints, base_model_path):
    print("TASK_UNBUILDABLE: <reason>", file=sys.stderr)
    sys.exit(2)
```

Exit code 2 signals honest refusal. The pipeline marks the task `unbuildable` and extracts the reason from `_unbuildable_report.md`.

## Validation gates

evaluate.py passes through two validation stages:

### Static checks (`eval_gen.py:_validate_eval_static()`)

1. **Syntax:** Python AST parses without error
2. **Required functions:** `run_benchmarks` and `main` exist in the module
3. **Eval data leak:** No reads from `/mnt/models` for benchmark data (structural reward-hack defense)
4. **TASK_UNBUILDABLE:** Detected via `sys.exit(2)` pattern

### LLM judge (`eval_gen.py:_judge_eval_implementation()`)

Reads the script alongside `eval_protocol`, `eval_derivation`, and `benchmark_scope`. Decides whether they match. Fails on:

- Loading different data than the scope allows
- Computing a different metric
- Adding/removing filters the protocol doesn't describe
- Silent substitution of unavailable data

Implementation details (variable names, code style) are not the judge's call.

## Grader fidelity

The eval-gen agent is told to copy grading code **verbatim** from the paper's repo — not reconstruct it from memory, not "improve" it. This matters more than you'd think. Tiny differences in answer normalization (`\text{Evelyn}` vs `Evelyn`, `(2, 4)` vs `(2,4)`) add up to multi-percentage-point score gaps.

On the ETR paper, the agent's own `math_verify` grader said 83.60%. The paper's PRM800K grader said 79.20%. Same model, same outputs. 4.4 percentage points of pure grader strictness. That's the difference between "beat the target" and "didn't."
