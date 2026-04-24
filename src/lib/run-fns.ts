import { createServerFn } from '@tanstack/react-start'
import { getS3File, listS3Prefix } from './s3.server'

export type RunResult = {
  reward: number | null
  exit_code?: number
  // biome-ignore lint/suspicious/noExplicitAny: harbor result.json is deeply nested
  raw: Record<string, any>
}

export type RunData = {
  slug: string
  result: RunResult | null
  agentTrace: string | null
  verifierStdout: string | null
  verifierReward: string | null
  report: string | null
  experimentLog: string | null
  files: { key: string; size: number }[]
}

const RUN_PREFIX = 'tasks/beat-math500/_runs/2026-04-24__00-50-24'
const TRIAL_PREFIX = `${RUN_PREFIX}/beat-math500__TR4skcY`
const TRACE_KEY = 'runs/beat-math500/agent_logs/claude-code.txt'

export const fetchRunData = createServerFn({ method: 'GET' })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }): Promise<RunData> => {
    const { slug } = data

    const [resultRaw, agentTrace, verifierStdout, verifierReward, report, experimentLog, files] =
      await Promise.all([
        getS3File(`${TRIAL_PREFIX}/result.json`),
        getS3File(TRACE_KEY),
        getS3File(`${TRIAL_PREFIX}/verifier/test-stdout.txt`),
        getS3File(`${TRIAL_PREFIX}/verifier/reward.txt`),
        getS3File(`${RUN_PREFIX}/REPORT.md`),
        getS3File(`${RUN_PREFIX}/experiment_log.jsonl`),
        listS3Prefix(`${RUN_PREFIX}/`),
      ])

    let result: RunResult | null = null
    if (resultRaw) {
      try {
        const parsed = JSON.parse(resultRaw)
        const rewards = parsed.verifier_result?.rewards
        const primaryReward = rewards?.reward ?? parsed.reward ?? null
        result = {
          reward: typeof primaryReward === 'number' ? primaryReward : null,
          exit_code: parsed.exit_code,
          raw: parsed,
        }
      } catch {
        /* bad json */
      }
    }

    return {
      slug,
      result,
      agentTrace,
      verifierStdout,
      verifierReward,
      report,
      experimentLog,
      files,
    }
  })
