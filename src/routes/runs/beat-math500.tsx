import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { AgentStreamViewer } from '#/components/AgentStreamViewer'
import { CodeBlock } from '#/components/CodeBlock'
import { ReplayViewer } from '#/components/ReplayViewer'
import RouteErrorPanel from '#/components/RouteErrorPanel'
import SectionHead from '#/components/SectionHead'
import { SITE } from '#/lib/constants'
import { fmtCost, fmtReward } from '#/lib/formatters'
import { fetchRunData, type RunData } from '#/lib/run-fns'
import { TREE_THEME_COLORS } from '#/lib/tree-theme'

export const Route = createFileRoute('/runs/beat-math500')({
  head: () => ({
    meta: [
      { title: `beat-math500 run — ${SITE.title}` },
      { name: 'description', content: 'Agent run for beat-math500 task' },
    ],
  }),
  loader: async () => {
    return fetchRunData({ data: { slug: 'beat-math500' } })
  },
  component: RunDetail,
  errorComponent: ({ error }) => <RouteErrorPanel error={error} />,
})

type Tab = 'replay' | 'trace' | 'verifier' | 'result' | 'files'

function RunDetail() {
  const data = Route.useLoaderData() as RunData
  const [tab, setTab] = useState<Tab>('replay')

  const resultJson = useMemo(
    () => (data.result ? JSON.stringify(data.result.raw, null, 2) : ''),
    [data.result],
  )

  const hasTrace = !!data.agentTrace
  const hasVerifier = !!data.verifierStdout || !!data.verifierReward
  const hasResult = !!data.result
  const hasFiles = data.files.length > 0
  const hasData = hasTrace || hasVerifier || hasResult

  const reward = data.result?.reward
  const rewardColor =
    reward == null
      ? 'var(--ink-soft)'
      : reward >= 1
        ? '#065f46'
        : reward > 0
          ? '#92400e'
          : '#991b1b'

  return (
    <main className="page-wrap" style={{ paddingBlock: 'var(--space-6)' }}>
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <Link
          to="/tasks/$slug"
          params={{ slug: 'beat-math500' }}
          className="font-mono muted"
          style={{ fontSize: 'var(--fs-sm)' }}
        >
          ← beat-math500 task
        </Link>
      </div>

      <SectionHead label="/BEAT-MATH500 / RUN" />

      {/* hero: reward + key stats */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: 'var(--space-5)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div>
          <div
            className="font-mono"
            style={{
              fontSize: 'var(--fs-xs)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-soft)',
              marginBottom: 'var(--space-1)',
            }}
          >
            REWARD
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: '3rem',
              fontWeight: 700,
              lineHeight: 1,
              color: rewardColor,
            }}
          >
            {hasResult ? fmtReward(reward) : '—'}
          </div>
        </div>

        {hasResult && data.result && (
          <div className="font-mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-soft)' }}>
            {data.result.exit_code != null && (
              <span>
                exit {data.result.exit_code}
                {' · '}
              </span>
            )}
            {data.result.raw.accuracy != null && (
              <span style={{ color: 'var(--ink)' }}>
                accuracy: {String(data.result.raw.accuracy)}%{' · '}
              </span>
            )}
            {data.result.raw.cost_usd != null && <span>{fmtCost(data.result.raw.cost_usd)}</span>}
          </div>
        )}
      </div>

      {/* task context */}
      <div
        className="font-mono"
        style={{
          fontSize: 'var(--fs-sm)',
          color: 'var(--ink-soft)',
          marginBottom: 'var(--space-5)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
        }}
      >
        <span>
          paper <span style={{ color: 'var(--ink)' }}>2604-05355</span> (ETR)
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          model <span style={{ color: 'var(--ink)' }}>DeepSeek-R1-Distill-Qwen-7B</span>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          agent <span style={{ color: 'var(--ink)' }}>claude-opus-4-7</span>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          budget <span style={{ color: 'var(--ink)' }}>4h</span>
        </span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span>
          compute <span style={{ color: 'var(--ink)' }}>8× A100-80GB</span>
        </span>
      </div>

      {/* accuracy context */}
      <AccuracyBar />

      {!hasData && (
        <div
          style={{
            border: '1px solid var(--rule)',
            padding: 'var(--space-6)',
            textAlign: 'center',
            marginTop: 'var(--space-5)',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: 'var(--space-3)' }}>⏳</div>
          <h3
            className="font-mono"
            style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--space-2)' }}
          >
            run data not uploaded yet
          </h3>
          <p className="font-mono muted" style={{ fontSize: 'var(--fs-sm)' }}>
            the run is still in progress or results haven't been synced to S3.
            <br />
            upload to <code>s3://paper2eval/runs/beat-math500/</code> when ready.
          </p>
        </div>
      )}

      {hasData && (
        <>
          {/* tabs */}
          <div
            className="font-mono"
            style={{
              display: 'flex',
              gap: 0,
              borderBottom: '1px solid var(--rule)',
              marginBottom: 'var(--space-4)',
            }}
          >
            {hasTrace && (
              <TabBtn active={tab === 'replay'} onClick={() => setTab('replay')}>
                replay
              </TabBtn>
            )}
            {hasTrace && (
              <TabBtn active={tab === 'trace'} onClick={() => setTab('trace')}>
                agent trace
              </TabBtn>
            )}
            {hasVerifier && (
              <TabBtn active={tab === 'verifier'} onClick={() => setTab('verifier')}>
                verifier
              </TabBtn>
            )}
            {hasResult && (
              <TabBtn active={tab === 'result'} onClick={() => setTab('result')}>
                result.json
              </TabBtn>
            )}
            {hasFiles && (
              <TabBtn active={tab === 'files'} onClick={() => setTab('files')}>
                files ({data.files.length})
              </TabBtn>
            )}
          </div>

          {/* tab content */}
          {tab === 'replay' && data.agentTrace && <ReplayViewer content={data.agentTrace} />}
          {tab === 'trace' && data.agentTrace && <AgentStreamViewer content={data.agentTrace} />}

          {tab === 'verifier' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {data.verifierReward && (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <h3 className="meta-subhead">REWARD</h3>
                  <div className="font-mono" style={{ fontSize: '2rem', fontWeight: 700 }}>
                    {data.verifierReward.trim()}
                  </div>
                </div>
              )}
              {data.verifierStdout && (
                <div>
                  <h3 className="meta-subhead">VERIFIER OUTPUT</h3>
                  <CodeBlock content={data.verifierStdout} maxHeight={800} wrap />
                </div>
              )}
            </div>
          )}

          {tab === 'result' && data.result && (
            <CodeBlock content={resultJson} lang="json" maxHeight={600} />
          )}

          {tab === 'files' && hasFiles && <RunFileTree files={data.files} />}
        </>
      )}
    </main>
  )
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
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-sm)',
        padding: 'var(--space-2) var(--space-4)',
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--ink)' : 'var(--ink-soft)',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
        transition: 'color 100ms, border-color 100ms',
      }}
    >
      {children}
    </button>
  )
}

