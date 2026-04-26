import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getS3File, listRunIds, listS3Prefix, listTrialDirs } from './s3.server'

const ManifestSchema = z
  .object({
    schema_version: z.string().optional(),
    run_id: z.string().optional(),
    task: z
      .object({
        slug: z.string(),
        tree_sha256: z.string().optional(),
      })
      .optional(),
    agent: z
      .object({
        name: z.string(),
        model: z.string(),
        cli_version: z.string().optional(),
        timeout_sec: z.number().optional(),
      })
      .optional(),
    paper2eval: z
      .object({
        git_sha: z.string().optional(),
      })
      .optional(),
    runtime: z
      .object({
        started_utc: z.string(),
        ended_utc: z.string(),
        duration_sec: z.number(),
        exit_code: z.number().optional(),
      })
      .optional(),
  })
  .passthrough()

const RunResultSchema = z
  .object({
    id: z.string().optional(),
    started_at: z.string().optional(),
    finished_at: z.string().optional(),
    n_total_trials: z.number().optional(),
    stats: z
      .object({
        n_trials: z.number(),
        n_errors: z.number().optional(),
        evals: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    _manual_patch: z
      .object({
        patched_at: z.string(),
        reason: z.string(),
      })
      .optional(),
  })
  .passthrough()

const TrialResultSchema = z
  .object({
    id: z.string(),
    trial_name: z.string(),
    task_name: z.string().optional(),
    verifier_result: z
      .object({
        rewards: z.record(z.string(), z.number().nullable()).optional(),
      })
      .optional(),
    exception_info: z.unknown().optional().nullable(),
    started_at: z.string().optional(),
    finished_at: z.string().optional(),
    agent_info: z
      .object({
        name: z.string(),
        version: z.string().optional(),
        model_info: z
          .object({
            name: z.string(),
            provider: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    config: z
      .object({
        agent: z
          .object({
            name: z.string(),
            model_name: z.string().optional(),
          })
          .optional(),
        environment: z
          .object({
            kwargs: z
              .object({
                sandbox_timeout_secs: z.number().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    _manual_patch: z
      .object({
        patched_at: z.string(),
        reason: z.string(),
        measured_accuracy: z.number().optional(),
        grader: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type RunStatus = 'ok' | 'patched' | 'crashed' | 'unknown'

export type RunSummary = {
  runId: string
  reward: number | null
  measuredAccuracy: number | null
  status: RunStatus
  startedAt: string | null
  durationSec: number | null
  agent: { name: string; model: string }
  trialCount: number
  exitCode: number | null
  bestTrialId: string | null
}

export type TrialDetail = {
  trialId: string
  reward: number | null
  measuredAccuracy: number | null
  grader: string | null
  patchReason: string | null
  exitCode: number | null
  startedAt: string | null
  finishedAt: string | null
  agent: { name: string; model: string } | null
  rawResultJson: string
}

export type RunDetail = {
  slug: string
  runId: string
  summary: RunSummary
  trial: TrialDetail
  trials: TrialDetail[]
  verifierStdout: string | null
  verifierReward: string | null
  files: { key: string; size: number }[]
  hasTrace: boolean
}

function parseTrialResult(raw: string): {
  parsed: z.infer<typeof TrialResultSchema>
  rawJson: Record<string, unknown>
} | null {
  try {
    const json = JSON.parse(raw) as Record<string, unknown>
    const parsed = TrialResultSchema.parse(json)
    return { parsed, rawJson: json }
  } catch {
    return null
  }
}

function trialFromParsed(
  trialId: string,
  parsed: z.infer<typeof TrialResultSchema>,
  raw: Record<string, unknown>,
): TrialDetail {
  const rewards = parsed.verifier_result?.rewards ?? {}
  const reward = typeof rewards.reward === 'number' ? rewards.reward : null
  const patch = parsed._manual_patch
  const cfgAgent = parsed.config?.agent
  const agent =
    parsed.agent_info?.model_info?.name || cfgAgent?.model_name
      ? {
          name: parsed.agent_info?.name ?? cfgAgent?.name ?? 'unknown',
          model:
            parsed.agent_info?.model_info?.name ??
            cfgAgent?.model_name?.replace(/^anthropic\//, '') ??
            'unknown',
        }
      : null

  const exitCode = (raw.exit_code as number | null | undefined) ?? null

  return {
    trialId,
    reward,
    measuredAccuracy: patch?.measured_accuracy ?? null,
    grader: patch?.grader ?? null,
    patchReason: patch?.reason ?? null,
    exitCode,
    startedAt: parsed.started_at ?? null,
    finishedAt: parsed.finished_at ?? null,
    agent,
    rawResultJson: JSON.stringify(raw, null, 2),
  }
}

function summarizeRun(
  runId: string,
  trials: TrialDetail[],
  manifest: z.infer<typeof ManifestSchema> | null,
  hasManualPatch: boolean,
): RunSummary {
  const sorted = [...trials].sort((a, b) => (b.reward ?? -Infinity) - (a.reward ?? -Infinity))
  const best = sorted[0] ?? null

  const status: RunStatus = hasManualPatch
    ? 'patched'
    : trials.length === 0
      ? 'unknown'
      : trials.every((t) => t.reward == null)
        ? 'crashed'
        : 'ok'

  const manifestAgent = manifest?.agent
  const agent =
    best?.agent ??
    (manifestAgent
      ? {
          name: manifestAgent.name,
          model: manifestAgent.model.replace(/^anthropic\//, ''),
        }
      : { name: 'unknown', model: 'unknown' })

  return {
    runId,
    reward: best?.reward ?? null,
    measuredAccuracy: best?.measuredAccuracy ?? null,
    status,
    startedAt: manifest?.runtime?.started_utc ?? best?.startedAt ?? null,
    durationSec: manifest?.runtime?.duration_sec ?? null,
    agent,
    trialCount: trials.length,
    exitCode: manifest?.runtime?.exit_code ?? best?.exitCode ?? null,
    bestTrialId: best?.trialId ?? null,
  }
}

async function loadRunSummary(slug: string, runId: string): Promise<RunSummary> {
  const trialIds = await listTrialDirs(slug, runId)

  const [manifestRaw, runResultRaw, ...trialResults] = await Promise.all([
    getS3File(`tasks/${slug}/_runs/${runId}/manifest.json`),
    getS3File(`tasks/${slug}/_runs/${runId}/result.json`),
    ...trialIds.map((tid) => getS3File(`tasks/${slug}/_runs/${runId}/${tid}/result.json`)),
  ])

  let manifest: z.infer<typeof ManifestSchema> | null = null
  if (manifestRaw) {
    try {
      manifest = ManifestSchema.parse(JSON.parse(manifestRaw))
    } catch {
      // best-effort
    }
  }

  let hasManualPatch = false
  if (runResultRaw) {
    try {
      const runResult = RunResultSchema.parse(JSON.parse(runResultRaw))
      hasManualPatch = !!runResult._manual_patch
    } catch {
      // best-effort
    }
  }

  const trials: TrialDetail[] = []
  for (let i = 0; i < trialIds.length; i++) {
    const raw = trialResults[i]
    if (!raw) continue
    const parsed = parseTrialResult(raw)
    if (!parsed) continue
    trials.push(trialFromParsed(trialIds[i], parsed.parsed, parsed.rawJson))
    if (parsed.parsed._manual_patch) hasManualPatch = true
  }

  return summarizeRun(runId, trials, manifest, hasManualPatch)
}

export const fetchRunList = createServerFn({ method: 'GET' })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }): Promise<RunSummary[]> => {
    const runIds = await listRunIds(data.slug)
    if (runIds.length === 0) return []
    const summaries = await Promise.all(runIds.map((id) => loadRunSummary(data.slug, id)))
    return summaries.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
  })

const TRACE_KEY = 'runs/{slug}/agent_logs/claude-code.txt'

async function loadAgentTrace(slug: string): Promise<string | null> {
  return getS3File(TRACE_KEY.replace('{slug}', slug))
}

export const fetchAgentTrace = createServerFn({ method: 'GET' })
  .inputValidator((d: { slug: string; runId: string }) => d)
  .handler(async ({ data }): Promise<{ content: string | null }> => {
    const content = await loadAgentTrace(data.slug)
    return { content }
  })

async function loadRunDetail(slug: string, runId: string): Promise<RunDetail> {
  const trialIds = await listTrialDirs(slug, runId)
  const runPrefix = `tasks/${slug}/_runs/${runId}`

  const [manifestRaw, runResultRaw, files, ...trialBundles] = await Promise.all([
    getS3File(`${runPrefix}/manifest.json`),
    getS3File(`${runPrefix}/result.json`),
    listS3Prefix(`${runPrefix}/`),
    ...trialIds.flatMap((tid) => [
      getS3File(`${runPrefix}/${tid}/result.json`),
      getS3File(`${runPrefix}/${tid}/verifier/test-stdout.txt`),
      getS3File(`${runPrefix}/${tid}/verifier/reward.txt`),
    ]),
  ])

  let manifest: z.infer<typeof ManifestSchema> | null = null
  if (manifestRaw) {
    try {
      manifest = ManifestSchema.parse(JSON.parse(manifestRaw))
    } catch {
      // best-effort
    }
  }

  let hasManualPatch = false
  if (runResultRaw) {
    try {
      const runResult = RunResultSchema.parse(JSON.parse(runResultRaw))
      hasManualPatch = !!runResult._manual_patch
    } catch {
      // best-effort
    }
  }

  const trials: TrialDetail[] = []
  let verifierStdout: string | null = null
  let verifierReward: string | null = null

  for (let i = 0; i < trialIds.length; i++) {
    const [trialRaw, stdout, reward] = trialBundles.slice(i * 3, i * 3 + 3)
    if (!trialRaw) continue
    const parsed = parseTrialResult(trialRaw)
    if (!parsed) continue
    const trial = trialFromParsed(trialIds[i], parsed.parsed, parsed.rawJson)
    trials.push(trial)
    if (parsed.parsed._manual_patch) hasManualPatch = true
    // capture verifier output from the first trial that has any
    if (verifierStdout == null && stdout) verifierStdout = stdout
    if (verifierReward == null && reward) verifierReward = reward
  }

  const summary = summarizeRun(runId, trials, manifest, hasManualPatch)
  const trial = trials.find((t) => t.trialId === summary.bestTrialId) ?? trials[0]

  if (!trial) {
    throw new Error(`run ${slug}/${runId} has no readable trial result.json`)
  }

  return {
    slug,
    runId,
    summary,
    trial,
    trials,
    verifierStdout,
    verifierReward,
    files,
    hasTrace: true, // trace lives at the legacy slug-flat prefix; existence is best-effort
  }
}

export const fetchRunDetail = createServerFn({ method: 'GET' })
  .inputValidator((d: { slug: string; runId: string }) => d)
  .handler(async ({ data }): Promise<RunDetail> => loadRunDetail(data.slug, data.runId))
