# What the Agent Sees

This is a concrete walkthrough of everything the agent has access to. Not what's "sealed" or "stripped" — what's actually there when Claude Code boots up inside the container.

## The prompt

Harbor passes the contents of `instruction.md` as the agent's prompt. Here's a real one (from the ETR paper, beat-math500):

```markdown
# Beat Math500

**Get `accuracy` >= 81.456.** Baseline: 77.2. Paper-best equivalent: 85.712. Higher is better.

`accuracy` = Pass@1 accuracy (%) under greedy decoding: the model's single generated
answer (extracted from \boxed{}) is compared to the ground-truth using the PRM800K
sympy-based grader.

## Time budget — NO automatic timer

You have **4 hours** wall-clock. There is NO tool, env var, or callback
that tells you time is running out; the sandbox is hard-killed when the
timeout hits and any unsaved state is LOST.

Do this at the very start of your first turn:

    date +%s > /app/_started_at
    echo $(( $(cat /app/_started_at) + 14400 )) > /app/_deadline

And periodically (every major iteration):

    echo "elapsed: $(( $(date +%s) - $(cat /app/_started_at) ))s  |  remaining: $(( $(cat /app/_deadline) - $(date +%s) ))s"

**Reserve the last ~10 minutes for saving your final checkpoint to
`/app/checkpoints/`.** A training run that converges to a great model
but dies before the checkpoint hits disk scores `base_accuracy` (zero
reward). The verifier reads from `/app/checkpoints/`, so nothing
uncommitted counts.

## Background

Baseline: `deepseek-ai/DeepSeek-R1-Distill-Qwen-7B` (7.6B parameters,
Qwen2ForCausalLM) on `MATH500` scores accuracy = 77.2. Paper-reported best
on the same metric is 85.712 (headroom 5.6). Your target is 81.456.

## Resources

- **Model**: DeepSeek-R1-Distill-Qwen-7B [Qwen2ForCausalLM] at
  `/mnt/models/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B` (15.2GB, pre-loaded)
- **Training data**: `zwhe99/DeepMath-103K` — train (103,022 examples)
  (via `load_dataset("zwhe99/DeepMath-103K", "default")`)
- **Benchmark**: `HuggingFaceH4/MATH-500`, config `"default"` — test (500 examples)
  - `/mnt/models/.parsed/HuggingFaceH4___MATH-500__default/test.parquet` (500 rows)
  Read with `pd.read_parquet()`. Do NOT train on these rows — they're the eval set.
- **API access**: Forwarded API keys live in `os.environ`. Inspect at runtime to
  see what's available.
- **Compute**: 8x A100-80GB, 4 hours.
- **Environment**: CUDA + Python + `uv` on a bare Ubuntu image. No ML packages
  pre-installed — install what you need via `uv pip install <pkg>`.
- **Tools**: `alphaxiv` CLI for searching and reading arxiv papers
  (`alphaxiv search "query"`, `alphaxiv read <arxiv-id>`, `alphaxiv paper <arxiv-id>`)

## How you're scored

Your result is scored on `accuracy`. Higher is better.

Save your best model to `/app/checkpoints/`. The verifier runs this protocol on it.

## Logging

    from lab.tracker import log_experiment
    log_experiment(
        name="short_name",
        config={"lr": 1e-4, "method": "..."},
        results={"accuracy": 0.123},
        notes="what you observed",
    )

Write `/app/experiments/REPORT.md` when done.
```

That's it. No mention of entropy, no mention of GRPO, no mention of trajectory shaping. Just: here's a model, here's data, beat this number.

## Files on disk

When the agent's container boots, `/app/` looks like this:

```
/app/
├── experiments/
│   ├── NOTEBOOK.md          # lab notebook with resources, time budget, generic next steps
│   ├── log.jsonl            # one baseline entry: {"accuracy": 77.2, "method": "baseline"}
│   └── references.md        # reading list — often empty after leak audit
├── lab/
│   ├── __init__.py
│   └── tracker.py           # log_experiment() → appends to log.jsonl
├── checkpoints/             # empty — agent saves trained model here
├── data/                    # empty — agent can use for working data
└── logs/                    # empty — verifier writes reward.txt here later
```

The NOTEBOOK.md has the same background as instruction.md, plus:
- Model sizes, architectures, licensing info
- Dataset column names and splits
- Time budget breakdown (estimated training hours, eval time, overhead)
- Generic next steps: reproduce baseline → diagnose → hypothesize → fix

## Mounted volumes

```
/mnt/models/                              # read-write
├── deepseek-ai/
│   └── DeepSeek-R1-Distill-Qwen-7B/     # 15.2GB, safetensors, tokenizer, config
├── .parsed/
│   └── HuggingFaceH4___MATH-500__default/
│       └── test.parquet                  # 500 rows — the benchmark (DO NOT TRAIN ON THIS)
├── .hf_datasets_cache/                   # HuggingFace datasets cache
└── _corpus/                              # training corpora (if any)
```

There is no `/mnt/eval`. The agent's container doesn't mount it. The agent can't see, stat, or access it in any way.

## Tools

- **uv** — package manager. `uv pip install torch transformers vllm` etc.
- **alphaxiv** — arxiv paper search and reading. But the block list filter intercepts calls:
  - `alphaxiv read 2604.05355` → returns an error (the paper being evaluated is blocked)
  - `alphaxiv search "entropy trend reward"` → results mentioning the blocked paper are filtered out
  - The agent sees what looks like normal alphaxiv errors, can't tell it's being filtered
- **git, curl, wget** — available for cloning repos, fetching data
- **Standard CUDA toolchain** — nvcc, nvidia-smi, all GPU tools

## What the agent does NOT see

- The paper (blocked by alphaxiv wrapper)
- The method name ("entropy trend reward", "ETR")
- evaluate.py (in `/tests/`, agent can't write there)
- claims.json (same — in `/tests/`)
- The reward thresholds or reward curve
- The eval protocol (how exactly the verifier grades answers)
- `/mnt/eval` (not mounted)
- `solution_brief` (never written to any agent-visible file)
- The diagnosis steps from pass 3 (never shipped — those are internal)
- Which papers are in the block list (base64-encoded, errors look natural)

## What the agent CAN figure out

Be honest about what's not fully sealed:

- **The benchmark itself is visible.** The agent can read the MATH-500 parquet and see every question. It just can't train on them (instruction says don't, but nothing structurally prevents it — the verifier reads from `/mnt/eval` so contamination doesn't help the agent's score, but it doesn't prevent it either).
- **The model's pretraining knowledge.** Claude (the agent) has read papers about GRPO, entropy shaping, etc. The block list prevents it from reading THIS specific paper, but the techniques themselves are in the model's weights. "Rediscovery" might partly be "recall."
- **Generic ML knowledge.** The agent knows SFT, DPO, RL, LoRA, GRPO exist. The task doesn't prevent trying any of them. On the ETR task, the agent chose SFT — not because it was told to, but because it decided that was the fastest path to improvement.
