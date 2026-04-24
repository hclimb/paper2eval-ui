# Infrastructure

paper2eval runs on Modal for GPU compute and uses harbor to actually run the agent. If you're debugging a run, you need to understand three things: the volume layout, the image architecture, and how paper2eval hands off to harbor.

## Modal

All GPU work runs on Modal: docker builds, evaluate.py generation, baseline measurement, agent runs, and verifier scoring.

### Volumes

Each paper gets two persistent Modal volumes:

- **`pe-<paper-id>-models`** — mounted at `/mnt/models` in both agent and verifier sandboxes. Contains base model weights, training datasets, benchmark parquets, external corpora, and the HuggingFace dataset cache. The agent reads and writes here.

- **`pe-<paper-id>-eval`** — mounted at `/mnt/eval` in the verifier sandbox ONLY. Same benchmark parquets, but the agent never sees this volume — harbor just doesn't mount it into the agent's container. So even if the agent overwrites the benchmark copy in `/mnt/models`, the verifier scores against its own clean copy.

A third volume, **`pe-runner-output`**, stores harbor's per-trial results: `result.json`, `manifest.json`, agent logs, verifier logs.

### The three-image architecture

`build_on_modal.py` generates three Modal functions with three different images:

**`image` (smoke test):**
Bare nvidia/cuda base + python + uv. No ML deps. Used for structural checks (does evaluate.py exist? does it have the required functions?). Fast to build, no GPU needed.

**`eval_image` (evaluate.py generation):**
Base + Claude Code CLI. The eval-gen agent runs here on GPU — it clones the paper's repo, reads the model README, and writes evaluate.py. Drops to a non-root `evaluator` user to avoid Claude Code's root permission prompts.

**`measure_image` (baseline measurement):**
Base + vllm, torch, pandas, pyarrow, sympy **baked into the image** — not pip-installed at runtime. Why? Modal injects its own copies of `typing_extensions` and friends into every container at startup. If you pip-install vllm at runtime, it imports Modal's old `typing_extensions` instead of the one it just installed, and crashes. Baking everything into the image at build time sidesteps this completely. This fix is what unblocked the first shipped paper.

### GPU fallback

Scout picks a primary GPU tier. `build_on_modal.py` also lists fallback tiers derived from `SCOUT_GPU_TIERS` in case the primary isn't available. Modal tries them in order.

## Harbor

Harbor (`harbor==0.4.0`, pip package) is an external framework for running AI agent evaluations. It handles the container lifecycle: build the image, create a sandbox, run the agent with a timeout, then run the verifier in a separate sandbox and collect the reward. paper2eval generates the task; harbor executes it. We don't own harbor — it's a dependency, installed into the Modal runner image via `uv_pip_install` in `bin/run_on_modal.py`.

### The handoff: `bin/run_on_modal.py`

This is the bridge. It:

1. Tars the task directory (Dockerfile, instruction.md, tests/, environment/)
2. Submits it to the `pe-runner` Modal app as a FunctionCall
3. Records the FC-ID in `_function_calls.json` for tracking
4. Exits — the laptop can disconnect

The `pe-runner` app:
1. Unpacks the task into a harbor-compatible layout
2. Calls harbor with the agent config (claude-code, opus-4-7, version pin)
3. Harbor builds the image, creates the sandbox, runs the agent, runs the verifier
4. Results go to `pe-runner-output` volume

### Sandbox lifecycle

Harbor creates two sandboxes per trial:

**Agent sandbox:**
- Built from `environment/Dockerfile`
- Mounts: `/mnt/models` (read-write)
- Does NOT mount `/mnt/eval` — structurally isolated
- Runs claude-code with `--permission-mode=bypassPermissions`
- Prompt: contents of `instruction.md`
- Timeout: `agent.timeout_sec` from `task.toml`

**Verifier sandbox:**
- Same image as agent
- Mounts: `/mnt/models` (read-only) AND `/mnt/eval` (read-only)
- Runs `tests/test.sh` → `tests/evaluate.py`
- Reads checkpoint from `/app/checkpoints/` (written by agent)
- Writes reward to `/logs/verifier/reward.txt`
- Timeout: `verifier.timeout_sec` from `task.toml`

### Preemption recovery

GPU sandboxes are preemptible (cheaper). The `entrypoint.sh` script handles this:

1. Volume health check: verify `/mnt/models` has at least one `config.json`
2. Sync `/app/` to volume-backed workspace every 30 seconds via rsync daemon
3. Checkpoint-aware atomicity: incomplete checkpoints (missing `trainer_state.json`) are excluded from sync; complete ones are staged then renamed
4. Claude session symlinked to volume for conversation continuity after preemption
5. On restart: rsync restores `/app/` from the volume backup

### Results layout

After a run completes, `pe-runner-output` contains:

```
jobs/<task-slug>/<timestamp>/
├── <trial-name>/
│   ├── result.json          # THE FINAL REWARD — verifier_result.rewards.reward
│   ├── config.json          # harbor config (agent, environment, verifier settings)
│   ├── trial.log            # harbor's command execution log
│   ├── artifacts/
│   │   └── manifest.json    # provenance metadata
│   └── verifier/
│       ├── reward.txt       # raw reward float
│       └── test-stdout.txt  # evaluate.py stdout/stderr
├── result.json              # run-level aggregate
├── manifest.json            # job provenance
├── config.json              # job config
└── job.log                  # harbor job log
```

Results also sync to S3 (`paper2eval` bucket) under `runs/<task-slug>/` and `tasks/<task-slug>/`.

## API-only models

Models over 80GB don't fit on a single GPU node's volume. Scout marks them as `api_only_models` — verified but not downloaded.

The agent accesses them at runtime through provider APIs. Here's how the keys flow (from `bin/run_on_modal.py`):

1. **`agent_keys.json`** in the task directory lists which env var names the agent needs (e.g., `["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]`). Skeleton writes it; the operator makes sure those vars are set in their local shell.

2. **`bin/run_on_modal.py:481-512`** reads `agent_keys.json`, looks up each key in the local shell's `os.environ`, and forwards them into the harbor sandbox via `--ek` (environment key) flags. Ad-hoc keys from the CLI (`--env-key`) are merged in too, deduped.

3. **Harbor** injects them as environment variables in the agent sandbox. The agent sees them in `os.environ`. instruction.md tells it: "API access: Forwarded API keys live in `os.environ`. Inspect at runtime to see what's available."

Supported providers depend on what keys you have set locally. The pipeline passes through whatever `agent_keys.json` asks for — OpenAI, Anthropic, OpenRouter, DeepSeek, HuggingFace, anything.

`TaskSpec.api_models` carries the list. Only models the agent might actually call get included — teachers, LLM judges, frontier-scale evaluators. Models that are just mentioned for comparison don't get API access.

## claims.json as runtime contract

Reward thresholds aren't hardcoded in evaluate.py. It reads them from `claims.json` every time it runs:

```python
with open("/tests/claims.json") as f:
    claims = json.load(f)
thresholds = claims["reward_thresholds"]
```

This is why rescaling works — `rescale.py` rewrites claims.json after measuring the real baseline, and evaluate.py picks up the new numbers without being regenerated. The script doesn't need to change; only the data file does.
