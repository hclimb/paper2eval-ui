import { useCallback, useEffect, useState } from 'react'
import { CodeBlock } from '#/components/CodeBlock'
import { fetchTaskFile } from '#/lib/server-fns'

export type PipelinePhase = {
  name: string
  status: 'ok' | 'warn' | 'skip'
  detail: string
}

export type Provenance = {
  phases: PipelinePhase[]
  buildLogs: { name: string; path: string; size: number }[]
  agentTrace: { path: string; size: number } | null
  verifyLog: { path: string; size: number } | null
  stateFile: { path: string; size: number } | null
}

type CreationTab = 'pipeline' | 'trace' | 'verify' | 'build'

// biome-ignore lint/suspicious/noExplicitAny: raw state.json shape varies
type PipelineState = Record<string, any>

export function CreationLog({ provenance, slug }: { provenance: Provenance; slug: string }) {
  const [tab, setTab] = useState<CreationTab>('pipeline')
  const [pipelineState, setPipelineState] = useState<PipelineState | null>(null)
  const [traceContent, setTraceContent] = useState<string | null>(null)
  const [verifyContent, setVerifyContent] = useState<string | null>(null)
  const [buildContents, setBuildContents] = useState<Record<string, string>>({})
  const [loadingTab, setLoadingTab] = useState<string | null>(null)

  useEffect(() => {
    if (provenance.stateFile) {
      fetchTaskFile({ data: { slug, path: provenance.stateFile.path } }).then((res) => {
        try {
          setPipelineState(JSON.parse(res.content))
        } catch {
          /* bad json */
        }
      })
    }
  }, [slug, provenance.stateFile])

  const loadTab = useCallback(
    (t: CreationTab) => {
      setTab(t)
      if (t === 'trace' && !traceContent && provenance.agentTrace) {
        setLoadingTab('trace')
        fetchTaskFile({ data: { slug, path: provenance.agentTrace.path } }).then((res) => {
          setTraceContent(res.content)
          setLoadingTab(null)
        })
      }
      if (t === 'verify' && !verifyContent && provenance.verifyLog) {
        setLoadingTab('verify')
        fetchTaskFile({ data: { slug, path: provenance.verifyLog.path } }).then((res) => {
          setVerifyContent(res.content)
          setLoadingTab(null)
        })
      }
      if (
        t === 'build' &&
        Object.keys(buildContents).length === 0 &&
        provenance.buildLogs.length > 0
      ) {
        setLoadingTab('build')
        Promise.all(
          provenance.buildLogs.map((log) =>
            fetchTaskFile({ data: { slug, path: log.path } }).then((res) => ({
              name: log.name,
              content: res.content,
            })),
          ),
        ).then((logs) => {
          const map: Record<string, string> = {}
          for (const l of logs) map[l.name] = l.content
          setBuildContents(map)
          setLoadingTab(null)
        })
      }
    },
    [slug, provenance, traceContent, verifyContent, buildContents],
  )

  return (
    <section style={{ marginBottom: 'var(--space-6)' }}>
      <h2 className="meta-subhead" style={{ marginBottom: 'var(--space-3)' }}>
        HOW THIS TASK WAS CREATED
      </h2>

      <div className="creation-tabs">
        <button
          type="button"
          className="creation-tab"
          data-active={tab === 'pipeline'}
          onClick={() => loadTab('pipeline')}
        >
          <span className="tab-icon">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="7" cy="2.5" r="1.5" />
              <circle cx="7" cy="7" r="1.5" />
              <circle cx="7" cy="11.5" r="1.5" />
            </svg>
          </span>
          pipeline
        </button>
        {provenance.agentTrace && (
          <button
            type="button"
            className="creation-tab"
            data-active={tab === 'trace'}
            onClick={() => loadTab('trace')}
          >
            <span className="tab-icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <polyline points="3,4 6,7 3,10" />
                <line x1="7" y1="10" x2="11" y2="10" />
              </svg>
            </span>
            eval_gen trace
          </button>
        )}
        {provenance.verifyLog && (
          <button
            type="button"
            className="creation-tab"
            data-active={tab === 'verify'}
            onClick={() => loadTab('verify')}
          >
            <span className="tab-icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <polyline points="3,7.5 5.5,10 11,4" />
              </svg>
            </span>
            verification
          </button>
        )}
        {provenance.buildLogs.length > 0 && (
          <button
            type="button"
            className="creation-tab"
            data-active={tab === 'build'}
            onClick={() => loadTab('build')}
          >
            <span className="tab-icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="3" y="2" width="8" height="5" rx="1" />
                <line x1="7" y1="7" x2="7" y2="12" />
                <line x1="4" y1="12" x2="10" y2="12" />
              </svg>
            </span>
            build logs
          </button>
        )}
      </div>

      <div style={{ padding: 'var(--space-4) 0' }}>
        {loadingTab === tab && (
          <div
            className="font-mono muted"
            style={{ fontSize: 'var(--fs-sm)', padding: 'var(--space-4) 0' }}
          >
            loading…
          </div>
        )}

        {tab === 'pipeline' && <PipelineView state={pipelineState} phases={provenance.phases} />}

        {tab === 'trace' && traceContent && loadingTab !== 'trace' && (
          <LazyAgentStreamViewer content={traceContent} />
        )}

        {tab === 'verify' && verifyContent && loadingTab !== 'verify' && (
          <VerificationChecklist raw={verifyContent} />
        )}

        {tab === 'build' && Object.keys(buildContents).length > 0 && loadingTab !== 'build' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {Object.entries(buildContents).map(([name, content]) => (
              <div key={name}>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 'var(--fs-xs)',
                    color: name.includes('fail') ? 'var(--accent)' : 'var(--ink-soft)',
                    marginBottom: 'var(--space-2)',
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                  }}
                >
                  {name.includes('fail') ? '✗ ' : '✓ '}
                  {name}
                </div>
                <CodeBlock content={content} maxHeight={400} lang="bash" wrap />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function LazyAgentStreamViewer({ content }: { content: string }) {
  const [mod, setMod] = useState<{
    AgentStreamViewer: typeof import('#/components/AgentStreamViewer').AgentStreamViewer
  } | null>(null)

  useEffect(() => {
    import('#/components/AgentStreamViewer').then(setMod)
  }, [])

  if (!mod) return null

  return <mod.AgentStreamViewer content={content} />
}

function PipelineView({ state, phases }: { state: PipelineState | null; phases: PipelinePhase[] }) {
  if (!state) {
    return (
      <div className="font-mono" style={{ fontSize: 'var(--fs-base)' }}>
        {phases.map((p) => (
          <div
            key={p.name}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 14ch 1fr',
              gap: 'var(--space-3)',
              padding: '0.4rem 0',
              alignItems: 'center',
              borderBottom: '1px solid color-mix(in oklab, var(--rule) 40%, transparent)',
            }}
          >
            <span className={`status-dot status-dot--${p.status}`} />
            <span>{p.name}</span>
            <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              {p.detail}
            </span>
          </div>
        ))}
      </div>
    )
  }

  const pregate = state.pregate_verdict
  const comp = state.comprehension
  const prob = state.problem_extraction
  const disc = state.discovery_path
  const tasks = state.challenge_tasks
  const explore = state.exploration
  const env = state.env_spec

  return (
    <div className="pipeline-timeline">
      {pregate && (
        <PhaseCard
          num={0}
          name="PRE-GATE"
          status={pregate.proceed ? 'ok' : 'warn'}
          summary={pregate.tldr ?? pregate.reasoning ?? ''}
        >
          <PipeKV
            label="proceed"
            value={pregate.proceed ? 'yes' : 'no'}
            accent={!pregate.proceed}
          />
          {pregate.topics?.length > 0 && (
            <PipeKV label="topics" value={pregate.topics.join(', ')} />
          )}
          {pregate.citation_count != null && (
            <PipeKV label="citations" value={String(pregate.citation_count)} />
          )}
          {pregate.code_repo && <PipeKV label="code repo" value={pregate.code_repo} />}
        </PhaseCard>
      )}

      {comp && (
        <PhaseCard
          num={1}
          name="COMPREHENSION"
          status={comp.has_computational_experiments ? 'ok' : 'warn'}
          summary={`${comp.primary_method ?? '?'} · ${comp.framework ?? '?'} · ${comp.compute ?? '?'}`}
        >
          <PipeKV label="method" value={comp.primary_method ?? '?'} />
          <PipeKV label="framework" value={comp.framework ?? '?'} />
          <PipeKV label="compute" value={comp.compute ?? '?'} />
          {comp.models_used?.length > 0 && (
            <PipeKV
              label="models"
              value={comp.models_used
                .map((m: { name?: string; hf_id?: string }) => m.hf_id ?? m.name ?? '?')
                .join(', ')}
            />
          )}
          {comp.datasets_used?.length > 0 && (
            <PipeKV
              label="datasets"
              value={comp.datasets_used
                .map((d: { name?: string; hf_id?: string }) => d.hf_id ?? d.name ?? '?')
                .join(', ')}
            />
          )}
          {comp.open_source?.code_repo && (
            <PipeKV label="code" value={comp.open_source.code_repo} />
          )}
        </PhaseCard>
      )}

      {prob && (
        <PhaseCard
          num={2}
          name="PROBLEM EXTRACTION"
          status={
            prob.suitability === 'good' ||
            prob.suitability === 'excellent' ||
            prob.suitability === 'high'
              ? 'ok'
              : 'warn'
          }
          summary={`${prob.baseline?.metric_name ?? '?'}: ${prob.baseline?.metric_value ?? '?'} → ${prob.paper_best ?? '?'}`}
        >
          {prob.problem && <div className="problem-quote">{prob.problem}</div>}
          <PipeKV label="suitability" value={prob.suitability ?? '?'} />
          {prob.baseline && (
            <>
              <PipeKV
                label="baseline"
                value={`${prob.baseline.metric_value} (${prob.baseline.method ?? '?'})`}
              />
              <PipeKV
                label="metric"
                value={`${prob.baseline.metric_name} · ${prob.baseline.metric_direction}`}
              />
            </>
          )}
          <PipeKV label="paper best" value={String(prob.paper_best ?? '?')} />
          {prob.benchmark && (
            <PipeKV
              label="benchmark"
              value={`${prob.benchmark.name} · ${prob.benchmark.hf_id ?? '?'} · ${prob.benchmark.split ?? 'test'}`}
            />
          )}
        </PhaseCard>
      )}

      {disc && (
        <PhaseCard
          num={3}
          name="DISCOVERY PATH"
          status="ok"
          summary={`${disc.diagnosis_steps?.length ?? 0} diagnosis steps · ${disc.block_list?.method_names?.length ?? 0} blocked methods`}
        >
          {disc.diagnosis_steps?.map(
            (step: { instruction?: string; purpose?: string }, i: number) => (
              <div key={step.instruction ?? i} className="diagnosis-step">
                <span className="diagnosis-num">{i + 1}</span>
                <div>
                  <div
                    className="font-mono"
                    style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink)', lineHeight: 1.5 }}
                  >
                    {step.instruction}
                  </div>
                  {step.purpose && (
                    <div
                      className="font-mono muted"
                      style={{ fontSize: 'var(--fs-xs)', marginTop: '0.15rem' }}
                    >
                      {step.purpose}
                    </div>
                  )}
                </div>
              </div>
            ),
          )}
          {disc.block_list?.arxiv_ids?.length > 0 && (
            <PipeKV label="blocked arxiv" value={disc.block_list.arxiv_ids.join(', ')} />
          )}
        </PhaseCard>
      )}

      {tasks?.tasks?.length > 0 && (
        <PhaseCard
          num={4}
          name="CHALLENGE TASKS"
          status="ok"
          summary={`${tasks.tasks.length} task(s) generated`}
        >
          {tasks.tasks.map(
            (t: {
              slug?: string
              difficulty?: string
              estimated_gpu_hours?: number
              research_goal?: string
            }) => (
              <div key={t.slug} style={{ marginBottom: 'var(--space-2)' }}>
                <PipeKV label="slug" value={t.slug ?? '?'} />
                <PipeKV label="difficulty" value={t.difficulty ?? '?'} />
                {t.estimated_gpu_hours != null && (
                  <PipeKV label="est. GPU hours" value={String(t.estimated_gpu_hours)} />
                )}
              </div>
            ),
          )}
        </PhaseCard>
      )}

      {explore && (
        <PhaseCard
          num={5}
          name="RESOURCE VERIFICATION"
          status="ok"
          summary={`${Object.keys(explore.models ?? {}).length} models · ${Object.keys(explore.datasets ?? {}).length} datasets · ${Object.keys(explore.benchmarks ?? {}).length} benchmarks`}
        >
          {Object.keys(explore.models ?? {}).length > 0 && (
            <div className="inventory-group">
              <div className="inventory-group-label">Models</div>
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th style={{ width: '2ch' }} />
                    <th>ID</th>
                    <th>Size</th>
                    <th>Architecture</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(
                    (explore.models ?? {}) as Record<
                      string,
                      {
                        verified?: boolean
                        size_gb?: number
                        architecture?: string
                        usage_role?: string
                      }
                    >,
                  ).map(([id, info]) => (
                    <tr key={id}>
                      <td>
                        <span
                          className={`status-dot ${info.verified !== false ? 'status-dot--ok' : 'status-dot--warn'}`}
                        />
                      </td>
                      <td style={{ fontWeight: 500 }}>{id}</td>
                      <td className="muted">{info.size_gb ? `${info.size_gb} GB` : '--'}</td>
                      <td className="muted">{info.architecture ?? '--'}</td>
                      <td className="muted">{info.usage_role ?? '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {Object.keys(explore.datasets ?? {}).length > 0 && (
            <div className="inventory-group">
              <div className="inventory-group-label">Datasets</div>
              <table className="inventory-table">
                <thead>
                  <tr>
                    <th style={{ width: '2ch' }} />
                    <th>ID</th>
                    <th>Splits</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(
                    (explore.datasets ?? {}) as Record<string, { splits?: Record<string, number> }>,
                  ).map(([id, info]) => (
                    <tr key={id}>
                      <td>
                        <span className="status-dot status-dot--ok" />
                      </td>
                      <td style={{ fontWeight: 500 }}>{id}</td>
                      <td className="muted">
                        {info.splits
                          ? Object.entries(info.splits)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(', ')
                          : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PhaseCard>
      )}

      {env && (
        <PhaseCard
          num={6}
          name="ENVIRONMENT SPEC"
          status="ok"
          summary={`${env.gpu_count ?? '?'}× ${env.gpu_type ?? '?'} · ${env.agent_timeout_hours ?? '?'}h agent · ${env.ram_gb ?? '?'} GB RAM`}
        >
          <PipeKV label="GPU" value={`${env.gpu_count ?? '?'}× ${env.gpu_type ?? '?'}`} />
          <PipeKV label="RAM" value={`${env.ram_gb ?? '?'} GB`} />
          <PipeKV label="disk" value={`${env.disk_gb ?? '?'} GB`} />
          <PipeKV label="CPUs" value={String(env.cpus ?? '?')} />
          <PipeKV label="agent timeout" value={`${env.agent_timeout_hours ?? '?'}h`} />
          <PipeKV label="build timeout" value={`${env.build_timeout_sec ?? '?'}s`} />
          <PipeKV label="verifier timeout" value={`${env.verifier_timeout_sec ?? '?'}s`} />
        </PhaseCard>
      )}
    </div>
  )
}

function PhaseCard({
  num,
  name,
  status,
  summary,
  children,
}: {
  num: number
  name: string
  status: 'ok' | 'warn' | 'skip'
  summary: string
  children: React.ReactNode
}) {
  return (
    <details className="phase-card">
      <span className="phase-num">{num}</span>
      <summary
        className="font-mono"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          fontSize: 'var(--fs-base)',
          cursor: 'pointer',
          userSelect: 'none',
          padding: 'var(--space-2) 0',
          minWidth: 0,
        }}
      >
        <span className={`status-dot status-dot--${status}`} />
        <span style={{ fontWeight: 600, flexShrink: 0 }}>{name}</span>
        <span
          className="muted phase-summary-text"
          style={{ fontSize: 'var(--fs-sm)', fontWeight: 400 }}
        >
          {summary}
        </span>
      </summary>
      <div className="font-mono phase-body" style={{ fontSize: 'var(--fs-base)' }}>
        {children}
      </div>
    </details>
  )
}

function PipeKV({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)', padding: '0.15rem 0' }}>
      <span className="muted" style={{ minWidth: '12ch', fontSize: 'var(--fs-sm)' }}>
        {label}
      </span>
      <span
        style={{
          color: accent ? 'var(--accent)' : 'var(--ink)',
          fontSize: 'var(--fs-sm)',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function VerificationChecklist({ raw }: { raw: string }) {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw)
  } catch {
    return <CodeBlock content={raw} lang="json" maxHeight={400} />
  }

  const models = data.models as
    | Record<string, { exists?: boolean; params?: string; size_gb?: number }>
    | undefined
  const datasets = data.datasets as Record<string, { splits?: Record<string, number> }> | undefined
  const benchmarks = data.benchmarks as
    | Record<
        string,
        { question_column?: string; answer_column?: string; splits?: Record<string, number> }
      >
    | undefined

  return (
    <div className="font-mono" style={{ fontSize: 'var(--fs-base)' }}>
      {typeof data.code_repo === 'string' && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div
            className="muted"
            style={{
              fontSize: 'var(--fs-xs)',
              letterSpacing: '0.08em',
              marginBottom: 'var(--space-1)',
            }}
          >
            CODE REPO
          </div>
          <span style={{ color: 'var(--ink)' }}>{data.code_repo}</span>
        </div>
      )}

      {models && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div
            className="muted"
            style={{
              fontSize: 'var(--fs-xs)',
              letterSpacing: '0.08em',
              marginBottom: 'var(--space-2)',
            }}
          >
            MODELS
          </div>
          {Object.entries(models).map(([name, info]) => (
            <div key={name} style={{ padding: '0.2rem 0', display: 'flex', gap: 'var(--space-3)' }}>
              <span style={{ color: info.exists !== false ? 'var(--ink)' : 'var(--accent)' }}>
                {info.exists !== false ? '✓' : '✗'}
              </span>
              <span>{name}</span>
              {info.size_gb && <span className="muted">{info.size_gb} GB</span>}
            </div>
          ))}
        </div>
      )}

      {datasets && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div
            className="muted"
            style={{
              fontSize: 'var(--fs-xs)',
              letterSpacing: '0.08em',
              marginBottom: 'var(--space-2)',
            }}
          >
            DATASETS
          </div>
          {Object.entries(datasets).map(([name, info]) => (
            <div key={name} style={{ padding: '0.2rem 0', display: 'flex', gap: 'var(--space-3)' }}>
              <span style={{ color: 'var(--ink)' }}>✓</span>
              <span>{name}</span>
              {info.splits && (
                <span className="muted">
                  {Object.entries(info.splits)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(', ')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {benchmarks && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div
            className="muted"
            style={{
              fontSize: 'var(--fs-xs)',
              letterSpacing: '0.08em',
              marginBottom: 'var(--space-2)',
            }}
          >
            BENCHMARKS
          </div>
          {Object.entries(benchmarks).map(([name, info]) => (
            <div
              key={name}
              style={{
                padding: '0.2rem 0',
                display: 'flex',
                gap: 'var(--space-3)',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ color: 'var(--ink)' }}>✓</span>
              <span>{name}</span>
              {info.question_column && <span className="muted">q: {info.question_column}</span>}
              {info.answer_column && <span className="muted">a: {info.answer_column}</span>}
              {info.splits && (
                <span className="muted">
                  {Object.entries(info.splits)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(', ')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
