# Information Barrier

This is the thing the whole system is built around. Some passes know the paper's solution. The agent and the passes that write what the agent sees do not. If this breaks, nothing else matters — the agent isn't discovering anything, it's reading the answer off its instruction sheet.

## Which passes know what

```
KNOWS THE SOLUTION                    BLINDED
─────────────────                     ───────
Pass 2a: solution_brief               Pass 4: stripped of solution_brief,
Pass 2b: eval_protocol, eval_type,            citations, eval_protocol
         eval_derivation              Pass 5: deterministic template (no LLM)
Pass 3:  diagnosis_steps,             Skeleton: deterministic codegen
         block_list                   Leak audit: sees solution_brief
                                               (to detect leaks, not to generate)
                                      The agent: sees NOTHING
```

Pass 4 runs BEFORE pass 3 in the orchestrator. This is intentional — pass 4 can't accidentally be influenced by pass 3's diagnosis steps because they don't exist yet when pass 4 runs.

## The strip function

`phases/analyze/pass4.py:_strip_for_barrier()` removes fields from `problem_extraction` before the pass 4 LLM sees it:

**Top-level blocked:**
- `solution_brief` — the actual method
- `suitability`, `suitability_reasoning` — leak the paper's scope
- `failed_approaches` — narrow the search space

**Baseline blocked:**
- `metric_value_citation` — often names the method
- `table_reference` — paper table references can identify the approach

**Benchmark blocked:**
- `eval_protocol` — method-as-measurement leak vector (the eval procedure IS the paper's method for probing/interpretability papers)
- `eval_type`, `eval_derivation` — same risk

What pass 4 DOES see: benchmark name, hf_id, split, metric name, metric direction, baseline value, target value, verified resources. Enough to frame "achieve X on Y starting from Z" — not enough to know HOW.

## Why pass 5 is deterministic

Pass 5 generates the agent's instruction.md. It uses **no LLM call**. Just a template with facts.

Previous versions had LLM-written "Background" sections. They leaked every time:

- **2604.04894 (AsymGRPO):** "policy must MAINTAIN DIVERSITY" → telegraphed asymmetric modulation
- **2604.02040:** "loses semantically important reasoning steps" → telegraphed semantic preservation
- **2604.03113 (PAFT):** "concentrating budget on fault region" → telegraphed edit-precision objective

The LLM's helpful explanations of "why the baseline fails" consistently described the paper's solution. The fix: don't ask the LLM. Template the facts (model, benchmark, metric, numbers) and stop.

## The five defense layers

### Layer 1: Deterministic pass 5

No LLM in instruction generation. Template: model + params, benchmark, metric, baseline, target, headroom. No "why it fails," no "what's wrong," no "promising directions."

### Layer 2: Pass 4 information barrier

`_strip_for_barrier()` removes solution fields. The task-framing LLM literally cannot see the answer.

### Layer 3: Pass 3 adversarial audit

Each diagnosis step is tested against two criteria:
- **Scaled-up test:** "If the agent just did more of this step, would it basically be the solution?"
- **Signal-reuse test:** "Does this step compute the paper's key observation?"

If either is true, the step leaks. Examples from the prompt:

**BAD** (leaks): "Run 3 short training runs with 3 different prompt templates" — because mixing templates IS the solution for a template-selection paper.

**GOOD** (safe): "Measure accuracy and average token count; stratify by difficulty" — observational, doesn't compute or construct the paper's method.

### Layer 4: Phase 4.5 whole-artefact leak audit

A frontier LLM reviewer reads ALL agent-visible files together:
- instruction.md
- NOTEBOOK.md
- references.md
- log.jsonl
- SETUP.md

Plus `solution_brief` and `block_list` as ground truth.

Question: "Given a PhD-level researcher with the agent's tool palette, could they rederive the paper's solution from ONLY these files?"

This is the only layer that catches compositional leaks — where each file looks harmless on its own but together they spell the answer. The PAFT task (03113) showed exactly this: five diagnosis steps, each fine individually, but if you follow all five you've basically executed the paper's analysis pipeline.

Up to 5 rewrite rounds. If it can't be cleaned, the pipeline stops.

### Layer 5: Block list regex

The dumbest layer, and it knows it. `validate_leak_scan` does word-boundary regex matching against `block_list.method_names`. If the literal string "F-DPO" shows up in instruction.md, this catches it.

Can't catch paraphrases or conceptual leaks. That's what layer 4 is for. This is just the last safety net.

## Block list contents

`block_list` has two fields:

- `method_names` — the paper's technique name and aliases. Populated by pass 3, seeded with `state.comprehension.primary_method` by the orchestrator. Benchmark names and metric names are explicitly stripped (they're load-bearing for the task description).
- `arxiv_ids` — the paper's own ID (always), plus predecessor/sibling papers from pass 3's analysis.

The alphaxiv wrapper in the agent's sandbox base64-encodes the block list and intercepts search/read calls, returning the CLI's native error messages for blocked papers so the agent can't distinguish a block from a real 404.

## Known limitations

1. **Pretraining contamination.** The block list stops the agent from reading the paper — it doesn't delete what the model already knows. Any 2024+ paper is in Claude's weights. "Rediscovery" might be "recall" for well-known methods.

2. **Per-step vs whole-artefact.** Layer 3 judges steps individually. Layer 4 judges the whole artefact. But layer 4 only runs on the final output — if a leaky step survives layer 3, it gets baked into files that layer 4 then has to rewrite. Multiple rewrite rounds handle this, but the budget is finite (5 rounds).

3. **Method names aren't always clean tokens.** "F-DPO" is easy to regex. "training on shorter examples with cosine annealing" is the method for some papers and a generic ML phrase for others. The block list errs toward method-specific names and relies on layer 4 for conceptual leaks.