function AccuracyBar() {
  const baseline = 77.2
  const target = 81.456
  const paperBest = 85.0
  const sftResult = 85.6
  const min = 70
  const max = 90
  const pct = (v: number) => `${((v - min) / (max - min)) * 100}%`

  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <h3 className="meta-subhead">ACCURACY CONTEXT (MATH-500)</h3>
      <div
        style={{
          position: 'relative',
          height: '2rem',
          background: 'var(--paper-deep)',
          border: '1px solid var(--rule)',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        {/* filled bar to sft result */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: pct(sftResult),
            background: 'linear-gradient(90deg, var(--paper-deep), #dcfce780)',
            borderRight: '2px solid #065f46',
          }}
        />
        {/* markers */}
        <Marker
          value={baseline}
          min={min}
          max={max}
          label="baseline"
          sublabel={`${baseline}%`}
          color="var(--ink-soft)"
        />
        <Marker
          value={target}
          min={min}
          max={max}
          label="target"
          sublabel={`${target.toFixed(1)}%`}
          color="var(--accent)"
        />
        <Marker
          value={paperBest}
          min={min}
          max={max}
          label="paper"
          sublabel={`${paperBest}%`}
          color="#7c3aed"
        />
        <Marker
          value={sftResult}
          min={min}
          max={max}
          label="SFT@8k"
          sublabel={`${sftResult}%`}
          color="#065f46"
        />
      </div>
    </div>
  )
}

function Marker({
  value,
  min,
  max,
  label,
  sublabel,
  color,
}: {
  value: number
  min: number
  max: number
  label: string
  sublabel: string
  color: string
}) {
  const left = `${((value - min) / (max - min)) * 100}%`
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        transform: 'translateX(-50%)',
      }}
    >
      <div
        style={{
          width: '1px',
          flex: 1,
          background: color,
          opacity: 0.6,
        }}
      />
      <div
        className="font-mono"
        style={{
          position: 'absolute',
          top: '-1.3rem',
          fontSize: 'var(--fs-xs)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      <div
        className="font-mono"
        style={{
          position: 'absolute',
          bottom: '-1.3rem',
          fontSize: '0.6rem',
          color,
          whiteSpace: 'nowrap',
        }}
      >
        {sublabel}
      </div>
    </div>
  )
}

function RunFileTree({ files }: { files: { key: string; size: number }[] }) {
  const [mod, setMod] = useState<typeof import('@pierre/trees/react') | null>(null)
  const [treeStyles, setTreeStyles] = useState<Record<string, string>>({})
  const paths = useMemo(() => files.map((f) => f.key), [files])

  useEffect(() => {
    import('@pierre/trees/react').then(setMod)
    import('@pierre/trees').then(({ themeToTreeStyles }) => {
      setTreeStyles(
        themeToTreeStyles({
          type: 'light',
          bg: '#ede5d3',
          fg: '#141410',
          colors: TREE_THEME_COLORS,
        }),
      )
    })
  }, [])

  if (!mod) return null

  return (
    <RunFileTreeInner
      FileTree={mod.FileTree}
      useFileTree={mod.useFileTree}
      paths={paths}
      treeStyles={treeStyles}
    />
  )
}

function RunFileTreeInner({
  FileTree: TreeComponent,
  useFileTree: useTreeHook,
  paths,
  treeStyles,
}: {
  FileTree: typeof import('@pierre/trees/react').FileTree
  useFileTree: typeof import('@pierre/trees/react').useFileTree
  paths: string[]
  treeStyles: Record<string, string>
}) {
  const treeOpts = useMemo(
    () => ({
      paths,
      initialExpansion: 'open' as const,
      flattenEmptyDirectories: true,
      search: true,
      icons: 'standard' as const,
    }),
    [paths],
  )

  const { model } = useTreeHook(treeOpts)

  const mergedStyle = useMemo(() => ({ height: '400px', ...treeStyles }), [treeStyles])

  return <TreeComponent model={model} style={mergedStyle as React.CSSProperties} />
}
