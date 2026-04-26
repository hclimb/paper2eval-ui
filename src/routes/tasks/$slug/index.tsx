import { Await, createFileRoute, defer, getRouteApi, Link } from '@tanstack/react-router'
import type { DeferredPromise } from '@tanstack/router-core'
import { type ReactNode, Suspense, useCallback, useState } from 'react'
import type { Provenance } from '#/components/CreationLog'
import { FileExplorer } from '#/components/FileExplorer'
import { InstructionCollapse } from '#/components/Instruction'
import { PipelineTimeline } from '#/components/PipelineTimeline'
import RouteErrorPanel from '#/components/RouteErrorPanel'
import { SITE } from '#/lib/constants'
import { fmtReward, formatBytes, formatDuration } from '#/lib/formatters'
import { fetchRunList, type RunSummary } from '#/lib/runs.api'
import {
  fetchAllTaskFiles,
  fetchTaskHeavy,
  fetchTaskValidation,
  type TaskMeta,
  type TaskValidation,
} from '#/lib/tasks.api'
import type { Claims, TaskToml } from '#/lib/tasks'

const taskRoute = getRouteApi('/tasks/$slug')

type IndexLoaderData = {
  instructionHtml: string
  filePaths: string[]
  totalSize: number
  fileCount: number
  provenance: Provenance | null
  meta: TaskMeta | null
  runs: RunSummary[]
  validation: DeferredPromise<TaskValidation>
}

export const Route = createFileRoute('/tasks/$slug/')({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} — ${SITE.title}` },
      { name: 'description', content: `Task detail for ${params.slug}` },
    ],
  }),
  loader: async ({ params }) => {
    const [heavy, runs] = await Promise.all([
      fetchTaskHeavy({ data: { slug: params.slug } }),
      fetchRunList({ data: { slug: params.slug } }),
    ])
    return {
      ...heavy,
      runs,
      validation: defer(fetchTaskValidation({ data: { slug: params.slug } })),
    }
  },
  component: TaskDetail,
  errorComponent: ({ error }) => <RouteErrorPanel error={error} />,
})

function TaskDetail() {
  const { slug, toml, claims } = taskRoute.useLoaderData()
  const { instructionHtml, filePaths, totalSize, fileCount, meta, runs, validation } =
    Route.useLoaderData() as IndexLoaderData

  return (
    <main className="page-wrap py-8">
      <nav className="font-mono text-sm mb-6 flex items-baseline gap-2">
        <Link to="/" className="muted">
          tasks
        </Link>
        <span className="text-rule">/</span>
        <span className="text-ink">{slug}</span>
      </nav>

      <h1 className="font-body text-2xl font-semibold text-ink leading-tight max-w-[70ch] mb-2">
        {claims.paper_title}
      </h1>
      {claims.paper_id && (
        <p className="font-mono text-sm mb-10">
          <a
            href={`https://arxiv.org/abs/${claims.paper_id}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink-soft hover:text-accent"
          >
            arxiv:{claims.paper_id} ↗
          </a>
        </p>
      )}

      {/* ── PART 1: THE TASK ─────────────────────────────────── */}
      <Group label="The task" subtitle="what the agent must do">
        <Section title="Goal">
          <TaskGoal claims={claims} agentTimeoutSec={toml.agent.timeout_sec} />
        </Section>

        <Section title="Scoring">
          <ScoringSection claims={claims} sample={meta?.benchmark} />
        </Section>

        <Section title="Numbers">
          <NumbersSection claims={claims} provenance={meta?.provenance ?? null} />
        </Section>

        <Section title="Sandbox">
          <SandboxSection toml={toml} claims={claims} />
        </Section>

        <Section title="Instruction (raw)">
          <InstructionCollapse instructionHtml={instructionHtml} />
        </Section>
      </Group>

      {/* ── PART 2: THE PAPER ────────────────────────────────── */}
      {meta && (
        <Group label="The paper" subtitle="what the original research is about">
          {meta.research.problem && (
            <Section title="Problem (paper's words)">
              <Prose>{meta.research.problem}</Prose>
            </Section>
          )}

          {meta.research.solutionBrief && (
            <Section title="Approach (paper's words)">
              <Prose>{meta.research.solutionBrief}</Prose>
            </Section>
          )}

          <Section title="Paper meta">
            <PaperSection paper={meta.paper} research={meta.research} claims={claims} />
          </Section>

          {meta.paper.hasFullContent && (
            <Section title="Full paper">
              <p className="font-mono text-sm">
                <Link
                  to="/tasks/$slug/paper"
                  params={{ slug }}
                  className="text-ink hover:text-accent"
                >
                  open paper reader →
                </Link>
              </p>
            </Section>
          )}
        </Group>
      )}

      {/* ── PART 3: HOW IT WAS BUILT ─────────────────────────── */}
      {(meta?.pipeline.steps.length ?? 0) > 0 && (
        <Group label="How it was built" subtitle="paper2eval pipeline that turned the paper into this task">
          <PipelineTimeline steps={meta?.pipeline.steps ?? []} />
        </Group>
      )}

      {/* ── PART 4: RESULTS & ARTIFACTS ──────────────────────── */}
      <Group label="Results & artifacts" subtitle="runs, validation, source files">
        <Section title={`Runs · ${runs.length}`}>
          <RunsSection slug={slug} runs={runs} target={claims.target_value} />
        </Section>

        <Section title="Validation">
          <Suspense fallback={<Hint>loading validation…</Hint>}>
            <Await promise={validation}>{(v) => <ValidationSection v={v} />}</Await>
          </Suspense>
        </Section>

        <Section title={`Files · ${fileCount} · ${formatBytes(totalSize)}`}>
          <div className="flex justify-end mb-3">
            <DownloadButton slug={slug} />
          </div>
          <FileExplorer paths={filePaths} slug={slug} />
        </Section>
      </Group>
    </main>
  )
}

