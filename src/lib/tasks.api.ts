import { createServerFn } from '@tanstack/react-start'
import { markdownToHtml } from './markdown'
import { fetchRunList } from './runs.api'
import { getTaskFile, listTaskFiles, listTaskSlugs } from './s3.server'
import { parseClaims, parseTaskToml } from './tasks'

export type TaskListItem = {
  slug: string
  paperTitle: string
  paperId: string
  baseModel: string
  baseModelShort: string
  agentTimeoutSec: number
  runCount: number
  avgReward: number | null
  bestReward: number | null
}

export const fetchTaskList = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TaskListItem[]> => {
    const slugs = await listTaskSlugs()

    return Promise.all(
      slugs.map(async (slug): Promise<TaskListItem> => {
        const [tomlRaw, claimsRaw, runs] = await Promise.all([
          getTaskFile(slug, 'task.toml'),
          getTaskFile(slug, 'tests/claims.json'),
          fetchRunList({ data: { slug } }),
        ])
        const toml = parseTaskToml(tomlRaw)
        const claims = parseClaims(claimsRaw)
        const rewards = runs.map((r) => r.reward).filter((r): r is number => r != null)
        const avgReward =
          rewards.length > 0 ? rewards.reduce((a, b) => a + b, 0) / rewards.length : null
        const bestReward = rewards.length > 0 ? Math.max(...rewards) : null
        return {
          slug,
          paperTitle: claims.paper_title,
          paperId: claims.paper_id,
          baseModel: claims.base_model_hf_id,
          baseModelShort: claims.base_model_hf_id.split('/').pop() ?? claims.base_model_hf_id,
          agentTimeoutSec: toml.agent.timeout_sec,
          runCount: runs.length,
          avgReward,
          bestReward,
        }
      }),
    )
  },
)

type PipelinePhase = {
  name: string
  status: 'ok' | 'warn' | 'skip'
  detail: string
}

type Provenance = {
  phases: PipelinePhase[]
  buildLogs: { name: string; path: string; size: number }[]
  agentTrace: { path: string; size: number } | null
  verifyLog: { path: string; size: number } | null
  stateFile: { path: string; size: number } | null
}

function extractPhases(state: Record<string, unknown>): PipelinePhase[] {
  const phases: PipelinePhase[] = []

  const pregate = state.pregate_verdict as Record<string, unknown> | undefined
  if (pregate) {
    phases.push({
      name: 'pregate',
      status: pregate.proceed ? 'ok' : 'warn',
      detail: (pregate.tldr as string) ?? (pregate.reasoning as string) ?? '',
    })
  }

  const comp = state.comprehension as Record<string, unknown> | undefined
  if (comp) {
    phases.push({
      name: 'comprehension',
      status: comp.has_computational_experiments ? 'ok' : 'warn',
      detail: `method: ${comp.primary_method ?? '?'} · framework: ${comp.framework ?? '?'}`,
    })
  }

  const prob = state.problem_extraction as Record<string, unknown> | undefined
  if (prob) {
    phases.push({
      name: 'problem extraction',
      status: prob.suitability === 'good' || prob.suitability === 'excellent' ? 'ok' : 'warn',
      detail: `suitability: ${prob.suitability ?? '?'} · baseline: ${prob.baseline ?? '?'} → best: ${prob.paper_best ?? '?'}`,
    })
  }

  const disc = state.discovery_path as Record<string, unknown> | undefined
  if (disc) {
    const steps = disc.diagnosis_steps as unknown[] | undefined
    phases.push({
      name: 'discovery',
      status: 'ok',
      detail: `${steps?.length ?? 0} diagnosis steps`,
    })
  }

  const tasks = state.challenge_tasks as Record<string, unknown> | undefined
  if (tasks) {
    const taskList = (tasks.tasks as unknown[]) ?? []
    phases.push({
      name: 'challenge tasks',
      status: taskList.length > 0 ? 'ok' : 'warn',
      detail: `${taskList.length} task(s) generated`,
    })
  }

  const explore = state.exploration as Record<string, unknown> | undefined
  if (explore) {
    const models = (explore.models as unknown[]) ?? []
    const datasets = (explore.datasets as unknown[]) ?? []
    const benchmarks = (explore.benchmarks as unknown[]) ?? []
    phases.push({
      name: 'exploration',
      status: 'ok',
      detail: `${models.length} models · ${datasets.length} datasets · ${benchmarks.length} benchmarks`,
    })
  }

  if (state.env_spec) {
    phases.push({ name: 'env spec', status: 'ok', detail: 'computed' })
  }

  if (state.task_dirs) {
    phases.push({
      name: 'task dirs',
      status: 'ok',
      detail: `${(state.task_dirs as unknown[]).length} task(s) shipped`,
    })
  }

  return phases
}

export type TimelineStepKind =
  | 'pregate'
  | 'comprehension'
  | 'problem'
  | 'discovery'
  | 'challenge'
  | 'verification'
  | 'sizing'
  | 'build'

export type ResourceEntry = {
  hfId: string
  shortName: string
  exists: boolean
  paramsBillions?: number
  sizeGb?: number
  architecture?: string
  gated?: boolean
  role?: string
  rows?: number
  splits?: Record<string, number>
  columns?: string[]
  questionColumn?: string
  answerColumn?: string
  sampleQuestion?: string
  sampleAnswer?: string
}

export type TimelineStep = {
  kind: TimelineStepKind
  num: number
  name: string
  status: 'ok' | 'warn' | 'skip'
  decision: string
  details: Array<{ label: string; value: string }>
  reasoning?: string
  payload: TimelineStepPayload
}

