import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { InstructionCollapse, KV, MetricProgress, Panel, RewardRow } from '#/components/DetailParts'
import { FileExplorer } from '#/components/FileExplorer'
import { CreationLog, type Provenance } from '#/components/PipelineView'
import RouteErrorPanel from '#/components/RouteErrorPanel'
import SectionHead from '#/components/SectionHead'
import { SITE } from '#/lib/constants'
import { fetchAllTaskFiles, fetchTaskDetail } from '#/lib/server-fns'
import { formatBytes, formatDuration } from '#/lib/formatters'
import type { Claims, TaskToml } from '#/lib/tasks'

type LoaderData = {
  slug: string
  toml: TaskToml
  claims: Claims
  instructionHtml: string
  filePaths: string[]
  totalSize: number
  fileCount: number
  provenance: Provenance | null
}

export const Route = createFileRoute('/tasks/$slug/')({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — ${SITE.title}` },
      { name: 'description', content: `Task detail for ${params.slug}` },
    ],
  }),
  loader: async ({ params }) => {
    return fetchTaskDetail({ data: { slug: params.slug } })
  },
  component: TaskDetail,
  errorComponent: ({ error }) => <RouteErrorPanel error={error} />,
})

function TaskDetail() {
  const { slug, toml, claims, instructionHtml, filePaths, totalSize, fileCount, provenance } =
    Route.useLoaderData() as LoaderData

  const env = toml.environment

  return (
    <main className="page-wrap" style={{ paddingBlock: 'var(--space-6)' }}>
      <nav
        className="font-mono"
        style={{
          fontSize: 'var(--fs-sm)',
          marginBottom: 'var(--space-2)',
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--space-2)',
        }}
      >
        <Link to="/" className="muted">
          tasks
        </Link>
        <span style={{ color: 'var(--rule)' }}>/</span>
        <span style={{ color: 'var(--ink)' }}>{slug}</span>
      </nav>

      <SectionHead label={`/${slug.toUpperCase()}`} />

      <div style={{ marginBottom: 'var(--space-5)', maxWidth: '65ch' }}>
        <p
          className="font-body"
          style={{
            fontSize: 'var(--fs-md)',
            lineHeight: 1.5,
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          {claims.paper_title}
        </p>
        {claims.paper_id && (
          <p
            className="font-mono"
            style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--ink-soft)',
              margin: 'var(--space-1) 0 0 0',
            }}
          >
            arxiv:{claims.paper_id}
          </p>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <Panel title="METRIC">
          <KV label="metric" value={claims.metric_name} />
          <KV label="direction" value={claims.metric_direction} />
          <KV label="baseline" value={String(claims.baseline_value)} />
          <KV label="target" value={String(claims.target_value)} accent />
          <KV label="paper best" value={String(claims.paper_best_value)} />
          <MetricProgress
            baseline={claims.baseline_value}
            target={claims.target_value}
            paperBest={claims.paper_best_value}
            direction={claims.metric_direction}
          />
        </Panel>

        <Panel title="ENVIRONMENT">
          <KV label="gpus" value={`${env.gpus}× ${env.gpu_types.join(', ')}`} />
          <KV label="cpus" value={String(env.cpus)} />
          <KV label="memory" value={formatBytes(env.memory_mb * 1024 * 1024)} />
          <KV label="storage" value={formatBytes(env.storage_mb * 1024 * 1024)} />
          <KV label="internet" value={env.allow_internet ? 'yes' : 'no'} />
        </Panel>

        <Panel title="TIMING">
          <KV label="build timeout" value={formatDuration(env.build_timeout_sec)} />
          <KV label="agent timeout" value={formatDuration(toml.agent.timeout_sec)} accent />
          <KV label="verifier timeout" value={formatDuration(toml.verifier.timeout_sec)} />
        </Panel>

        <Panel title="MODEL">
          <KV label="base model" value={claims.base_model_hf_id} />
          <KV label="allowed" value={claims.allowed_models.join(', ')} />
          <KV label="datasets" value={claims.allowed_datasets.join(', ')} />
        </Panel>
      </div>

      {claims.reward_thresholds.length > 0 && (
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 className="meta-subhead">REWARD SCHEDULE</h2>
          <div
            className="font-mono"
            style={{
              fontSize: 'var(--fs-base)',
              display: 'grid',
              gridTemplateColumns: 'auto auto 1fr',
              gap: '0',
              maxWidth: '400px',
              border: '1px solid color-mix(in oklab, var(--rule) 50%, transparent)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: 'var(--space-1) var(--space-3)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--ink-soft)',
                fontWeight: 600,
                letterSpacing: '0.05em',
                borderBottom: '1px solid color-mix(in oklab, var(--rule) 50%, transparent)',
                background: 'color-mix(in oklab, var(--paper-deep) 60%, var(--paper))',
              }}
            >
              VALUE
            </div>
            <div
              style={{
                padding: 'var(--space-1) var(--space-3)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--ink-soft)',
                fontWeight: 600,
                letterSpacing: '0.05em',
                borderBottom: '1px solid color-mix(in oklab, var(--rule) 50%, transparent)',
                background: 'color-mix(in oklab, var(--paper-deep) 60%, var(--paper))',
              }}
            >
              REWARD
            </div>
            <div
              style={{
                borderBottom: '1px solid color-mix(in oklab, var(--rule) 50%, transparent)',
                background: 'color-mix(in oklab, var(--paper-deep) 60%, var(--paper))',
              }}
            />
            {/* Rows */}
            {claims.reward_thresholds.map((t, i) => {
              const isLast = i === claims.reward_thresholds.length - 1
              const borderB = isLast
                ? 'none'
                : '1px solid color-mix(in oklab, var(--rule) 30%, transparent)'
              const isHigh = t.reward >= 0.85
              return (
                <RewardRow
                  key={t.value}
                  value={t.value}
                  reward={t.reward}
                  isHigh={isHigh}
                  borderBottom={borderB}
                />
              )
            })}
          </div>
        </section>
      )}

      <section style={{ marginBottom: 'var(--space-6)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <h2 className="meta-subhead" style={{ margin: 0 }}>
            FILES — {fileCount} files · {formatBytes(totalSize)}
          </h2>
          <DownloadButton slug={slug} />
        </div>
        <FileExplorer paths={filePaths} slug={slug} />
      </section>

      {provenance && <CreationLog provenance={provenance} slug={slug} />}

      <InstructionCollapse instructionHtml={instructionHtml} />
    </main>
  )
}

function DownloadButton({ slug }: { slug: string }) {
  const [state, setState] = useState<'idle' | 'fetching' | 'zipping'>('idle')

  const handleDownload = useCallback(async () => {
    setState('fetching')
    try {
      const { files } = await fetchAllTaskFiles({ data: { slug } })
      setState('zipping')
      const { zipSync, strToU8 } = await import('fflate')
      const zipData: Record<string, Uint8Array> = {}
      for (const f of files) {
        zipData[f.path] = strToU8(f.content)
      }
      const zipped = zipSync(zipData)
      const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[download]', err)
    } finally {
      setState('idle')
    }
  }, [slug])

  return (
    <button
      type="button"
      className="download-btn font-mono"
      onClick={handleDownload}
      disabled={state !== 'idle'}
    >
      {state === 'idle' && (
        <>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          download .zip
        </>
      )}
      {state === 'fetching' && 'fetching files…'}
      {state === 'zipping' && 'zipping…'}
    </button>
  )
}