function Group({
  label,
  subtitle,
  children,
}: {
  label: string
  subtitle: string
  children: ReactNode
}) {
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return (
    <section id={id} className="mt-20 first-of-type:mt-12 mb-4 scroll-mt-20">
      <header className="bg-ink text-paper px-3 py-2 mb-8 flex items-baseline gap-3 flex-wrap">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] font-bold m-0 leading-none">
          {label}
        </h2>
        <span className="font-mono text-[10px] leading-none opacity-60">
          //
        </span>
        <span className="font-mono text-[11px] lowercase leading-none opacity-80">
          {subtitle}
        </span>
      </header>
      <div>{children}</div>
    </section>
  )
}

function TaskGoal({
  claims,
  agentTimeoutSec,
}: {
  claims: Claims
  agentTimeoutSec: number
}) {
  const direction = claims.metric_direction === 'higher_is_better' ? '↑' : '↓'
  const verb = claims.metric_direction === 'higher_is_better' ? 'Push' : 'Drive'
  const baseModelShort =
    claims.base_model_hf_id.split('/').pop() ?? claims.base_model_hf_id
  const dataset = claims.allowed_datasets[0]
  const datasetShort = dataset ? (dataset.split('/').pop() ?? dataset) : null
  const moreDatasets = claims.allowed_datasets.length - 1

  return (
    <div className="space-y-4">
      <p className="font-body text-2xl text-ink leading-tight max-w-[60ch] m-0 font-medium">
        {verb} {claims.metric_name} on {claims.benchmark_name} from{' '}
        <span className="tabular-nums">{claims.baseline_value.toFixed(1)}</span> {direction}{' '}
        <span className="tabular-nums text-accent font-semibold">
          {claims.target_value.toFixed(1)}
        </span>{' '}
        within {formatDuration(agentTimeoutSec)}.
      </p>

      {(baseModelShort || datasetShort) && (
        <p className="font-body text-base text-ink-soft leading-relaxed max-w-[65ch] m-0">
          Starting from{' '}
          <a
            href={`https://huggingface.co/${claims.base_model_hf_id}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink hover:text-accent"
          >
            {baseModelShort}
          </a>
          {datasetShort && (
            <>
              , training on{' '}
              <a
                href={`https://huggingface.co/datasets/${dataset}`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-ink hover:text-accent"
              >
                {datasetShort}
              </a>
              {moreDatasets > 0 && (
                <span className="text-ink-soft"> +{moreDatasets} more</span>
              )}
            </>
          )}
          .
        </p>
      )}

      <details className="pt-2">
        <summary className="font-mono text-xs text-ink-soft uppercase tracking-wider cursor-pointer hover:text-ink select-none">
          show full task spec
        </summary>
        <p className="font-body text-sm text-ink leading-relaxed max-w-[75ch] mt-3 m-0">
          {claims.research_goal}
        </p>
      </details>
    </div>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="font-mono text-xs text-ink-soft m-0">{children}</p>
}