export type TimelineStepPayload =
  | {
      kind: 'pregate'
      proceed: boolean
      gates: string[]
      topics: string[]
      codeRepo: string | null
      references: string[]
    }
  | {
      kind: 'comprehension'
      primaryMethod: string | null
      methods: string[]
      framework: string | null
      paperCompute: string | null
      models: Array<{ name: string; role: string; usage: string }>
      datasets: Array<{ name: string; role: string; size: string | null }>
      benchmarks: Array<{ name: string; type: string; description: string }>
      externalDependencies: Array<{ kind: string; name: string; usage: string; required: boolean }>
      openSourceCodeRepo: string | null
    }
  | {
      kind: 'problem'
      problem: string | null
      solutionBrief: string | null
      suitability: string | null
      suitabilityReasoning: string | null
      benchmark: {
        name: string | null
        hfId: string | null
        split: string | null
        evalType: string | null
        evalProtocol: string | null
        evalDerivation: string | null
        scope: string | null
      }
      baseline: {
        method: string | null
        model: string | null
        metricName: string | null
        metricValue: number | null
        metricDirection: string | null
        metricLowerBound: number | null
        metricUpperBound: number | null
        decoding: string | null
        maxResponseLength: number | null
        nSamples: number | null
        systemPrompt: string | null
        citation: string | null
        tableReference: string | null
      }
      paperBest: {
        value: number | null
        citation: string | null
        tableReference: string | null
      }
      target: { value: number | null }
      requiresRuntimeBaseline: boolean
      selectionReasoning: string | null
      trainingCorpus: {
        description: string | null
        citation: string | null
        urls: string[]
      }
      alternatives: Array<{ name: string; items: number | null; note: string | null }>
    }
  | {
      kind: 'discovery'
      blockedArxiv: string[]
      blockedMethods: string[]
      diagnosisSteps: Array<{ instruction: string; purpose: string | null }>
      readingList: string[]
    }
  | {
      kind: 'challenge'
      tasks: Array<{
        slug: string
        researchGoal: string | null
        difficulty: string | null
        estimatedGpuHours: number | null
        estimatedGpus: number | null
      }>
    }
  | {
      kind: 'verification'
      models: ResourceEntry[]
      datasets: ResourceEntry[]
      benchmarks: ResourceEntry[]
      notes: string | null
      externalCorpora: Array<{ name: string; description: string; citation: string | null; urls: string[] }>
      notFound: string[]
    }
  | {
      kind: 'sizing'
      gpuType: string | null
      gpuCount: number | null
      ramGb: number | null
      diskGb: number | null
      cpus: number | null
      cudaIndex: string | null
      baseImage: string | null
      preDownload: Array<{ repoId: string; type: string }>
      vram: {
        modelParamsB: number | null
        modelGb: number | null
        fullParamGb: number | null
        loraGb: number | null
        recommendedGpu: string | null
        recommendedVramGb: number | null
        loraRecommended: boolean
      } | null
      timing: {
        stepsPerEpoch: number | null
        secPerStep: number | null
        trainingHours: number | null
        evalHours: number | null
        overheadHours: number | null
        formulaHours: number | null
        llmWallHours: number | null
        totalHours: number | null
        recommendedTimeoutHours: number | null
        timeoutSource: string | null
      } | null
      training: {
        method: string | null
        loraRecommended: boolean
        trainingStepsPerRun: number | null
        groupSize: number | null
        promptBatchSize: number | null
        maxGenerationLength: number | null
        nRuns: number | null
        needsReferenceModel: boolean | null
        tier: string | null
      } | null
      reasoning: string | null
      loraNote: string | null
      unrecordedProvenance: string[]
    }
  | {
      kind: 'build'
      taskDirCount: number
    }

export type TaskMeta = {
  paper: {
    authors: string[]
    published: string | null
    pdfUrl: string | null
    codeRepo: string | null
    topics: string[]
    keyReferenceCount: number
    abstract: string | null
    hasFullContent: boolean
  }
  research: {
    primaryMethod: string | null
    framework: string | null
    paperCompute: string | null
    problem: string | null
    solutionBrief: string | null
    selectionReasoning: string | null
    methodsCompared: string[]
    modelsCompared: Array<{ name: string; role: string; usage: string }>
    benchmarksCompared: Array<{ name: string; type: string; description: string }>
  }
  benchmark: {
    sampleQuestion: string | null
    sampleAnswer: string | null
    testRows: number | null
  }
  provenance: {
    baselineCitation: string | null
    baselineTableRef: string | null
    paperBestCitation: string | null
    paperBestTableRef: string | null
  }
  trainingCorpus: {
    description: string | null
    citation: string | null
    urls: string[]
  }
  pipelineWhy: {
    pregateReasoning: string | null
    suitabilityReasoning: string | null
  }
  pipeline: {
    steps: TimelineStep[]
  }
  sizing: {
    trainingMethod: string | null
    loraRecommended: boolean
    estimatedWallHours: number | null
    trainingStepsPerRun: number | null
    maxGenerationLength: number | null
    groupSize: number | null
    promptBatchSize: number | null
    reasoning: string | null
    loraNote: string | null
  } | null
}

// biome-ignore lint/suspicious/noExplicitAny: state.json shape is loose by design
type AnyObj = Record<string, any>

