# Installation

## Dependencies

paper2eval uses [uv](https://docs.astral.sh/uv/) for Python package management.

```bash
uv sync
```

### External tools

**Required:**

- **alphaxiv** — arxiv paper fetching, reading, citation tracing. Used in pregate (metadata), ingest (PDF download), and the agent's sandbox (paper search with block list filtering).
  ```bash
  curl -fsSL https://github.com/sigkillme0/alphaxiv-cli/releases/download/v0.5.4/alphaxiv-$(uname -m)-$(uname -s | tr A-Z a-z).tar.gz \
    | tar -xz -C /usr/local/bin
  ```

- **Modal** — cloud GPU infrastructure. Builds docker images, runs eval agents, hosts model volumes.
  ```bash
  modal setup
  ```

**Optional:**

- **gh** — GitHub CLI. The verify agent uses it to search for paper code repos. `gh auth login` to authenticate.
- **jihad proxy** — a local proxy service that rotates IPs and handles TLS fingerprinting for arxiv requests. arxiv rate-limits aggressively, and the pipeline fetches PDFs + metadata for every paper. jihad keeps you from getting blocked. Set `JIHAD_URL=http://localhost:9666` in `.env`. Without it, requests go direct with exponential backoff (slower, and you'll hit 429s on batch runs).

## Environment variables

Create `.env` in the project root:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Required for Modal phases (populate, build, agent runs)
MODAL_TOKEN_ID=ak-...
MODAL_TOKEN_SECRET=as-...

# Required for gated HuggingFace models
HF_TOKEN=hf_...

# Optional — forwarded to agent sandbox for API-route models
OPENAI_API_KEY=sk-proj-...

# Optional — LLM call tracing (every prompt/response/timing logged to file)
P2E_TRACE=/path/to/trace.jsonl
```

The pipeline loads `.env` via python-dotenv at startup.

## First run

```bash
# By arxiv ID
uv run paper2eval 2604.05355

# By URL
uv run paper2eval https://arxiv.org/abs/2604.05355

# Local PDF (skips pregate)
uv run paper2eval /path/to/paper.pdf
```

Output goes to `output/<paper-slug>/`.

### What happens

| Phase | Time | API cost | What |
|-------|------|----------|------|
| 0 — pregate | ~2s | ~$0.02 | Fetch metadata, go/no-go LLM call |
| 1 — ingest | ~2min | ~$1.50 | Vision API reads every page (2-3 passes) |
| 1b — verify | ~3min | ~$3-5 | Claude Code agent checks resources on HuggingFace |
| 2 — analyze | ~5min | ~$3 | Six LLM passes: problem, numbers, reward curve |
| 3 — scout | ~30s | ~$0.20 | GPU sizing (1 LLM call + math) |
| 4 — skeleton | ~1s | $0 | Deterministic codegen |
| 4.5 — leak audit | ~30s | ~$0.50 | Frontier LLM reviews agent-visible files |
| 4a — populate | ~5min | $0 | Modal downloads models/datasets |
| 4b — build | ~10min | ~$1 | Docker build + evaluate.py generation + baseline |
| 5 — validate | ~1s | $0 | Static structural checks |

**Total:** ~$5-10, ~40 minutes.

### Resume from checkpoint

Every phase saves to `state.json`. Crash on phase 4b? Don't re-run phases 0-3:

```bash
uv run paper2eval --resume output/2604-05355/state.json
```

### Validate only

```bash
uv run paper2eval --validate output/2604-05355/beat-math500
```

## Running on Modal

Generate tasks in the cloud (laptop can disconnect):

```bash
# One paper
uv run bin/generate_on_modal.py 2604.05355

# Several papers
uv run bin/generate_on_modal.py 2604.05355 2604.01591 2603.02436

# Grab results
modal volume get pe-gen-output / ./output-from-modal/
```

## Running the agent

After the pipeline produces a task, run the actual challenge:

```bash
# Single task
uv run bin/run_on_modal.py -p output/2604-05355/beat-math500

# pass@4 — four parallel agents, isolated workspaces
uv run bin/run_on_modal.py -p output/2604-05355/beat-math500 -k 4

# All tasks for a paper
uv run bin/run_on_modal.py -p output/2604-05355/
```

Harbor runs on a non-preemptible CPU container (`pe-runner`). It spins up preemptible GPU sandboxes for the agent. The entrypoint script syncs `/app/` to the model volume every 30 seconds for preemption recovery.

### Monitoring

```bash
uv run bin/peek.py --watch          # live status, polls every 30s
uv run bin/peek.py --tail 30        # recent agent actions
uv run bin/peek.py --report         # agent's REPORT.md
uv run bin/peek.py --exec "ls /app/checkpoints/"  # shell into sandbox
```

### Pulling results

Results land on the `pe-runner-output` Modal volume and sync to S3 (`paper2eval` bucket):

```bash
# Pull from Modal volume
modal volume get pe-runner-output jobs/beat-math500 ./results/

# The number that matters
jq '.verifier_result.rewards.reward' ./results/jobs/beat-math500/*/result.json

# Full harbor verdict (reward, exit code, timing)
jq . ./results/jobs/beat-math500/*/result.json

# Agent's reasoning trace (every tool call, every thinking block)
jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text' \
    ./results/jobs/beat-math500/*/agent_logs/claude-code.txt
```

### Inspecting a completed task

After a run finishes, here's how to look at what happened:

```bash
# What score did it get?
jq '.verifier_result.rewards.reward' ./results/jobs/beat-math500/*/result.json

# What did the verifier print?
cat ./results/jobs/beat-math500/*/verifier/test-stdout.txt

# What did the agent write? (pull the workspace from the models volume)
modal volume ls pe-2604-05355-models _workspace/run/app_backup/
modal volume get pe-2604-05355-models _workspace/run/app_backup/ ./agent-workspace/

# Agent's scripts
ls ./agent-workspace/*.py

# Agent's experiment log
cat ./agent-workspace/experiments/log.jsonl

# Agent's final report
cat ./agent-workspace/experiments/REPORT.md

# The trained model (big — 15GB+ for a 7B model)
ls -lh ./agent-workspace/checkpoints/

# What bash commands did the agent run?
jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Bash") | .input.command' \
    ./results/jobs/beat-math500/*/agent_logs/claude-code.txt

# How many tool calls of each type?
jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | .name' \
    ./results/jobs/beat-math500/*/agent_logs/claude-code.txt | sort | uniq -c | sort -rn
```

Results are also on S3 if you have the credentials (see `paper2eval-ui/.env`):

```bash
aws s3 ls s3://paper2eval/runs/beat-math500/ --endpoint-url https://t3.storage.dev
aws s3 cp s3://paper2eval/runs/beat-math500/result.json - --endpoint-url https://t3.storage.dev | jq .
```