// ─── primitives ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-12">
      <h3 className="font-mono text-sm text-ink uppercase tracking-[0.12em] font-semibold border-b border-rule pb-2 mb-5">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-4 py-1 font-mono text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="text-ink break-words">{children}</span>
    </div>
  )
}

function Prose({ children }: { children: ReactNode }) {
  return (
    <p className="font-body text-base text-ink leading-relaxed max-w-[75ch] m-0">{children}</p>
  )
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-ink hover:text-accent break-all"
    >
      {children} ↗
    </a>
  )
}

function repoShort(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
}

// ─── sections ────────────────────────────────────────────────────────

function ScoringSection({
  claims,
  sample,
}: {
  claims: Claims
  sample: TaskMeta['benchmark'] | undefined
}) {
  return (
    <div className="space-y-4">
      {claims.metric_description && (
        <div>
          <div className="font-mono text-xs text-ink-soft uppercase tracking-wider mb-1">
            metric — {claims.metric_name}
          </div>
          <Prose>{claims.metric_description}</Prose>
        </div>
      )}
      {claims.eval_protocol && (
        <div>
          <div className="font-mono text-xs text-ink-soft uppercase tracking-wider mb-1">
            protocol
          </div>
          <Prose>{claims.eval_protocol}</Prose>
        </div>
      )}
      <dl className="m-0">
        <Row label="benchmark">
          {claims.benchmark_name}
          {claims.benchmark_hf_id && (
            <>
              {' · '}
              <ExtLink href={`https://huggingface.co/datasets/${claims.benchmark_hf_id}`}>
                {claims.benchmark_hf_id}
              </ExtLink>
            </>
          )}
        </Row>
        {claims.benchmark_split && (
          <Row label="split">
            {claims.benchmark_split}
            {sample?.testRows != null && (
              <span className="text-ink-soft"> · {sample.testRows.toLocaleString()} rows</span>
            )}
          </Row>
        )}
        {claims.metric_lower_bound != null && claims.metric_upper_bound != null && (
          <Row label="metric range">
            {claims.metric_lower_bound} – {claims.metric_upper_bound}
          </Row>
        )}
      </dl>
      {sample?.sampleQuestion && (
        <details className="mt-3">
          <summary className="font-mono text-xs text-ink-soft uppercase tracking-wider cursor-pointer hover:text-ink select-none">
            sample problem
          </summary>
          <div className="mt-3 p-4 bg-paper-deep border-l-2 border-rule">
            <div className="font-mono text-xs text-ink-soft mb-2">QUESTION</div>
            <p className="font-body text-sm text-ink leading-relaxed whitespace-pre-wrap">
              {sample.sampleQuestion}
            </p>
            {sample.sampleAnswer && (
              <>
                <div className="font-mono text-xs text-ink-soft mt-3 mb-1">ANSWER</div>
                <p className="font-mono text-sm text-ink m-0">{sample.sampleAnswer}</p>
              </>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

type NumberMark = {
  value: number
  label: string
  highlight?: boolean
}

function NumbersSection({
  claims,
  provenance,
}: {
  claims: Claims
  provenance: TaskMeta['provenance'] | null
}) {
  const meta = claims._meta ?? {}
  const paperBaseline = typeof meta.paper_baseline === 'number' ? meta.paper_baseline : null
  const paperBest = typeof meta.paper_best === 'number' ? meta.paper_best : null
  const rescaled = !!meta.scope_rescaled
  const showPaperAxis = paperBaseline != null && paperBest != null

  const allValues = [
    claims.baseline_value,
    claims.target_value,
    claims.paper_best_value,
    ...(showPaperAxis ? [paperBaseline, paperBest] : []),
  ]
  const padding = (Math.max(...allValues) - Math.min(...allValues)) * 0.12 + 1
  const minV = Math.floor(Math.min(...allValues) - padding)
  const maxV = Math.ceil(Math.max(...allValues) + padding)
  const pct = (v: number) => ((v - minV) / (maxV - minV)) * 100

  const taskMarks: NumberMark[] = [
    { value: claims.baseline_value, label: 'baseline' },
    { value: claims.target_value, label: 'target', highlight: true },
    { value: claims.paper_best_value, label: 'best (rescaled)' },
  ]
  const paperMarks: NumberMark[] = showPaperAxis
    ? [
        { value: paperBaseline, label: 'baseline' },
        { value: paperBest, label: 'best' },
      ]
    : []

  const tickValues = [minV, Math.round((minV + maxV) / 2), maxV]

  return (
    <div className="space-y-6">
      <div className="bg-paper-deep/30 border border-rule rounded-sm px-5 pt-6 pb-3">
        {showPaperAxis && (
          <NumberAxis label="paper" marks={paperMarks} pct={pct} variant="muted" />
        )}
        <NumberAxis label="this task" marks={taskMarks} pct={pct} variant="primary" />
        <div className="ml-24 mr-4 flex justify-between font-mono text-[10px] tabular-nums text-ink-soft pt-1 border-t border-rule">
          {tickValues.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>

      {rescaled && (
        <p className="font-body text-sm text-ink-soft leading-relaxed max-w-[65ch] m-0">
          Paper numbers were rescaled to fit this task's smaller compute envelope. The relative
          headroom between baseline and best is preserved, so the agent's challenge is
          equivalent in difficulty.
        </p>
      )}

      {provenance && (provenance.baselineTableRef || provenance.paperBestTableRef) && (
        <details>
          <summary className="font-mono text-xs text-ink-soft uppercase tracking-wider cursor-pointer hover:text-ink select-none">
            where these numbers came from
          </summary>
          <div className="mt-4 space-y-5">
            {provenance.baselineTableRef && (
              <CitationBlock
                label={`baseline (${(paperBaseline ?? claims.baseline_value).toFixed(1)})`}
                source={provenance.baselineTableRef}
                citation={provenance.baselineCitation}
              />
            )}
            {provenance.paperBestTableRef && (
              <CitationBlock
                label={`paper best (${(paperBest ?? claims.paper_best_value).toFixed(1)})`}
                source={provenance.paperBestTableRef}
                citation={provenance.paperBestCitation}
              />
            )}
          </div>
        </details>
      )}
    </div>
  )
}

function NumberAxis({
  label,
  marks,
  pct,
  variant,
}: {
  label: string
  marks: NumberMark[]
  pct: (v: number) => number
  variant: 'primary' | 'muted'
}) {
  const sortedMarks = [...marks].sort((a, b) => a.value - b.value)
  const lineClass = variant === 'primary' ? 'bg-ink' : 'bg-rule'
  const dotClass = variant === 'primary' ? 'bg-ink' : 'bg-ink-soft'

  return (
    <div className="flex items-stretch mb-7">
      <div className="w-24 shrink-0 pt-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft leading-none">
          {label}
        </div>
      </div>
      <div className="flex-1 relative h-16 mr-4 min-w-0">
        <div className={`absolute top-3 left-0 right-0 h-px ${lineClass}`} />
        {sortedMarks.map((m) => {
          const left = pct(m.value)
          const isHighlight = !!m.highlight
          return (
            <div
              key={`${m.label}-${m.value}`}
              className="absolute -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${left}%`, top: 0 }}
            >
              <div
                className={`w-2.5 h-2.5 mt-2 rounded-full ${
                  isHighlight ? 'bg-accent ring-2 ring-accent/30' : dotClass
                }`}
              />
              <div
                className={`mt-2 font-mono tabular-nums leading-none whitespace-nowrap ${
                  isHighlight
                    ? 'text-accent font-semibold text-base'
                    : variant === 'primary'
                      ? 'text-ink text-sm'
                      : 'text-ink-soft text-sm'
                }`}
              >
                {m.value.toFixed(1)}
              </div>
              <div
                className={`mt-1 font-mono text-[10px] uppercase tracking-wider whitespace-nowrap leading-none ${
                  isHighlight ? 'text-accent' : 'text-ink-soft'
                }`}
              >
                {m.label}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SandboxSection({
  toml,
  claims,
}: {
  toml: TaskToml
  claims: Claims
}) {
  const env = toml.environment
  const ramGb = Math.round((env.memory_mb * 1024 * 1024) / 1e9)
  const blocked = claims.block_list?.arxiv_ids ?? []

  return (
    <div className="space-y-7">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft mb-3">
          compute
        </div>
        <dl className="m-0">
          <Row label="gpus">
            <span className="tabular-nums">{env.gpus}</span>
            {' × '}
            {env.gpu_types.join(', ')}
          </Row>
          <Row label="ram">
            <span className="tabular-nums">{ramGb}</span> GB
          </Row>
          <Row label="cpus">
            <span className="tabular-nums">{env.cpus}</span>
          </Row>
          <Row label="internet">{env.allow_internet ? 'allowed' : 'blocked'}</Row>
        </dl>
      </div>

      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft mb-3">
          agent
        </div>
        <dl className="m-0">
          <Row label="time budget">
            <span className="text-accent font-semibold tabular-nums">
              {formatDuration(toml.agent.timeout_sec)}
            </span>
          </Row>
          <Row label="base model">
            <ExtLink href={`https://huggingface.co/${claims.base_model_hf_id}`}>
              {claims.base_model_hf_id}
            </ExtLink>
          </Row>
          {claims.allowed_datasets.length > 0 && (
            <Row label="training data">
              {claims.allowed_datasets.map((d, i) => (
                <span key={d}>
                  {i > 0 && ', '}
                  <ExtLink href={`https://huggingface.co/datasets/${d}`}>{d}</ExtLink>
                </span>
              ))}
            </Row>
          )}
          {blocked.length > 0 && (
            <Row label="blocked refs">
              {blocked.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <ExtLink href={`https://arxiv.org/abs/${id}`}>arxiv:{id}</ExtLink>
                </span>
              ))}
            </Row>
          )}
        </dl>
      </div>
    </div>
  )
}

function PaperSection({
  paper,
  research,
}: {
  paper: TaskMeta['paper']
  research: TaskMeta['research']
  claims: Claims
}) {
  const authorList =
    paper.authors.length === 0
      ? '—'
      : paper.authors.length <= 3
        ? paper.authors.join(', ')
        : `${paper.authors.slice(0, 3).join(', ')} +${paper.authors.length - 3}`

  return (
    <div className="space-y-5">
      {paper.abstract && (
        <div>
          <div className="font-mono text-xs text-ink-soft uppercase tracking-wider mb-2">
            abstract
          </div>
          <p className="font-body text-sm text-ink leading-relaxed max-w-[75ch] m-0">
            {paper.abstract}
          </p>
        </div>
      )}

      <dl className="m-0">
        <Row label="authors">{authorList}</Row>
        {paper.published && <Row label="published">{paper.published}</Row>}
        {research.primaryMethod && <Row label="method">{research.primaryMethod}</Row>}
        {research.framework && <Row label="framework">{research.framework}</Row>}
        {research.paperCompute && <Row label="paper compute">{research.paperCompute}</Row>}
        {paper.codeRepo && (
          <Row label="code">
            <ExtLink href={paper.codeRepo}>{repoShort(paper.codeRepo)}</ExtLink>
          </Row>
        )}
        {paper.pdfUrl && (
          <Row label="pdf">
            <ExtLink href={paper.pdfUrl}>{repoShort(paper.pdfUrl)}</ExtLink>
          </Row>
        )}
        {paper.topics.length > 0 && (
          <Row label="topics">{paper.topics.slice(0, 5).join(', ')}</Row>
        )}
      </dl>

      {(research.methodsCompared.length > 0 ||
        research.modelsCompared.length > 0 ||
        research.benchmarksCompared.length > 0) && (
        <details className="mt-3">
          <summary className="font-mono text-xs text-ink-soft uppercase tracking-wider cursor-pointer hover:text-ink select-none">
            related work in the paper
          </summary>
          <dl className="m-0 mt-3">
            {research.methodsCompared.length > 0 && (
              <Row label="methods">{research.methodsCompared.join(', ')}</Row>
            )}
            {research.modelsCompared.length > 0 && (
              <Row label="models">
                {research.modelsCompared.map((m) => m.name.split('/').pop()).join(', ')}
              </Row>
            )}
            {research.benchmarksCompared.length > 0 && (
              <Row label="benchmarks">
                {research.benchmarksCompared.map((b) => b.name).join(', ')}
              </Row>
            )}
            {paper.keyReferenceCount > 0 && (
              <Row label="references">{paper.keyReferenceCount} cited papers</Row>
            )}
          </dl>
          {research.selectionReasoning && (
            <p className="font-mono text-xs text-ink-soft leading-relaxed mt-3 max-w-[75ch]">
              <span className="uppercase tracking-wider">why this benchmark: </span>
              {research.selectionReasoning}
            </p>
          )}
        </details>
      )}
    </div>
  )
}

function CitationBlock({
  label,
  source,
  citation,
}: {
  label: string
  source: string
  citation: string | null
}) {
  return (
    <div>
      <div className="font-mono text-xs text-ink-soft uppercase tracking-wider mb-1">{label}</div>
      <p className="font-mono text-sm text-ink m-0 mb-2">{source}</p>
      {citation && (
        <pre
          className="font-mono text-xs text-ink m-0 p-3 bg-paper-deep border-l-2 border-rule overflow-x-auto whitespace-pre-wrap"
          style={{ wordBreak: 'normal' }}
        >
          {citation}
        </pre>
      )}
    </div>
  )
}

function ValidationSection({ v }: { v: TaskValidation }) {
  if (!v.leakAudit && !v.resources) {
    return <Hint>no validation logs.</Hint>
  }
  return (
    <div className="space-y-6">
      {v.leakAudit && (
        <div>
          <div className="flex items-baseline gap-3 mb-2 flex-wrap">
            <Badge ok={v.leakAudit.allClean}>
              {v.leakAudit.allClean ? 'no paper leakage' : 'leak detected'}
            </Badge>
            <span className="font-mono text-xs text-ink-soft">
              {v.leakAudit.rounds} round{v.leakAudit.rounds !== 1 ? 's' : ''} audited
            </span>
          </div>
          {v.leakAudit.latestAssessment && (
            <p className="font-body text-sm text-ink-soft leading-relaxed mt-2 max-w-[75ch]">
              {v.leakAudit.latestAssessment}
            </p>
          )}
        </div>
      )}
      {v.resources && (
        <div>
          <div className="flex items-baseline gap-3 mb-2 flex-wrap">
            <Badge ok={v.resources.notFound.length === 0}>
              {v.resources.notFound.length === 0 ? 'resources verified' : 'resources missing'}
            </Badge>
            <span className="font-mono text-xs text-ink-soft">
              {v.resources.modelsExisting}/{v.resources.modelsChecked} models ·{' '}
              {v.resources.datasetsExisting}/{v.resources.datasetsChecked} datasets ·{' '}
              {v.resources.benchmarksExisting}/{v.resources.benchmarksChecked} benchmarks
            </span>
          </div>
          {v.resources.notFound.length > 0 && (
            <p className="font-mono text-xs text-ink-soft m-0 mb-2">
              not found: {v.resources.notFound.join(', ')}
            </p>
          )}
          {v.resources.notes && (
            <p className="font-body text-sm text-ink-soft leading-relaxed mt-2 max-w-[75ch] whitespace-pre-wrap m-0">
              {v.resources.notes}
            </p>
          )}
        </div>
      )}
      {v.resources?.externalCorpora && v.resources.externalCorpora.length > 0 && (
        <div>
          <div className="font-mono text-xs text-ink-soft uppercase tracking-wider mb-2">
            external corpora
          </div>
          <ul className="m-0 p-0 list-none space-y-3">
            {v.resources.externalCorpora.map((c) => (
              <li key={c.name}>
                <div className="font-mono text-sm text-ink">{c.name}</div>
                {c.description && (
                  <p className="font-body text-sm text-ink-soft leading-relaxed mt-0.5 max-w-[75ch] m-0">
                    {c.description}
                  </p>
                )}
                {c.citation && (
                  <p className="font-mono text-xs text-ink-soft mt-1 max-w-[75ch] m-0 italic">
                    "{c.citation}"
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  const cls = ok
    ? 'inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider px-2 py-0.5 rounded-sm'
    : 'inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider px-2 py-0.5 rounded-sm'
  const style = ok
    ? { background: '#d1fae5', color: '#065f46' }
    : { background: '#fee2e2', color: '#991b1b' }
  return (
    <span className={cls} style={style}>
      <span aria-hidden="true">{ok ? '✓' : '✗'}</span>
      {children}
    </span>
  )
}

// ─── runs ────────────────────────────────────────────────────────────

function RunsSection({ slug, runs, target }: { slug: string; runs: RunSummary[]; target: number }) {
  if (runs.length === 0) {
    return (
      <div className="font-mono p-4 border border-dashed border-rule rounded text-sm text-ink-soft">
        no runs yet — kick one off and it'll show up here.
      </div>
    )
  }
  return (
    <div className="border border-rule/50 rounded overflow-hidden">
      <div className="font-mono runs-header grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr_1fr_0.8fr] gap-3 px-3 py-2 text-xs text-ink-soft uppercase tracking-[0.05em] font-semibold bg-paper-deep/60 border-b border-rule/50">
        <span>run</span>
        <span>reward</span>
        <span>accuracy</span>
        <span>status</span>
        <span>agent</span>
        <span className="text-right">duration</span>
      </div>
      {runs.map((r, i) => (
        <RunRow key={r.runId} slug={slug} run={r} target={target} isLast={i === runs.length - 1} />
      ))}
    </div>
  )
}

function RunRow({
  slug,
  run,
  target,
  isLast,
}: {
  slug: string
  run: RunSummary
  target: number
  isLast: boolean
}) {
  const accuracyHitsTarget = run.measuredAccuracy != null && run.measuredAccuracy >= target
  return (
    <Link
      to="/tasks/$slug/runs/$runId"
      params={{ slug, runId: run.runId }}
      className={`font-mono grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr_1fr_0.8fr] gap-3 p-3 text-sm text-ink no-underline items-baseline ${
        isLast ? '' : 'border-b border-rule/30'
      }`}
    >
      <span className="text-ink font-medium">{run.runId}</span>
      <span className="text-ink">{fmtReward(run.reward)}</span>
      <span className={accuracyHitsTarget ? 'text-accent font-semibold' : 'text-ink'}>
        {run.measuredAccuracy != null ? `${run.measuredAccuracy.toFixed(1)}%` : '—'}
      </span>
      <span>
        <StatusPill status={run.status} />
      </span>
      <span className="muted text-xs">{run.agent.model}</span>
      <span className="muted text-xs text-right">
        {run.durationSec != null ? formatDuration(run.durationSec) : '—'}
      </span>
    </Link>
  )
}

function StatusPill({ status }: { status: RunSummary['status'] }) {
  const colorMap: Record<RunSummary['status'], { fg: string; bg: string }> = {
    ok: { fg: '#065f46', bg: '#d1fae5' },
    patched: { fg: '#92400e', bg: '#fef3c7' },
    crashed: { fg: '#991b1b', bg: '#fee2e2' },
    unknown: { fg: 'var(--color-ink-soft)', bg: 'transparent' },
  }
  const c = colorMap[status]
  return (
    <span
      className="inline-block px-2 text-xs font-semibold uppercase tracking-[0.05em] rounded-[2px]"
      style={{ background: c.bg, color: c.fg }}
    >
      {status}
    </span>
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
            aria-label="download"
          >
            <title>download</title>
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
