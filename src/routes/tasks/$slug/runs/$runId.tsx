import { createFileRoute, defer, getRouteApi, Link } from '@tanstack/react-router'
import type { DeferredPromise } from '@tanstack/router-core'
import { useState } from 'react'
import RouteErrorPanel from '#/components/RouteErrorPanel'
import { AccuracyBar } from '#/components/run/AccuracyBar'
import { RunHero } from '#/components/run/RunHero'
import { RunTabContent, type RunTab, RunTabsBar } from '#/components/run/RunTabs'
import { SITE } from '#/lib/constants'
import { fetchAgentTrace, fetchRunDetail, type RunDetail } from '#/lib/runs.api'

const taskRoute = getRouteApi('/tasks/$slug')

export const Route = createFileRoute('/tasks/$slug/runs/$runId')({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} run ${params.runId} — ${SITE.title}` },
      { name: 'description', content: `Agent run ${params.runId} for ${params.slug}` },
    ],
  }),
  loader: async ({ params }) => {
    const detail = await fetchRunDetail({
      data: { slug: params.slug, runId: params.runId },
    })
    return {
      detail,
      trace: defer(fetchAgentTrace({ data: { slug: params.slug, runId: params.runId } })),
    }
  },
  component: RunDetailPage,
  errorComponent: ({ error }) => <RouteErrorPanel error={error} />,
})

type RunPageLoaderData = {
  detail: RunDetail
  trace: DeferredPromise<{ content: string | null }>
}

function rewardColor(reward: number | null): string {
  if (reward == null) return 'var(--color-ink-soft)'
  if (reward >= 1) return '#065f46'
  if (reward > 0) return '#92400e'
  return '#991b1b'
}

function RunDetailPage() {
  const { slug, claims } = taskRoute.useLoaderData()
  const { detail, trace } = Route.useLoaderData() as RunPageLoaderData

  const [tab, setTab] = useState<RunTab>('replay')

  const trial = detail.trial
  const hasVerifier = !!detail.verifierStdout || !!detail.verifierReward
  const hasFiles = detail.files.length > 0
  const hasPatch = !!trial.patchReason

  return (
    <main className="page-wrap py-8">
      <nav className="font-mono text-sm mb-6 flex items-baseline gap-2 flex-wrap">
        <Link to="/" className="muted">
          tasks
        </Link>
        <span className="text-rule">/</span>
        <Link to="/tasks/$slug" params={{ slug }} className="muted">
          {slug}
        </Link>
        <span className="text-rule">/</span>
        <span className="muted">runs</span>
        <span className="text-rule">/</span>
        <span className="text-ink">{detail.runId}</span>
      </nav>

      <RunHero
        summary={detail.summary}
        trial={trial}
        rewardColor={rewardColor(trial.reward)}
        claims={claims}
      />

      {claims.reward_thresholds.length > 0 && (
        <AccuracyBar
          claims={claims}
          measuredAccuracy={trial.measuredAccuracy}
          grader={trial.grader}
        />
      )}

      <RunTabsBar
        tab={tab}
        setTab={setTab}
        detail={detail}
        hasVerifier={hasVerifier}
        hasFiles={hasFiles}
        hasPatch={hasPatch}
      />

      <RunTabContent tab={tab} detail={detail} trace={trace} slug={slug} />
    </main>
  )
}
