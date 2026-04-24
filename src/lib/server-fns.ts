import { createServerFn } from '@tanstack/react-start'
import { markdownToHtml } from './markdown'
import { getTaskFile, listTaskFiles, listTaskSlugs } from './s3.server'
import { parseClaims, parseTaskToml, type TaskSummary } from './tasks'

export const fetchTaskList = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TaskSummary[]> => {
    const slugs = await listTaskSlugs()

    return Promise.all(
      slugs.map(async (slug) => {
        const [tomlRaw, claimsRaw] = await Promise.all([
          getTaskFile(slug, 'task.toml'),
          getTaskFile(slug, 'tests/claims.json'),
        ])
        return {
          slug,
          toml: parseTaskToml(tomlRaw),
          claims: parseClaims(claimsRaw),
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

export const fetchTaskDetail = createServerFn({ method: 'GET' })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }) => {
    const { slug } = data

    const [tomlRaw, claimsRaw, instructionRaw, fileList, stateRaw] = await Promise.all([
      getTaskFile(slug, 'task.toml'),
      getTaskFile(slug, 'tests/claims.json'),
      getTaskFile(slug, 'instruction.md'),
      listTaskFiles(slug),
      getTaskFile(slug, '_creation_logs/state.json').catch(() => ''),
    ])

    const toml = parseTaskToml(tomlRaw)
    const claims = parseClaims(claimsRaw)
    const instructionHtml = await markdownToHtml(instructionRaw)
    const totalSize = fileList.reduce((s, f) => s + f.size, 0)

    let provenance: Provenance | null = null
    const creationFiles = fileList.filter((f) => f.key.startsWith('_creation_logs/'))
    if (creationFiles.length > 0) {
      let phases: PipelinePhase[] = []
      const stateEntry = creationFiles.find((f) => f.key === '_creation_logs/state.json')
      if (stateEntry && stateRaw) {
        try {
          const state = JSON.parse(stateRaw) as Record<string, unknown>
          phases = extractPhases(state)
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

    const filePaths = fileList.map((f) => f.key)

    return {
      slug,
      toml,
      claims,
      instructionHtml,
      filePaths,
      totalSize,
      fileCount: fileList.length,
      provenance,
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
