# Task Format

A task directory is everything you need to run one challenge: build the container, drop an agent in, and score what it produces.

## Directory structure

```
<task-slug>/
├── instruction.md                    # Agent's prompt: goal, resources, scoring
├── task.toml                         # Harbor config: GPU, timeouts, difficulty
├── SETUP.md                          # Operator checklist
├── build_on_modal.py                 # Smoke test + eval gen + baseline measurement
├── agent_keys.json                   # API key manifest (operator fills in)
│
├── environment/                      # Docker build context
│   ├── Dockerfile                    # nvidia/cuda + python + uv, no ML libs
│   ├── alphaxiv-filter.sh            # Launcher for arxiv CLI wrapper
│   ├── alphaxiv_wrapper.py           # Block list filter (base64-encoded)
│   ├── entrypoint.sh                 # Volume health + rsync daemon
│   ├── boot.sh                       # ENTRYPOINT wrapper
│   ├── claude-wrapper-env.sh         # Session persistence across preemption
│   ├── requirements.txt              # Initially empty (agent installs at runtime)
│   ├── lab/
│   │   ├── __init__.py
│   │   └── tracker.py                # Experiment logging: log_experiment() → log.jsonl
│   └── seed/
│       ├── NOTEBOOK.md               # Lab notebook: resources, time budget, next steps
│       ├── log.jsonl                  # One baseline entry (seeded)
│       └── references.md             # Reading list (titles + IDs, no relevance notes)
│
├── tests/                            # Verifier suite
│   ├── claims.json                   # THE eval contract (see claims-json.md)
│   ├── evaluate.py                   # Benchmark runner (see evaluate-contract.md)
│   └── test.sh                       # Harbor entry: runs evaluate.py, writes 0.0 on crash
│
└── _leak_audit.json                  # Audit trail (rounds, assessments, rewrites)
```

**Per-paper (shared across tasks):**

```
output/<paper-slug>/
├── state.json                        # Pipeline state checkpoint (resumable)
├── populate_volume.py                # Downloads models/datasets to Modal volumes
├── populate_volume.log               # Populate stdout
├── verify_log.json                   # Resource verification audit
├── _verify_work/
│   └── verified_resources.json       # Raw verification output
└── build-logs/
    ├── build-<slug>-ok.log           # Successful build stdout
    └── build-<slug>-fail.log         # Failed build stdout (if any)
```

## File reference

### instruction.md

What the agent sees as its prompt. Sections:

- **Title + goal:** "Get `accuracy` >= 81.456. Baseline: 77.2. Paper-best equivalent: 85.712."
- **Time budget:** Wall-clock hours, instructions to track with `date +%s`, reserve last 10min for checkpoint save
- **Background:** Model + params, benchmark, metric = baseline, headroom. Facts only — no "why it fails"
- **Resources:** Model paths, `load_dataset()` snippets, benchmark parquet paths, API access, compute, tools
- **How you're scored:** Metric name + direction. "Save your best model to `/app/checkpoints/`."
- **Logging:** `log_experiment()` usage example, "write REPORT.md when done"

If the measured baseline differed from the paper's, all numbers in here are the rescaled versions. The text comes from pass 5's template (no LLM), and the resources section is filled in by skeleton.

### task.toml

Harbor configuration:

```toml
schema_version = "1.1"

[task]
name = "paper2eval/task-01"
description = "..."

[metadata]
difficulty = "medium"
category = "ml-research"
tags = ["ml-research", "math500"]

[environment]
build_timeout_sec = 1800.0
cpus = 16
memory_mb = 131072         # 128 GB
storage_mb = 204800         # 200 GB
gpus = 8
gpu_types = ["A100-80GB"]
allow_internet = true

[agent]
timeout_sec = 14400.0       # 4 hours

[verifier]
timeout_sec = 18000.0       # 5 hours
```

GPU type, count, and timeouts come from scout's per-task overrides.

### Dockerfile

Minimal image. Agent installs ML packages at runtime via `uv pip install`.

```dockerfile
FROM nvidia/cuda:12.6.0-devel-ubuntu22.04
RUN apt-get update && apt-get install -y python3 python3-dev python3-venv python3-pip \
    git curl wget rsync build-essential && ln -sf /usr/bin/python3 /usr/bin/python
# uv for package management
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
# alphaxiv CLI for paper search
RUN curl -fsSL https://github.com/sigkillme0/alphaxiv-cli/releases/download/v0.5.4/...
# Lab and seed files baked into image
COPY lab /app/lab
COPY seed/NOTEBOOK.md /app/experiments/NOTEBOOK.md
COPY seed/log.jsonl /app/experiments/log.jsonl
COPY seed/references.md /app/experiments/references.md
COPY ../tests /tests  # verifier reads from here
ENTRYPOINT ["/usr/local/bin/boot.sh"]
```

