import { Await } from '@tanstack/react-router'
import type { DeferredPromise } from '@tanstack/router-core'
import { Suspense } from 'react'
import { AgentStreamViewer } from '#/components/AgentStreamViewer'
import { CodeBlock } from '#/components/CodeBlock'
import { ReplayViewer } from '#/components/ReplayViewer'
import { RunFileTree } from '#/components/run/RunFileTree'
import type { RunDetail } from '#/lib/runs.api'

export type RunTab = 'replay' | 'trace' | 'verifier' | 'result' | 'files' | 'patch'

export function RunTabsBar({
  tab,
  setTab,
  detail,
  hasVerifier,
  hasFiles,
  hasPatch,
}: {
  tab: RunTab
  setTab: (tab: RunTab) => void
  detail: RunDetail
  hasVerifier: boolean
  hasFiles: boolean
  hasPatch: boolean
}) {
  return (
    <div className="font-mono flex flex-wrap gap-0 border-b border-rule mb-4">
      <TabBtn active={tab === 'replay'} onClick={() => setTab('replay')}>
        replay
      </TabBtn>
      <TabBtn active={tab === 'trace'} onClick={() => setTab('trace')}>
        agent trace
      </TabBtn>
      {hasVerifier && (
        <TabBtn active={tab === 'verifier'} onClick={() => setTab('verifier')}>
          verifier
        </TabBtn>
      )}
      <TabBtn active={tab === 'result'} onClick={() => setTab('result')}>
        result.json
      </TabBtn>
      {hasFiles && (
        <TabBtn active={tab === 'files'} onClick={() => setTab('files')}>
          files ({detail.files.length})
        </TabBtn>
      )}
      {hasPatch && (
        <TabBtn active={tab === 'patch'} onClick={() => setTab('patch')}>
          patch note
        </TabBtn>
      )}
    </div>
  )
}

export function RunTabContent({
  tab,
  detail,
  trace,
  slug,
}: {
  tab: RunTab
  detail: RunDetail
  trace: DeferredPromise<{ content: string | null }>
  slug: string
}) {
  const trial = detail.trial

  if (tab === 'replay' || tab === 'trace') {
    return (
      <Suspense fallback={<TraceSkeleton tab={tab} />}>
        <Await promise={trace}>
          {(t) =>
            t.content == null ? (
              <NoData
                title="agent trace not available"
                body={`no claude-code.txt found for ${slug}.`}
              />
            ) : tab === 'replay' ? (
              <ReplayViewer content={t.content} />
            ) : (
              <AgentStreamViewer content={t.content} />
            )
          }
        </Await>
      </Suspense>
    )
  }

  if (tab === 'verifier') {
    return (
      <div className="flex flex-col gap-4">
        {detail.verifierReward && (
          <div className="mb-4">
            <h3 className="meta-subhead">REWARD</h3>
            <div className="font-mono text-3xl font-bold">{detail.verifierReward.trim()}</div>
          </div>
        )}
        {detail.verifierStdout && (
          <div>
            <h3 className="meta-subhead">VERIFIER OUTPUT</h3>
            <CodeBlock content={detail.verifierStdout} maxHeight={800} wrap />
          </div>
        )}
      </div>
    )
  }

  if (tab === 'result') {
    return <CodeBlock content={trial.rawResultJson} lang="json" maxHeight={600} />
  }

  if (tab === 'files') {
    return <RunFileTree files={detail.files} />
  }

  if (tab === 'patch' && trial.patchReason) {
    return (
      <div className="font-mono p-4 bg-paper-deep border border-rule rounded text-sm leading-relaxed whitespace-pre-wrap">
        <div className="text-xs text-ink-soft uppercase tracking-[0.05em] mb-2">
          MANUAL PATCH
          {trial.grader && ` · grader: ${trial.grader}`}
        </div>
        {trial.patchReason}
      </div>
    )
  }

  return null
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono text-sm px-4 py-2 bg-transparent border-0 cursor-pointer transition-[color,border-color] duration-100 ${
        active
          ? 'border-b-2 border-accent text-ink font-semibold'
          : 'border-b-2 border-transparent text-ink-soft font-normal'
      }`}
    >
      {children}
    </button>
  )
}

function TraceSkeleton({ tab }: { tab: RunTab }) {
  return (
    <div className="font-mono p-6 border border-dashed border-rule rounded text-sm text-ink-soft text-center">
      loading {tab === 'replay' ? 'replay' : 'agent trace'}…
    </div>
  )
}

function NoData({ title, body }: { title: string; body: string }) {
  return (
    <div className="border border-rule p-8 text-center">
      <h3 className="font-mono text-md mb-2">{title}</h3>
      <p className="font-mono muted text-sm">{body}</p>
    </div>
  )
}
