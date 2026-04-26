import { createFileRoute, Link } from '@tanstack/react-router'
import RouteErrorPanel from '#/components/RouteErrorPanel'
import SectionHead from '#/components/SectionHead'
import { SITE } from '#/lib/constants'
import { fetchTaskList } from '#/lib/server-fns'
import { formatBytes, formatDuration } from '#/lib/formatters'
import type { TaskSummary } from '#/lib/tasks'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [{ title: SITE.title }, { name: 'description', content: SITE.description }],
  }),
  loader: async () => {
    const tasks = await fetchTaskList()
    return { tasks }
  },
  component: TaskList,
  errorComponent: ({ error }) => <RouteErrorPanel error={error} />,
})

function TaskList() {
  const { tasks } = Route.useLoaderData()

  return (
    <main className="page-wrap" style={{ paddingBlock: 'var(--space-6)' }}>
      <SectionHead label="/TASKS" />
      <p
        className="font-mono"
        style={{
          fontSize: 'var(--fs-sm)',
          color: 'var(--ink-soft)',
          margin: '0 0 var(--space-5) 0',
          lineHeight: 1.5,
        }}
      >
        {tasks.length} evaluation environment{tasks.length !== 1 ? 's' : ''} — each reproducing a
        specific ML paper claim with defined metrics, compute budgets, and reward thresholds.
      </p>

      {tasks.length === 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-7) var(--space-4)',
            border: '1px dashed var(--rule)',
            borderRadius: '4px',
          }}
        >
          <span
            className="font-mono"
            style={{
              fontSize: 'var(--fs-xl)',
              color: 'var(--rule)',
              marginBottom: 'var(--space-3)',
            }}
          >
            ∅
          </span>
          <p
            className="font-mono"
            style={{
              fontSize: 'var(--fs-base)',
              color: 'var(--ink-soft)',
              margin: 0,
              textAlign: 'center',
            }}
          >
            No tasks found in s3://paper2eval/tasks/
          </p>
          <p
            className="font-mono"
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--ink-soft)',
              margin: 'var(--space-2) 0 0 0',
              textAlign: 'center',
            }}
          >
            Tasks appear here once a paper claim is converted to an evaluation environment.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {tasks.map((t) => (
          <TaskCard key={t.slug} task={t} />
        ))}
      </div>
    </main>
  )
}

function TaskCard({ task }: { task: TaskSummary }) {
  const { slug, toml, claims } = task
  const env = toml.environment

  return (
    <Link
      to="/tasks/$slug"
      params={{ slug }}
      className="no-underline"
      style={{ color: 'inherit', textDecoration: 'none' }}
    >
      <article
        className="task-card"
        style={{
          padding: 'var(--space-4)',
          background: 'var(--paper-deep)',
          display: 'flex',
          alignItems: 'stretch',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="font-mono"
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-1)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--fs-xl)',
                fontWeight: 600,
                color: 'var(--ink)',
                letterSpacing: '-0.01em',
              }}
            >
              {slug}
            </span>
            <span
              style={{
                fontSize: 'var(--fs-xs)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--accent)',
                fontWeight: 600,
              }}
            >
              {toml.metadata.difficulty}
            </span>
            <span
              className="muted"
              style={{
                fontSize: 'var(--fs-xs)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {toml.metadata.category}
            </span>
          </div>

          <p
            className="font-mono"
            style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--ink-soft)',
              margin: '0 0 var(--space-3) 0',
              lineHeight: 1.5,
              maxWidth: '60ch',
            }}
          >
            {claims.paper_title}
          </p>

          <div
            className="font-mono"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
              fontSize: 'var(--fs-xs)',
            }}
          >
            <MetricPill
              label={claims.metric_name}
              baseline={claims.baseline_value}
              target={claims.target_value}
              best={claims.paper_best_value}
              direction={claims.metric_direction}
            />
            <Pill label="gpu" value={`${env.gpus}× ${env.gpu_types[0] ?? '?'}`} />
            <Pill label="time" value={formatDuration(toml.agent.timeout_sec)} />
            <Pill label="ram" value={formatBytes(env.memory_mb * 1024 * 1024)} />
            <Pill label="model" value={claims.base_model_hf_id.split('/').pop() ?? '?'} />
          </div>

          {claims.reward_thresholds.length > 0 && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <RewardBar thresholds={claims.reward_thresholds} target={claims.target_value} />
            </div>
          )}
        </div>

        <div
          className="card-chevron font-mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 'var(--fs-lg)',
            paddingLeft: 'var(--space-2)',
          }}
        >
          →
        </div>
      </article>
    </Link>
  )
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="muted">{label}</span> <span style={{ color: 'var(--ink)' }}>{value}</span>
    </span>
  )
}

function MetricPill({
  label,
  baseline,
  target,
  best,
  direction,
}: {
  label: string
  baseline: number
  target: number
  best: number
  direction: string
}) {
  const arrow = direction === 'higher_is_better' ? '↑' : '↓'
  return (
    <span>
      <span className="muted">{label}</span> <span style={{ color: 'var(--ink)' }}>{baseline}</span>
      <span
        style={{
          color: 'var(--accent)',
          fontWeight: 600,
          letterSpacing: '0.02em',
        }}
      >
        {' '}
        → {target}
      </span>
      <span className="muted" style={{ fontSize: '0.9em' }}>
        {' '}
        / {best} {arrow}
      </span>
    </span>
  )
}

function RewardBar({
  thresholds,
  target,
}: {
  thresholds: { value: number; reward: number }[]
  target: number
}) {
  if (thresholds.length < 2) return null
  const min = thresholds[0].value
  const max = thresholds[thresholds.length - 1].value
  const range = max - min
  if (range <= 0) return null

  const targetPct = Math.min(100, Math.max(0, ((target - min) / range) * 100))

  return (
    <div className="font-mono" style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 'var(--fs-xs)',
          color: 'var(--ink-soft)',
          marginBottom: 'var(--space-1)',
          lineHeight: 1,
        }}
      >
        <span>{min}</span>
        <span>{max}</span>
      </div>
      <div
        style={{
          position: 'relative',
          height: '6px',
          background: 'var(--rule)',
          borderRadius: '3px',
          overflow: 'visible',
        }}
      >
        {thresholds.map((t) => {
          const pct = ((t.value - min) / range) * 100
          return (
            <div
              key={t.value}
              title={`${t.value} → reward ${t.reward}`}
              style={{
                position: 'absolute',
                left: `${pct}%`,
                top: '-1px',
                width: '2px',
                height: '8px',
                background: t.reward >= 0.85 ? 'var(--accent)' : 'var(--ink-soft)',
              }}
            />
          )
        })}
        <div
          title={`target: ${target}`}
          style={{
            position: 'absolute',
            left: `${targetPct}%`,
            top: '-4px',
            width: '0',
            height: '0',
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop: '6px solid var(--accent)',
            transform: 'translateX(-4px)',
          }}
        />
      </div>
      <div
        style={{
          position: 'relative',
          height: 'var(--fs-xs)',
          marginTop: '2px',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: `${targetPct}%`,
            transform: 'translateX(-50%)',
            fontSize: 'var(--fs-xs)',
            color: 'var(--accent)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            lineHeight: 1,
          }}
        >
          target {target}
        </span>
      </div>
    </div>
  )
}