function parseGates(reasoning: string | undefined): string[] {
  if (!reasoning) return []
  // try to parse "(1) ... (2) ... (3) ..." patterns
  const m = reasoning.match(/\(\d+\)\s+[^(]+/g)
  return m ? m.map((s) => s.trim().replace(/\s*$/, '')) : []
}

function asResource(name: string, raw: AnyObj | undefined): ResourceEntry {
  const r = raw ?? {}
  const splits = (r.splits ?? {}) as Record<string, number>
  const splitTotal = Object.values(splits).reduce<number>(
    (acc, n) => acc + (typeof n === 'number' ? n : 0),
    0,
  )
  const sample = (r.sample_row ?? {}) as AnyObj
  return {
    hfId: name,
    shortName: name.split('/').pop() ?? name,
    exists: r.exists !== false && r.verified !== false,
    paramsBillions: typeof r.params_billions === 'number' ? r.params_billions : undefined,
    sizeGb: typeof r.size_gb === 'number' ? r.size_gb : undefined,
    architecture: typeof r.architecture === 'string' ? r.architecture : undefined,
    gated: typeof r.gated === 'boolean' ? r.gated : undefined,
    role: typeof r.usage_role === 'string' ? r.usage_role : undefined,
    rows: splitTotal > 0 ? splitTotal : undefined,
    splits: Object.keys(splits).length > 0 ? splits : undefined,
    columns: Array.isArray(r.columns) ? r.columns : undefined,
    questionColumn: typeof r.question_column === 'string' ? r.question_column : undefined,
    answerColumn: typeof r.answer_column === 'string' ? r.answer_column : undefined,
    sampleQuestion: typeof sample.question === 'string' ? sample.question : undefined,
    sampleAnswer:
      typeof sample.answer === 'string'
        ? sample.answer
        : sample.answer != null
          ? String(sample.answer)
          : undefined,
  }
}

function extractPipelineSteps(state: AnyObj, slug: string): TimelineStep[] {
  const steps: TimelineStep[] = []
  let num = 1

  // ── 1. PRE-GATE ──────────────────────────────────────────────
  const pregate = state.pregate_verdict
  if (pregate) {
    const reasoning = typeof pregate.reasoning === 'string' ? pregate.reasoning : ''
    steps.push({
      kind: 'pregate',
      num: num++,
      name: 'Pre-gate',
      status: pregate.proceed ? 'ok' : 'warn',
      decision: pregate.proceed
        ? 'paper accepted for evaluation'
        : 'paper rejected — not suitable for evaluation',
      details: [
        ...(pregate.code_repo ? [{ label: 'code repo', value: pregate.code_repo }] : []),
        ...(Array.isArray(pregate.topics) && pregate.topics.length > 0
          ? [{ label: 'topics', value: pregate.topics.slice(0, 4).join(', ') }]
          : []),
        ...(Array.isArray(pregate.key_references)
          ? [{ label: 'references', value: `${pregate.key_references.length} cited papers` }]
          : []),
      ],
      reasoning: reasoning || undefined,
      payload: {
        kind: 'pregate',
        proceed: !!pregate.proceed,
        gates: parseGates(reasoning),
        topics: Array.isArray(pregate.topics) ? pregate.topics : [],
        codeRepo: typeof pregate.code_repo === 'string' ? pregate.code_repo : null,
        references: Array.isArray(pregate.key_references) ? pregate.key_references : [],
      },
    })
  }

  // ── 2. COMPREHENSION ────────────────────────────────────────
  const comp = state.comprehension
  if (comp) {
    const modelsUsed = Array.isArray(comp.models_used) ? comp.models_used : []
    const datasetsUsed = Array.isArray(comp.datasets_used) ? comp.datasets_used : []
    const benchmarksList = Array.isArray(comp.benchmarks) ? comp.benchmarks : []
    const externalDeps = Array.isArray(comp.external_dependencies) ? comp.external_dependencies : []
    steps.push({
      kind: 'comprehension',
      num: num++,
      name: 'Comprehension',
      status: comp.has_computational_experiments ? 'ok' : 'warn',
      decision:
        typeof comp.primary_method === 'string'
          ? `identified ${comp.primary_method} as the paper's primary contribution`
          : 'paper read and parsed',
      details: [
        ...(comp.framework ? [{ label: 'framework', value: String(comp.framework) }] : []),
        ...(comp.compute ? [{ label: "paper's compute", value: String(comp.compute) }] : []),
        {
          label: 'surveyed',
          value: `${modelsUsed.length} models · ${datasetsUsed.length} datasets · ${benchmarksList.length} benchmarks`,
        },
      ],
      payload: {
        kind: 'comprehension',
        primaryMethod: typeof comp.primary_method === 'string' ? comp.primary_method : null,
        methods: Array.isArray(comp.methods) ? comp.methods : [],
        framework: typeof comp.framework === 'string' ? comp.framework : null,
        paperCompute: typeof comp.compute === 'string' ? comp.compute : null,
        models: modelsUsed.map((m: AnyObj) => ({
          name: typeof m.name === 'string' ? m.name : '?',
          role: typeof m.role === 'string' ? m.role : '',
          usage: typeof m.usage === 'string' ? m.usage : '',
        })),
        datasets: datasetsUsed.map((d: AnyObj) => ({
          name: typeof d.name === 'string' ? d.name : '?',
          role: typeof d.role === 'string' ? d.role : '',
          size: typeof d.size === 'string' ? d.size : null,
        })),
        benchmarks: benchmarksList.map((b: AnyObj) => ({
          name: typeof b.name === 'string' ? b.name : '?',
          type: typeof b.type === 'string' ? b.type : '',
          description: typeof b.description === 'string' ? b.description : '',
        })),
        externalDependencies: externalDeps.map((d: AnyObj) => ({
          kind: typeof d.kind === 'string' ? d.kind : '',
          name: typeof d.name === 'string' ? d.name : '?',
          usage: typeof d.usage === 'string' ? d.usage : '',
          required: !!d.required,
        })),
        openSourceCodeRepo:
          typeof comp.open_source?.code_repo === 'string' ? comp.open_source.code_repo : null,
      },
    })
  }

  // ── 3. PROBLEM EXTRACTION ────────────────────────────────────
  const prob = state.problem_extraction
  if (prob) {
    const benchName = prob.benchmark?.name ?? '?'
    const baselineVal = prob.baseline?.metric_value
    const paperBest = prob.paper_best
    const targetVal = prob.target?.value
    const decision =
      baselineVal != null && targetVal != null
        ? `target ${benchName} ${prob.baseline?.metric_name ?? 'metric'}: ${baselineVal} → ${targetVal} (paper best ${paperBest})`
        : `picked ${benchName} as target benchmark`

    // try to parse alternatives from selection_reasoning
    // pattern: "Considered AMC23 (40 items), AIME24 (30 items), MATH500 (500 items), and GPQA-D (198 items)"
    const altMatches: Array<{ name: string; items: number | null; note: string | null }> = []
    const sel = typeof prob.selection_reasoning === 'string' ? prob.selection_reasoning : ''
    const altRe = /([A-Z][A-Z0-9-]+)\s*\((\d+)\s*items?\)/g
    let m: RegExpExecArray | null = altRe.exec(sel)
    while (m !== null) {
      altMatches.push({ name: m[1], items: parseInt(m[2], 10), note: null })
      m = altRe.exec(sel)
    }

    const baselineHp = (prob.baseline?.hyperparameters ?? {}) as AnyObj

    steps.push({
      kind: 'problem',
      num: num++,
      name: 'Problem extraction',
      status:
        prob.suitability === 'high' ||
        prob.suitability === 'good' ||
        prob.suitability === 'excellent'
          ? 'ok'
          : 'warn',
      decision,
      details: [
        ...(prob.suitability ? [{ label: 'suitability', value: prob.suitability }] : []),
        ...(prob.benchmark?.hf_id
          ? [{ label: 'benchmark', value: `${benchName} · ${prob.benchmark.hf_id}` }]
          : []),
        ...(prob.requires_runtime_baseline != null
          ? [
              {
                label: 'runtime baseline',
                value: prob.requires_runtime_baseline ? 'yes (measured)' : 'no (use paper number)',
              },
            ]
          : []),
      ],
      reasoning: sel || undefined,
      payload: {
        kind: 'problem',
        problem: typeof prob.problem === 'string' ? prob.problem : null,
        solutionBrief: typeof prob.solution_brief === 'string' ? prob.solution_brief : null,
        suitability: typeof prob.suitability === 'string' ? prob.suitability : null,
        suitabilityReasoning:
          typeof prob.suitability_reasoning === 'string' ? prob.suitability_reasoning : null,
        benchmark: {
          name: typeof prob.benchmark?.name === 'string' ? prob.benchmark.name : null,
          hfId: typeof prob.benchmark?.hf_id === 'string' ? prob.benchmark.hf_id : null,
          split: typeof prob.benchmark?.split === 'string' ? prob.benchmark.split : null,
          evalType: typeof prob.benchmark?.eval_type === 'string' ? prob.benchmark.eval_type : null,
          evalProtocol:
            typeof prob.benchmark?.eval_protocol === 'string' ? prob.benchmark.eval_protocol : null,
          evalDerivation:
            typeof prob.benchmark?.eval_derivation === 'string'
              ? prob.benchmark.eval_derivation
              : null,
          scope: typeof prob.benchmark?.scope === 'string' ? prob.benchmark.scope : null,
        },
        baseline: {
          method: typeof prob.baseline?.method === 'string' ? prob.baseline.method : null,
          model: typeof prob.baseline?.model === 'string' ? prob.baseline.model : null,
          metricName:
            typeof prob.baseline?.metric_name === 'string' ? prob.baseline.metric_name : null,
          metricValue:
            typeof prob.baseline?.metric_value === 'number' ? prob.baseline.metric_value : null,
          metricDirection:
            typeof prob.baseline?.metric_direction === 'string'
              ? prob.baseline.metric_direction
              : null,
          metricLowerBound:
            typeof prob.baseline?.metric_lower_bound === 'number'
              ? prob.baseline.metric_lower_bound
              : null,
          metricUpperBound:
            typeof prob.baseline?.metric_upper_bound === 'number'
              ? prob.baseline.metric_upper_bound
              : null,
          decoding: typeof baselineHp.decoding === 'string' ? baselineHp.decoding : null,
          maxResponseLength:
            typeof baselineHp.max_response_length === 'number'
              ? baselineHp.max_response_length
              : null,
          nSamples: typeof baselineHp.n_samples === 'number' ? baselineHp.n_samples : null,
          systemPrompt:
            typeof baselineHp.system_prompt === 'string' ? baselineHp.system_prompt : null,
          citation:
            typeof prob.baseline?.metric_value_citation === 'string'
              ? prob.baseline.metric_value_citation
              : null,
          tableReference:
            typeof prob.baseline?.table_reference === 'string'
              ? prob.baseline.table_reference
              : null,
        },
        paperBest: {
          value: typeof prob.paper_best === 'number' ? prob.paper_best : null,
          citation:
            typeof prob.paper_best_citation === 'string' ? prob.paper_best_citation : null,
          tableReference:
            typeof prob.paper_best_table_reference === 'string'
              ? prob.paper_best_table_reference
              : null,
        },
        target: {
          value: typeof prob.target?.value === 'number' ? prob.target.value : null,
        },
        requiresRuntimeBaseline: !!prob.requires_runtime_baseline,
        selectionReasoning: sel || null,
        trainingCorpus: {
          description:
            typeof prob.training_corpus?.description === 'string'
              ? prob.training_corpus.description
              : null,
          citation:
            typeof prob.training_corpus?.citation === 'string'
              ? prob.training_corpus.citation
              : null,
          urls: Array.isArray(prob.training_corpus?.urls) ? prob.training_corpus.urls : [],
        },
        alternatives: altMatches,
      },
    })
  }

  // ── 4. DISCOVERY PATH ────────────────────────────────────────
  const disc = state.discovery_path
  if (disc) {
    const blockedArxiv = Array.isArray(disc.block_list?.arxiv_ids) ? disc.block_list.arxiv_ids : []
    const blockedMethods = Array.isArray(disc.block_list?.method_names)
      ? disc.block_list.method_names
      : []
    const diagnosisSteps = Array.isArray(disc.diagnosis_steps) ? disc.diagnosis_steps : []
    const readingList = Array.isArray(disc.reading_list) ? disc.reading_list : []
    steps.push({
      kind: 'discovery',
      num: num++,
      name: 'Discovery path',
      status: 'ok',
      decision:
        diagnosisSteps.length === 0 && readingList.length === 0
          ? 'agent must rediscover the method from first principles'
          : `${diagnosisSteps.length} diagnosis steps + ${readingList.length} reading items`,
      details: [
        ...(blockedArxiv.length > 0
          ? [{ label: 'blocked arxiv', value: blockedArxiv.join(', ') }]
          : []),
        ...(blockedMethods.length > 0
          ? [{ label: 'blocked methods', value: blockedMethods.join(', ') }]
          : []),
      ],
      payload: {
        kind: 'discovery',
        blockedArxiv,
        blockedMethods,
        diagnosisSteps: diagnosisSteps.map((s: AnyObj) => ({
          instruction: typeof s.instruction === 'string' ? s.instruction : '',
          purpose: typeof s.purpose === 'string' ? s.purpose : null,
        })),
        readingList: readingList.map((r: AnyObj | string) =>
          typeof r === 'string' ? r : JSON.stringify(r),
        ),
      },
    })
  }

  // ── 5. CHALLENGE TASKS ───────────────────────────────────────
  const tasks = state.challenge_tasks
  if (tasks?.tasks) {
    const taskList = (tasks.tasks ?? []) as AnyObj[]
    const my = taskList.find((t) => t.slug === slug) ?? taskList[0]
    steps.push({
      kind: 'challenge',
      num: num++,
      name: 'Challenge tasks',
      status: taskList.length > 0 ? 'ok' : 'warn',
      decision:
        taskList.length === 1
          ? `generated 1 task: ${taskList[0]?.slug ?? '?'}`
          : `generated ${taskList.length} tasks`,
      details: [
        ...(my?.difficulty ? [{ label: 'difficulty', value: String(my.difficulty) }] : []),
        ...(my?.estimated_gpu_hours != null
          ? [{ label: 'est. GPU hours', value: String(my.estimated_gpu_hours) }]
          : []),
        ...(my?.estimated_gpus != null
          ? [{ label: 'est. GPUs', value: String(my.estimated_gpus) }]
          : []),
      ],
      payload: {
        kind: 'challenge',
        tasks: taskList.map((t: AnyObj) => ({
          slug: typeof t.slug === 'string' ? t.slug : '?',
          researchGoal: typeof t.research_goal === 'string' ? t.research_goal : null,
          difficulty: typeof t.difficulty === 'string' ? t.difficulty : null,
          estimatedGpuHours:
            typeof t.estimated_gpu_hours === 'number' ? t.estimated_gpu_hours : null,
          estimatedGpus: typeof t.estimated_gpus === 'number' ? t.estimated_gpus : null,
        })),
      },
    })
  }

  // ── 6. RESOURCE VERIFICATION ─────────────────────────────────
  const explore = state.exploration
  if (explore) {
    const modelsObj = (explore.models ?? {}) as AnyObj
    const datasetsObj = (explore.datasets ?? {}) as AnyObj
    const benchmarksObj = (explore.benchmarks ?? {}) as AnyObj
    const ms = Object.entries(modelsObj).map(([k, v]) => asResource(k, v as AnyObj))
    const ds = Object.entries(datasetsObj).map(([k, v]) => asResource(k, v as AnyObj))
    const bs = Object.entries(benchmarksObj).map(([k, v]) => asResource(k, v as AnyObj))
    const externalCorpora = Array.isArray(explore.external_corpora) ? explore.external_corpora : []
    steps.push({
      kind: 'verification',
      num: num++,
      name: 'Resource verification',
      status: 'ok',
      decision: `verified ${ms.length} models, ${ds.length} datasets, ${bs.length} benchmarks all exist on HuggingFace`,
      details: [
        ...(ms.length > 0
          ? [{ label: 'models', value: ms.map((m) => m.shortName).join(', ') }]
          : []),
        ...(ds.length > 0
          ? [{ label: 'datasets', value: ds.map((d) => d.shortName).join(', ') }]
          : []),
        ...(bs.length > 0
          ? [{ label: 'benchmarks', value: bs.map((b) => b.shortName).join(', ') }]
          : []),
      ],
      payload: {
        kind: 'verification',
        models: ms,
        datasets: ds,
        benchmarks: bs,
        notes: typeof explore.notes === 'string' ? explore.notes : null,
        externalCorpora: externalCorpora.map((c: AnyObj) => ({
          name: typeof c.name === 'string' ? c.name : '?',
          description: typeof c.description === 'string' ? c.description : '',
          citation: typeof c.citation === 'string' ? c.citation : null,
          urls: Array.isArray(c.urls) ? c.urls : [],
        })),
        notFound: Array.isArray(explore.not_found) ? explore.not_found : [],
      },
    })
  }

  // ── 7. SIZING ────────────────────────────────────────────────
  if (state.env_spec) {
    const envSpec = state.env_spec as AnyObj
    const scout = (envSpec.scout_details ?? {}) as AnyObj
    const judgment = (scout.judgment ?? {}) as AnyObj
    const perTaskList = Array.isArray(judgment.per_task_sizing) ? judgment.per_task_sizing : []
    const perTask = perTaskList.find((t: AnyObj) => t.slug === slug)
    const taskOverride = (scout.task_overrides?.[slug] ?? {}) as AnyObj
    const tov = (taskOverride.vram ?? {}) as AnyObj
    const tot = (taskOverride.timing ?? {}) as AnyObj
    const globalVram = (scout.global_vram ?? {}) as AnyObj
    const gpu = `${envSpec.gpu_count}× ${envSpec.gpu_type}`
    const wall = perTask?.estimated_wall_hours != null ? `${perTask.estimated_wall_hours}h` : null
    const preDownload = Array.isArray(envSpec.pre_download) ? envSpec.pre_download : []
    const unrecorded = Array.isArray(envSpec.unrecorded_provenance)
      ? envSpec.unrecorded_provenance
      : []

    steps.push({
      kind: 'sizing',
      num: num++,
      name: 'Sizing',
      status: 'ok',
      decision: wall
        ? `sandbox sized to ${gpu} · ~${wall} wall time${perTask?.lora_recommended ? ' · LoRA' : ''}`
        : `sandbox sized to ${gpu}`,
      details: [
        ...(perTask?.training_method
          ? [
              {
                label: 'training',
                value: `${perTask.training_method}${perTask.lora_recommended ? ' + LoRA' : ''}`,
              },
            ]
          : []),
        ...(perTask?.training_steps_per_run != null
          ? [{ label: 'training steps', value: String(perTask.training_steps_per_run) }]
          : []),
        ...(perTask?.max_generation_length != null
          ? [
              {
                label: 'max generation',
                value: `${perTask.max_generation_length.toLocaleString()} tokens`,
              },
            ]
          : []),
      ],
      reasoning: typeof judgment.reasoning === 'string' ? judgment.reasoning : undefined,
      payload: {
        kind: 'sizing',
        gpuType: typeof envSpec.gpu_type === 'string' ? envSpec.gpu_type : null,
        gpuCount: typeof envSpec.gpu_count === 'number' ? envSpec.gpu_count : null,
        ramGb: typeof envSpec.ram_gb === 'number' ? envSpec.ram_gb : null,
        diskGb: typeof envSpec.disk_gb === 'number' ? envSpec.disk_gb : null,
        cpus: typeof envSpec.cpus === 'number' ? envSpec.cpus : null,
        cudaIndex: typeof envSpec.cuda_index === 'string' ? envSpec.cuda_index : null,
        baseImage: typeof envSpec.base_image === 'string' ? envSpec.base_image : null,
        preDownload: preDownload.map((p: AnyObj) => ({
          repoId: typeof p.repo_id === 'string' ? p.repo_id : '?',
          type: typeof p.type === 'string' ? p.type : '?',
        })),
        vram: {
          modelParamsB:
            typeof tov.model_params_b === 'number'
              ? tov.model_params_b
              : typeof globalVram.model_params_b === 'number'
                ? globalVram.model_params_b
                : null,
          modelGb:
            typeof tov.model_gb === 'number'
              ? tov.model_gb
              : typeof globalVram.model_gb === 'number'
                ? globalVram.model_gb
                : null,
          fullParamGb:
            typeof tov.full_param_dpo_gb === 'number'
              ? tov.full_param_dpo_gb
              : typeof globalVram.full_param_dpo_gb === 'number'
                ? globalVram.full_param_dpo_gb
                : null,
          loraGb:
            typeof tov.lora_dpo_gb === 'number'
              ? tov.lora_dpo_gb
              : typeof globalVram.lora_dpo_gb === 'number'
                ? globalVram.lora_dpo_gb
                : null,
          recommendedGpu:
            typeof tov.recommended_gpu === 'string'
              ? tov.recommended_gpu
              : typeof globalVram.recommended_gpu === 'string'
                ? globalVram.recommended_gpu
                : null,
          recommendedVramGb:
            typeof tov.recommended_vram_gb === 'number'
              ? tov.recommended_vram_gb
              : typeof globalVram.recommended_vram_gb === 'number'
                ? globalVram.recommended_vram_gb
                : null,
          loraRecommended:
            typeof tov.lora_recommended === 'boolean'
              ? tov.lora_recommended
              : typeof globalVram.lora_recommended === 'boolean'
                ? globalVram.lora_recommended
                : false,
        },
        timing: {
          stepsPerEpoch: typeof tot.steps_per_epoch === 'number' ? tot.steps_per_epoch : null,
          secPerStep: typeof tot.sec_per_step === 'number' ? tot.sec_per_step : null,
          trainingHours:
            typeof tot.training_hours_per_run === 'number'
              ? tot.training_hours_per_run
              : null,
          evalHours: typeof tot.eval_hours === 'number' ? tot.eval_hours : null,
          overheadHours: typeof tot.overhead_hours === 'number' ? tot.overhead_hours : null,
          formulaHours: typeof tot.formula_hours === 'number' ? tot.formula_hours : null,
          llmWallHours: typeof tot.llm_wall_hours === 'number' ? tot.llm_wall_hours : null,
          totalHours: typeof tot.total_hours === 'number' ? tot.total_hours : null,
          recommendedTimeoutHours:
            typeof tot.recommended_timeout_hours === 'number'
              ? tot.recommended_timeout_hours
              : null,
          timeoutSource: typeof tot.timeout_source === 'string' ? tot.timeout_source : null,
        },
        training: perTask
          ? {
              method:
                typeof perTask.training_method === 'string' ? perTask.training_method : null,
              loraRecommended: !!perTask.lora_recommended,
              trainingStepsPerRun:
                typeof perTask.training_steps_per_run === 'number'
                  ? perTask.training_steps_per_run
                  : null,
              groupSize: typeof perTask.group_size === 'number' ? perTask.group_size : null,
              promptBatchSize:
                typeof perTask.prompt_batch_size === 'number' ? perTask.prompt_batch_size : null,
              maxGenerationLength:
                typeof perTask.max_generation_length === 'number'
                  ? perTask.max_generation_length
                  : null,
              nRuns: typeof perTask.n_runs === 'number' ? perTask.n_runs : null,
              needsReferenceModel:
                typeof perTask.needs_reference_model === 'boolean'
                  ? perTask.needs_reference_model
                  : null,
              tier: typeof perTask.computational_tier === 'string'
                ? perTask.computational_tier
                : null,
            }
          : null,
        reasoning: typeof judgment.reasoning === 'string' ? judgment.reasoning : null,
        loraNote: typeof judgment.lora_note === 'string' ? judgment.lora_note : null,
        unrecordedProvenance: unrecorded,
      },
    })
  }

  // ── 8. BUILD & SHIP ──────────────────────────────────────────
  if (state.task_dirs) {
    const dirs = state.task_dirs as unknown[]
    steps.push({
      kind: 'build',
      num: num++,
      name: 'Build & ship',
      status: 'ok',
      decision: `${dirs.length} task director${dirs.length === 1 ? 'y' : 'ies'} built and pushed to s3`,
      details: [],
      payload: {
        kind: 'build',
        taskDirCount: dirs.length,
      },
    })
  }

  return steps
}

function extractTaskMeta(
  state: Record<string, unknown>,
  slug: string,
  benchmarkHfId: string,
): TaskMeta {
  const arxiv = (state.arxiv_metadata ?? {}) as Record<string, unknown>
  const pregate = (state.pregate_verdict ?? {}) as Record<string, unknown>
  const comp = (state.comprehension ?? {}) as Record<string, unknown>
  const probExt = (state.problem_extraction ?? {}) as Record<string, unknown>

  // benchmark sample
  const exploration = (state.exploration ?? {}) as Record<string, unknown>
  const explBenchmarks = (exploration.benchmarks ?? {}) as Record<string, unknown>
  const benchEntry = (explBenchmarks[benchmarkHfId] ?? {}) as Record<string, unknown>
  const sampleRow = (benchEntry.sample_row ?? {}) as Record<string, unknown>
  const splits = (benchEntry.splits ?? {}) as Record<string, unknown>
  const split = typeof benchEntry.split === 'string' ? benchEntry.split : 'test'
  const testRows =
    typeof splits[split] === 'number'
      ? (splits[split] as number)
      : typeof splits.test === 'number'
        ? (splits.test as number)
        : null

  // models compared
  const explModels = (exploration.models ?? {}) as Record<string, unknown>
  const modelsCompared = Object.entries(explModels)
    .map(([_, v]) => {
      const m = v as Record<string, unknown>
      return {
        name: typeof m.repo_id === 'string' ? m.repo_id : '',
        role: typeof m.usage_role === 'string' ? m.usage_role : 'unknown',
        usage: typeof m.role === 'string' ? m.role : '',
      }
    })
    .filter((m) => m.name)

  // benchmarks compared (paper-level)
  const benchmarksCompared = Array.isArray(comp.benchmarks)
    ? (comp.benchmarks as Array<Record<string, unknown>>).map((b) => ({
        name: typeof b.name === 'string' ? b.name : '?',
        type: typeof b.type === 'string' ? b.type : '',
        description: typeof b.description === 'string' ? b.description : '',
      }))
    : []

  // sizing
  const envSpec = (state.env_spec ?? {}) as Record<string, unknown>
  const scout = (envSpec.scout_details ?? {}) as Record<string, unknown>
  const judgment = (scout.judgment ?? {}) as Record<string, unknown>
  const perTask = Array.isArray(judgment.per_task_sizing)
    ? (judgment.per_task_sizing as Array<Record<string, unknown>>).find((t) => t.slug === slug)
    : undefined

  let sizing: TaskMeta['sizing'] = null
  if (perTask || judgment.reasoning || judgment.lora_note) {
    sizing = {
      trainingMethod: typeof perTask?.training_method === 'string' ? perTask.training_method : null,
      loraRecommended: typeof perTask?.lora_recommended === 'boolean'
        ? perTask.lora_recommended
        : typeof scout.global_vram === 'object' && scout.global_vram != null
          ? !!(scout.global_vram as Record<string, unknown>).lora_recommended
          : false,
      estimatedWallHours:
        typeof perTask?.estimated_wall_hours === 'number' ? perTask.estimated_wall_hours : null,
      trainingStepsPerRun:
        typeof perTask?.training_steps_per_run === 'number' ? perTask.training_steps_per_run : null,
      maxGenerationLength:
        typeof perTask?.max_generation_length === 'number' ? perTask.max_generation_length : null,
      groupSize: typeof perTask?.group_size === 'number' ? perTask.group_size : null,
      promptBatchSize:
        typeof perTask?.prompt_batch_size === 'number' ? perTask.prompt_batch_size : null,
      reasoning: typeof judgment.reasoning === 'string' ? judgment.reasoning : null,
      loraNote: typeof judgment.lora_note === 'string' ? judgment.lora_note : null,
    }
  }

  // provenance citations
  const baselineObj = (probExt.baseline ?? {}) as Record<string, unknown>
  const trainCorpus = (probExt.training_corpus ?? {}) as Record<string, unknown>

  return {
    paper: {
      authors: Array.isArray(arxiv.authors) ? (arxiv.authors as string[]) : [],
      published: typeof arxiv.published === 'string' ? arxiv.published : null,
      pdfUrl: typeof arxiv.pdf_url === 'string' ? arxiv.pdf_url : null,
      codeRepo: typeof pregate.code_repo === 'string' ? pregate.code_repo : null,
      topics: Array.isArray(pregate.topics) ? (pregate.topics as string[]) : [],
      keyReferenceCount: Array.isArray(pregate.key_references) ? pregate.key_references.length : 0,
      abstract: typeof arxiv.abstract === 'string' ? arxiv.abstract : null,
      hasFullContent: typeof state.paper_content === 'string' && state.paper_content.length > 0,
    },
    research: {
      primaryMethod: typeof comp.primary_method === 'string' ? comp.primary_method : null,
      framework: typeof comp.framework === 'string' ? comp.framework : null,
      paperCompute: typeof comp.compute === 'string' ? comp.compute : null,
      problem: typeof probExt.problem === 'string' ? probExt.problem : null,
      solutionBrief: typeof probExt.solution_brief === 'string' ? probExt.solution_brief : null,
      selectionReasoning:
        typeof probExt.selection_reasoning === 'string' ? probExt.selection_reasoning : null,
      methodsCompared: Array.isArray(comp.methods) ? (comp.methods as string[]) : [],
      modelsCompared,
      benchmarksCompared,
    },
    benchmark: {
      sampleQuestion: typeof sampleRow.question === 'string' ? sampleRow.question : null,
      sampleAnswer:
        typeof sampleRow.answer === 'string'
          ? sampleRow.answer
          : sampleRow.answer != null
            ? String(sampleRow.answer)
            : null,
      testRows,
    },
    provenance: {
      baselineCitation:
        typeof baselineObj.metric_value_citation === 'string'
          ? baselineObj.metric_value_citation
          : null,
      baselineTableRef:
        typeof baselineObj.table_reference === 'string' ? baselineObj.table_reference : null,
      paperBestCitation:
        typeof probExt.paper_best_citation === 'string' ? probExt.paper_best_citation : null,
      paperBestTableRef:
        typeof probExt.paper_best_table_reference === 'string'
          ? probExt.paper_best_table_reference
          : null,
    },
    trainingCorpus: {
      description: typeof trainCorpus.description === 'string' ? trainCorpus.description : null,
      citation: typeof trainCorpus.citation === 'string' ? trainCorpus.citation : null,
      urls: Array.isArray(trainCorpus.urls) ? (trainCorpus.urls as string[]) : [],
    },
    pipelineWhy: {
      pregateReasoning: typeof pregate.reasoning === 'string' ? pregate.reasoning : null,
      suitabilityReasoning:
        typeof probExt.suitability_reasoning === 'string' ? probExt.suitability_reasoning : null,
    },
    pipeline: {
      steps: extractPipelineSteps(state as AnyObj, slug),
    },
    sizing,
  }
}

/**
 * Heavy task data — instruction, file list, provenance. The lightweight
 * identity (toml + claims) is loaded by the `/tasks/$slug` parent route.
 */
export const fetchTaskHeavy = createServerFn({ method: 'GET' })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }) => {
    const { slug } = data

    const [instructionRaw, fileList, stateRaw] = await Promise.all([
      getTaskFile(slug, 'instruction.md'),
      listTaskFiles(slug),
      getTaskFile(slug, '_creation_logs/state.json').catch(() => ''),
    ])

    const instructionHtml = await markdownToHtml(instructionRaw)
    // exclude _runs/ from the on-page file tree — runs render in their own section
    const visibleFiles = fileList.filter((f) => !f.key.startsWith('_runs/'))
    const totalSize = visibleFiles.reduce((s, f) => s + f.size, 0)

    let provenance: Provenance | null = null
    let meta: TaskMeta | null = null
    const creationFiles = fileList.filter((f) => f.key.startsWith('_creation_logs/'))
    if (creationFiles.length > 0) {
      let phases: PipelinePhase[] = []
      const stateEntry = creationFiles.find((f) => f.key === '_creation_logs/state.json')
      if (stateEntry && stateRaw) {
        try {
          const state = JSON.parse(stateRaw) as Record<string, unknown>
          phases = extractPhases(state)
          // benchmark hf id needed for sample lookup; pull from claims if available
          let benchmarkHfId = ''
          try {
            const claimsRaw = await getTaskFile(slug, 'tests/claims.json')
            const claims = JSON.parse(claimsRaw) as { benchmark_hf_id?: string }
            benchmarkHfId = claims.benchmark_hf_id ?? ''
          } catch {
            // best-effort
          }
          meta = extractTaskMeta(state, slug, benchmarkHfId)
        } catch {
          // state.json parse failed, skip phases
        }
      }

      const buildLogs = creationFiles
        .filter((f) => f.key.startsWith('_creation_logs/build-logs/'))
        .map((f) => ({ name: f.key.split('/').pop() ?? f.key, path: f.key, size: f.size }))

      const traceEntry = creationFiles.find((f) => f.key.includes('eval_gen_agent_trace'))
      const verifyEntry = creationFiles.find((f) => f.key.includes('verify_log'))

      provenance = {
        phases,
        buildLogs,
        agentTrace: traceEntry ? { path: traceEntry.key, size: traceEntry.size } : null,
        verifyLog: verifyEntry ? { path: verifyEntry.key, size: verifyEntry.size } : null,
        stateFile: stateEntry ? { path: stateEntry.key, size: stateEntry.size } : null,
      }
    }

    return {
      instructionHtml,
      filePaths: visibleFiles.map((f) => f.key),
      totalSize,
      fileCount: visibleFiles.length,
      provenance,
      meta,
    }
  })

