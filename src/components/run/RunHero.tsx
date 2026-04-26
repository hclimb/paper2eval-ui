import { fmtReward, formatDuration } from '#/lib/formatters'
import type { RunDetail, RunSummary } from '#/lib/runs.api'
import type { Claims } from '#/lib/tasks'

export function RunHero({
  summary,
  trial,
  rewardColor,
  claims,
}: {
  summary: RunSummary
  trial: RunDetail['trial']
  rewardColor: string
  claims: Claims
}) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-6 mb-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.1em] text-ink-soft mb-1">
            REWARD
          </div>
          <div
            className="font-mono text-5xl font-bold leading-none"
            style={{ color: rewardColor }}
          >
            {fmtReward(summary.reward)}
          </div>
        </div>

        <div className="font-mono text-sm text-ink-soft">
          {trial.exitCode != null && <span>exit {trial.exitCode} · </span>}
          {trial.measuredAccuracy != null && (
            <span className="text-ink">
              accuracy: {trial.measuredAccuracy.toFixed(2)}%{' · '}
            </span>
          )}
          {summary.durationSec != null && <span>{formatDuration(summary.durationSec)}</span>}
        </div>
      </div>

      <div className="font-mono text-sm text-ink-soft mb-6 flex flex-wrap gap-3">
        {claims.paper_id && (
          <>
            <span>
              paper <span className="text-ink">{claims.paper_id}</span>
            </span>
            <span className="opacity-40">·</span>
          </>
        )}
        <span>
          base model{' '}
          <span className="text-ink">
            {claims.base_model_hf_id.split('/').pop() ?? claims.base_model_hf_id}
          </span>
        </span>
        <span className="opacity-40">·</span>
        <span>
          agent <span className="text-ink">{summary.agent.model}</span>
        </span>
        {summary.startedAt && (
          <>
            <span className="opacity-40">·</span>
            <span>
              started <span className="text-ink">{summary.startedAt.replace('T', ' ')}</span>
            </span>
          </>
        )}
        {summary.status === 'patched' && (
          <>
            <span className="opacity-40">·</span>
            <span className="font-semibold" style={{ color: '#92400e' }}>
              patched
            </span>
          </>
        )}
      </div>
    </>
  )
}
