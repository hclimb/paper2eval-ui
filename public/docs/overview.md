# paper2eval

paper2eval turns arxiv papers into sealed research challenges. Feed it a paper, and it produces a task where an AI agent has to beat the paper's baseline — without ever seeing the paper, the method, or the solution.

The agent gets a base model, training data, a benchmark, a target metric, and a GPU. If it runs the right experiments and beats the target, it scores. If it hacks the eval, writes a report without training, or memorizes the answer from pretraining, it gets zero.

## What it does

The pipeline reads a paper, extracts the problem and the numbers, verifies every resource on HuggingFace, computes a reward curve, and assembles a completely sealed task directory. The key design: six LLM passes extract the paper's method, but there's a wall between them — the early passes know the solution, the later passes and the agent never see it.

Seven phases, ~$5-10 of API spend per paper, ~40 minutes on Modal. There's no LLM in the scoring loop — `evaluate.py` runs the benchmark, computes the metric, looks up the reward, and writes it to disk.

## What it produces

A task directory per paper containing everything needed to run the challenge:

- **instruction.md** — what the agent sees: goal, resources, time budget, scoring criteria
- **claims.json** — the eval contract: metric, baseline, target, reward curve, model/data allowlists
- **evaluate.py** — benchmark runner written by a Claude Code agent using the paper's own grading code
- **Dockerfile** — bare CUDA + Python + uv image, agent installs ML deps at runtime
- **task.toml** — harbor config: GPU type/count, timeouts, difficulty
- **populate_volume.py** — downloads models/datasets/benchmarks onto Modal volumes

The task is compatible with harbor (`harbor==0.4.0`, installed via pip on the Modal runner), which orchestrates the agent run: builds the image, drops Claude Code into the container, and runs the verifier when the agent finishes.

## The information barrier

This is what the whole system is built around. Passes 2a/2b/3 know the paper's solution (via `solution_brief`). Passes 4/5 and the agent never see it. Five layers keep it from leaking:

1. **Pass 5 is fully deterministic** — no LLM prose means no creative leaking
2. **Pass 4 information barrier** — solution fields are stripped before the LLM sees the task
3. **Pass 3 adversarial audit** — each diagnosis step tested for "is this the solution in disguise?"
4. **Phase 4.5 whole-artefact leak audit** — frontier LLM reads everything the agent will see alongside `solution_brief`
5. **Block list regex** — last-line defense catching literal method name occurrences in agent-visible files

## First shipped result

Paper: [ETR: Entropy Trend Reward for Efficient Chain-of-Thought Reasoning](https://arxiv.org/abs/2604.05355) (2604.05355)

The agent was told: "get accuracy >= 81.456 on MATH-500, starting from baseline 77.2, using DeepSeek-R1-Distill-Qwen-7B." It never saw the paper, the method name ("entropy trend reward"), or any hints about GRPO trajectory shaping.

The agent chose two-stage supervised fine-tuning on filtered DeepMath-103K reasoning traces. Final accuracy: 79.20% (PRM800K grader). Reward: **0.282** — beat baseline by 2.8pp but fell short of the target. The paper's actual method (entropy-aware reward shaping in GRPO) is what closes the remaining gap, which is the point.

## Docs

- [Installation](getting-started/installation.md) — setup, env vars, first run
- [Pipeline](architecture/pipeline.md) — the 7 phases end-to-end
- [What the Agent Sees](tasks/agent-perspective.md) — concrete instruction.md, files, volumes, tools, what's hidden
- [Information Barrier](architecture/information-barrier.md) — how solution knowledge is compartmentalized
- [Verifier and Reward](architecture/verifier-and-reward.md) — evaluate.py lifecycle, validation, baseline, scoring
- [Reward Curve](architecture/reward-curve.md) — scoring math and rescaling
- [Infrastructure](architecture/infrastructure.md) — Modal, harbor, volumes, images
- [Task Format](tasks/task-format.md) — directory structure and file reference
- [claims.json](tasks/claims-json.md) — the eval contract schema
- [evaluate.py Contract](tasks/evaluate-contract.md) — the evaluator API