export const fetchTaskFile = createServerFn({ method: 'GET' })
  .inputValidator((d: { slug: string; path: string }) => d)
  .handler(async ({ data }) => {
    const { slug, path } = data

    const content = await getTaskFile(slug, path)
    const size = new TextEncoder().encode(content).length
    const ext =
      path.lastIndexOf('.') >= 0 ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
    const renderedHtml = ext === 'md' ? await markdownToHtml(content) : null

    return { slug, path, content, renderedHtml, size }
  })

export const fetchPaperContent = createServerFn({ method: 'GET' })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }): Promise<{ html: string | null }> => {
    const stateRaw = await getTaskFile(data.slug, '_creation_logs/state.json').catch(() => '')
    if (!stateRaw) return { html: null }
    try {
      const state = JSON.parse(stateRaw) as Record<string, unknown>
      const content = typeof state.paper_content === 'string' ? state.paper_content : null
      if (!content) return { html: null }
      const html = await markdownToHtml(content)
      return { html }
    } catch {
      return { html: null }
    }
  })

export type TaskValidation = {
  leakAudit: {
    rounds: number
    allClean: boolean
    latestAssessment: string | null
  } | null
  resources: {
    modelsChecked: number
    modelsExisting: number
    datasetsChecked: number
    datasetsExisting: number
    benchmarksChecked: number
    benchmarksExisting: number
    notFound: string[]
    notes: string | null
    externalCorpora: Array<{ name: string; description: string; citation: string | null }>
  } | null
}