### alphaxiv_wrapper.py

Python wrapper around the alphaxiv CLI. Embeds the block list as a base64-encoded JSON string. Intercepts `alphaxiv search` and `alphaxiv read` calls:

- Search results containing blocked arxiv IDs are filtered out
- `alphaxiv read <blocked-id>` returns the CLI's native error message
- The agent cannot distinguish a block from a real 404

### SETUP.md

Operator checklist. Short — just GPU requirements, timeout, and a reminder to run `populate_volume.py`. Example from the ETR task:

```markdown
# Task Setup
- [ ] GPU: 8x A100-80GB
- [ ] Timeout: 21h
- [ ] Volume populated: `modal run populate_volume.py`
```

### boot.sh

Three lines. Sources `entrypoint.sh` and execs whatever CMD was passed (usually `sleep infinity`):

```bash
#!/bin/bash
source /usr/local/bin/entrypoint.sh
exec "$@"
```

Exists because the Dockerfile replaces nvidia's default entrypoint with this.

### entrypoint.sh

The real startup script (~156 lines). Runs when the container boots:

1. Verify `/mnt/models` is populated (at least one `config.json`, otherwise the volume mount failed)
2. Sync `/app/` to the volume-backed workspace (restores state after preemption)
3. Symlink Claude Code's session directory to the volume so conversation history survives a preemption kill
4. Check GPU count
5. Start a background rsync daemon that mirrors `/app/` to the volume every 30 seconds, with checkpoint-aware atomicity (incomplete checkpoints without `trainer_state.json` are skipped; complete ones are staged to a temp dir then renamed)

### claude-wrapper-env.sh

This is the big one (~270 lines). Sourced via `BASH_ENV` in every bash process the agent opens. It defines a `claude()` wrapper function that handles:

- **Workspace isolation:** writes a workspace key so the sync daemon knows which backup dir to use
- **Preemption recovery:** on reboot, restores `/app/` from the volume backup, finds valid checkpoints, and sends a resume message telling the agent what state it's in and which checkpoints survived
- **Session resume:** saves Claude Code's session ID to the volume. On reboot, reads it back and uses `--resume` to continue the conversation from where it was killed
- **Completion detection:** monitors `REPORT.md` age + GPU activity. When the report has been stable for 30 minutes and no GPU processes are running, closes Claude's stdin so it exits cleanly instead of sitting forever waiting for the next hourly ping
- **Hourly time pings:** sends "N hours remaining" as real user messages via a FIFO pipe (suppressed once REPORT.md exists to avoid resetting the stability window)

### seed/log.jsonl

One baseline entry:

```json
{"run_id": "exp_001", "name": "baseline_evaluation", "config": {"model": "...", "method": "baseline"}, "results": {"accuracy": 77.2}, "notes": "Baseline (measured on scoped data).", "gpu_seconds": 900}
```

The seeded run ID (`exp_001`) is checked by the NOP validator — only seeded IDs should exist before the agent runs.

### seed/NOTEBOOK.md

Lab notebook the agent sees. Contains:
- Background (model, benchmark, baseline, target — same as instruction.md)
- Available resources (models with size/arch, datasets with columns/splits)
- Verification notes (sizes, licensing, access)
- Time budget breakdown (training steps, sec/step, estimated hours)
- Generic next steps: reproduce baseline → diagnose → hypothesize → fix

No method hints anywhere. references.md is often empty on purpose — the leak audit tends to strip anything that points toward the solution.

### _leak_audit.json

Audit trail from phase 4.5:

```json
[
  {
    "round": 1,
    "clean": true,
    "assessment": "The agent-visible files describe only the generic task...",
    "rewrites": [],
    "applied": [],
    "errors": []
  }
]
```

Multiple rounds appear when the auditor found and rewrote leaking spans.

## After the agent runs

The agent's workspace and results end up in:

**Modal volumes:**
- `pe-<paper-id>-models:_workspace/run/app_backup/` — rsync'd agent workspace (scripts, logs, checkpoints)
- `pe-runner-output:jobs/<task-slug>/<timestamp>/` — harbor trial results

**S3 (`paper2eval` bucket):**
- `runs/<task-slug>/` — result.json, agent_logs, verifier_logs, experiments
- `tasks/<task-slug>/` — task definition + `_runs/<timestamp>/` with full workspace archive