export const fetchTaskValidation = createServerFn({ method: 'GET' })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }): Promise<TaskValidation> => {
    const [verifyRaw, leakRaw] = await Promise.all([
      getTaskFile(data.slug, '_creation_logs/verify_log.json').catch(() => ''),
      getTaskFile(data.slug, '_leak_audit.json').catch(() => ''),
    ])

    let leakAudit: TaskValidation['leakAudit'] = null
    if (leakRaw) {
      try {
        const rounds = JSON.parse(leakRaw) as Array<{ clean: boolean; assessment?: string }>
        if (Array.isArray(rounds) && rounds.length > 0) {
          leakAudit = {
            rounds: rounds.length,
            allClean: rounds.every((r) => r.clean === true),
            latestAssessment:
              typeof rounds[rounds.length - 1].assessment === 'string'
                ? (rounds[rounds.length - 1].assessment as string)
                : null,
          }
        }
      } catch {
        // best-effort
      }
    }

    let resources: TaskValidation['resources'] = null
    if (verifyRaw) {
      try {
        const v = JSON.parse(verifyRaw) as {
          models?: Record<string, { exists?: boolean }>
          datasets?: Record<string, { exists?: boolean }>
          benchmarks?: Record<string, { exists?: boolean }>
          not_found?: string[]
          notes?: string
          external_corpora?: Array<{ name?: string; description?: string; citation?: string }>
        }
        const countAndExist = (obj?: Record<string, { exists?: boolean }>) => {
          if (!obj) return [0, 0]
          const entries = Object.values(obj)
          return [entries.length, entries.filter((e) => e.exists === true).length]
        }
        const [mc, me] = countAndExist(v.models)
        const [dc, de] = countAndExist(v.datasets)
        const [bc, be] = countAndExist(v.benchmarks)
        resources = {
          modelsChecked: mc,
          modelsExisting: me,
          datasetsChecked: dc,
          datasetsExisting: de,
          benchmarksChecked: bc,
          benchmarksExisting: be,
          notFound: Array.isArray(v.not_found) ? v.not_found : [],
          notes: typeof v.notes === 'string' ? v.notes : null,
          externalCorpora: Array.isArray(v.external_corpora)
            ? v.external_corpora.map((e) => ({
                name: typeof e.name === 'string' ? e.name : '?',
                description: typeof e.description === 'string' ? e.description : '',
                citation: typeof e.citation === 'string' ? e.citation : null,
              }))
            : [],
        }
      } catch {
        // best-effort
      }
    }

    return { leakAudit, resources }
  })

export const fetchAllTaskFiles = createServerFn({ method: 'GET' })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }) => {
    const files = await listTaskFiles(data.slug)
    const visible = files.filter((f) => !f.key.startsWith('_runs/'))
    const contents = await Promise.all(
      visible.map(async (f) => ({
        path: f.key,
        content: await getTaskFile(data.slug, f.key),
      })),
    )
    return { slug: data.slug, files: contents }
  })
