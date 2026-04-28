import { type ReactNode, useEffect, useState } from 'react'
import type { ResourceEntry, TimelineStep, TimelineStepPayload } from '#/lib/tasks.api'

export function PipelineTimeline({ steps }: { steps: TimelineStep[] }) {
  const [activeStep, setActiveStep] = useState<number>(steps[0]?.num ?? 1)

  // intersection observer to track which step is in view
  useEffect(() => {
    const observers: IntersectionObserver[] = []
    const els = steps
      .map((s) => document.getElementById(`pipeline-step-${s.num}`))
      .filter((el): el is HTMLElement => el != null)
    if (els.length === 0) return

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        )
        const num = Number(top.target.id.replace('pipeline-step-', ''))
        if (!Number.isNaN(num)) setActiveStep(num)
      },
      { rootMargin: '-30% 0% -50% 0%', threshold: 0 },
    )
    for (const el of els) obs.observe(el)
    observers.push(obs)
    return () => {
      for (const o of observers) o.disconnect()
    }
  }, [steps])

  if (steps.length === 0) {
    return <p className="font-mono text-sm text-ink-soft">no pipeline state recorded.</p>
  }

  return (
    <div>
      {/* sticky step navigator */}
      <nav
        className="sticky z-10 mt-2 -mx-3 px-3 py-2.5 mb-10 bg-paper border border-rule rounded-sm overflow-x-hidden"
        style={{ top: '3.5rem' }}
        aria-label="Pipeline steps"
      >
        <ol className="flex flex-wrap gap-1 m-0 p-0 list-none">
          {steps.map((s) => (
            <li key={s.num}>
              <a
                href={`#pipeline-step-${s.num}`}
                className={`inline-flex items-baseline gap-2 px-2.5 py-1 font-mono text-xs uppercase tracking-wider rounded-sm transition-colors ${
                  activeStep === s.num
                    ? 'bg-ink text-paper'
                    : 'text-ink-soft hover:text-ink hover:bg-paper-deep/60'
                }`}
              >
                <span className="tabular-nums opacity-60">{String(s.num).padStart(2, '0')}</span>
                <span>{s.name}</span>
                {s.status !== 'ok' && (
                  <span
                    aria-hidden="true"
                    className="inline-block w-1 h-1 rounded-full"
                    style={{ background: s.status === 'warn' ? '#92400e' : 'var(--color-rule)' }}
                  />
                )}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-14">
        {steps.map((step) => (
          <StepCard key={step.num} step={step} />
        ))}
      </div>
    </div>
  )
}

function StepCard({ step }: { step: TimelineStep }) {
  return (
    <article
      id={`pipeline-step-${step.num}`}
      className="scroll-mt-36 grid grid-cols-[3.5rem_1fr] gap-4"
    >
      <div className="relative">
        <div className="sticky top-36 pt-1">
          <span className="font-mono text-4xl tabular-nums leading-none text-ink-soft/40 select-none block">
            {String(step.num).padStart(2, '0')}
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <header className="mb-5">
          <div className="flex items-baseline gap-3 flex-wrap mb-1.5">
            <h3 className="font-mono text-xl text-ink uppercase tracking-[0.05em] font-bold m-0 leading-none">
              {step.name}
            </h3>
            <StatusPill status={step.status} />
          </div>
          <p className="font-body text-base text-ink leading-snug max-w-[65ch] m-0">
            {step.decision}
          </p>
        </header>
        <DeepDive step={step} />
      </div>
    </article>
  )
}

function StatusPill({ status }: { status: TimelineStep['status'] }) {
  if (status === 'ok')
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-ink-soft">
        <span
          aria-hidden="true"
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: '#10b981' }}
        />
        done
      </span>
    )
  if (status === 'warn')
    return (
      <span
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider"
        style={{ color: '#92400e' }}
      >
        <span
          aria-hidden="true"
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: '#92400e' }}
        />
        warning
      </span>
    )
  return (
    <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">skipped</span>
  )
}

// ─── shared primitives ───────────────────────────────────────────────

function H4({ children }: { children: ReactNode }) {
  return (
    <h4 className="font-mono text-xs text-ink-soft uppercase tracking-wider m-0 mb-2 mt-6 first:mt-0">
      {children}
    </h4>
  )
}

function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="border border-rule/60 bg-paper-deep/40 px-3 py-2">
      <div className="font-mono text-[10px] text-ink-soft uppercase tracking-wider mb-0.5">
        {label}
      </div>
      <div
        className={`font-mono text-base tabular-nums ${accent ? 'text-accent font-semibold' : 'text-ink'}`}
      >
        {value}
      </div>
    </div>
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

function Quote({ children, attribution }: { children: ReactNode; attribution?: string }) {
  return (
    <blockquote className="border-l-2 border-accent pl-4 py-1 m-0">
      <p className="font-body text-base text-ink leading-relaxed m-0 max-w-[70ch]">{children}</p>
      {attribution && (
        <footer className="font-mono text-xs text-ink-soft mt-1 uppercase tracking-wider">
          — {attribution}
        </footer>
      )}
    </blockquote>
  )
}

function Bar({ ratio, color = 'var(--color-accent)' }: { ratio: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <div className="h-1.5 bg-paper-deep border border-rule/40 rounded-sm overflow-hidden">
      <div className="h-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

// ─── deep-dive dispatcher ────────────────────────────────────────────

function DeepDive({ step }: { step: TimelineStep }) {
  switch (step.payload.kind) {
    case 'pregate':
      return <PregateDive p={step.payload} />
    case 'comprehension':
      return <ComprehensionDive p={step.payload} />
    case 'problem':
      return <ProblemDive p={step.payload} />
    case 'discovery':
      return <DiscoveryDive p={step.payload} />
    case 'challenge':
      return <ChallengeDive p={step.payload} />
    case 'verification':
      return <VerificationDive p={step.payload} />
    case 'sizing':
      return <SizingDive p={step.payload} />
    case 'build':
      return null
  }
}

// ─── PRE-GATE ────────────────────────────────────────────────────────

function PregateDive({ p }: { p: Extract<TimelineStepPayload, { kind: 'pregate' }> }) {
  return (
    <div>
      {p.gates.length > 0 && (
        <div className="mb-6">
          <H4>Three gates checked</H4>
          <div className="grid gap-3 sm:grid-cols-3">
            {p.gates.map((g) => {
              const m = g.match(/^\((\d+)\)\s*(.+)$/)
              const num = m?.[1] ?? '·'
              const text = m?.[2] ?? g
              const [headline, ...rest] = text.split('—')
              return (
                <div
                  key={g}
                  className="border-l-2 px-3 py-2"
                  style={{ borderColor: '#10b981', background: '#d1fae5/30' }}
                >
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-mono text-xs text-ink-soft tabular-nums">{num}</span>
                    <span className="font-mono text-sm uppercase tracking-wider text-ink font-semibold">
                      {headline.trim().toLowerCase()}
                    </span>
                    <span style={{ color: '#10b981' }} className="ml-auto text-sm">
                      ✓
                    </span>
                  </div>
                  {rest.length > 0 && (
                    <p className="font-body text-sm text-ink-soft leading-relaxed m-0">
                      {rest.join('—').trim()}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      {p.topics.length > 0 && (
        <div className="mb-6">
          <H4>Topics</H4>
          <div className="flex flex-wrap gap-1.5">
            {p.topics.map((t) => (
              <span
                key={t}
                className="inline-block px-2 py-0.5 text-xs font-mono bg-paper-deep border border-rule rounded-sm"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
      {p.references.length > 0 && (
        <div className="mb-6">
          <H4>Cited references · {p.references.length}</H4>
          <details>
            <summary className="font-mono text-xs text-ink-soft cursor-pointer hover:text-ink select-none">
              show all arxiv ids
            </summary>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-0.5 mt-3 font-mono text-xs">
              {p.references.map((id) => (
                <a
                  key={id}
                  href={`https://arxiv.org/abs/${id}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-ink-soft hover:text-accent"
                >
                  arxiv:{id}
                </a>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

// ─── COMPREHENSION ───────────────────────────────────────────────────

function ComprehensionDive({ p }: { p: Extract<TimelineStepPayload, { kind: 'comprehension' }> }) {
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
        <Stat label="primary method" value={p.primaryMethod ?? '—'} accent />
        <Stat label="framework" value={p.framework ?? '—'} />
        <Stat label="paper's compute" value={p.paperCompute ?? '—'} />
      </div>

      {p.methods.length > 0 && (
        <div className="mb-6">
          <H4>Methods discussed · {p.methods.length}</H4>
          <div className="flex flex-wrap gap-1.5">
            {p.methods.map((m) => (
              <span
                key={m}
                className={`inline-block px-2.5 py-0.5 text-xs font-mono border rounded-sm ${
                  m === p.primaryMethod
                    ? 'bg-accent text-paper border-accent font-semibold'
                    : 'bg-paper-deep border-rule text-ink-soft'
                }`}
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {p.models.length > 0 && (
        <div className="mb-6">
          <H4>Models used by the paper · {p.models.length}</H4>
          <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
            {p.models.map((m) => (
              <div key={m.name} className="border border-rule/60 px-3 py-2">
                <div className="font-mono text-sm text-ink font-semibold">{m.name}</div>
                <div className="font-mono text-[10px] text-ink-soft uppercase tracking-wider mt-0.5">
                  {m.role}
                </div>
                {m.usage && (
                  <p className="font-body text-xs text-ink-soft leading-relaxed mt-1 m-0">
                    {m.usage}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {p.benchmarks.length > 0 && (
        <div className="mb-6">
          <H4>Benchmarks discussed · {p.benchmarks.length}</H4>
          <ul className="list-none m-0 p-0 space-y-2">
            {p.benchmarks.map((b) => (
              <li key={b.name} className="border-l-2 border-rule pl-3 py-0.5">
                <div className="font-mono text-sm text-ink">
                  <span className="font-semibold">{b.name}</span>
                  {b.type && (
                    <span className="ml-2 text-xs text-ink-soft uppercase tracking-wider">
                      {b.type}
                    </span>
                  )}
                </div>
                {b.description && (
                  <p className="font-body text-sm text-ink-soft leading-relaxed mt-0.5 m-0">
                    {b.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.externalDependencies.length > 0 && (
        <div className="mb-6">
          <H4>External dependencies · {p.externalDependencies.length}</H4>
          <ul className="list-none m-0 p-0 space-y-2">
            {p.externalDependencies.map((d) => (
              <li key={d.name} className="font-mono text-sm">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[10px] text-ink-soft uppercase tracking-wider">
                    {d.kind}
                  </span>
                  <span className="text-ink">{d.name}</span>
                  {d.required && (
                    <span className="text-[10px] text-accent uppercase tracking-wider">
                      required
                    </span>
                  )}
                </div>
                {d.usage && (
                  <p className="font-body text-xs text-ink-soft leading-relaxed mt-0.5 m-0">
                    {d.usage}
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

// ─── PROBLEM EXTRACTION ──────────────────────────────────────────────

function ProblemDive({ p }: { p: Extract<TimelineStepPayload, { kind: 'problem' }> }) {
  const altMax = Math.max(...p.alternatives.map((a) => a.items ?? 0), 1)
  return (
    <div>
      {p.problem && (
        <div className="mb-6">
          <H4>The problem</H4>
          <Quote attribution="paper">{p.problem}</Quote>
        </div>
      )}
      {p.solutionBrief && (
        <div className="mb-6">
          <H4>The approach</H4>
          <Quote attribution="paper">{p.solutionBrief}</Quote>
        </div>
      )}

      {p.alternatives.length > 1 && (
        <div className="mb-6">
          <H4>Why {p.benchmark.name} won — benchmarks considered</H4>
          <div className="space-y-2 max-w-md">
            {p.alternatives.map((a) => {
              const picked = a.name === p.benchmark.name
              const ratio = (a.items ?? 0) / altMax
              return (
                <div key={a.name} className="grid grid-cols-[6rem_1fr_4rem] items-center gap-3">
                  <span
                    className={`font-mono text-sm ${picked ? 'text-accent font-semibold' : 'text-ink-soft'}`}
                  >
                    {a.name}
                    {picked && <span className="ml-1">✓</span>}
                  </span>
                  <Bar
                    ratio={ratio}
                    color={picked ? 'var(--color-accent)' : 'var(--color-ink-soft)'}
                  />
                  <span className="font-mono text-xs text-ink-soft tabular-nums text-right">
                    {a.items ?? '—'}
                  </span>
                </div>
              )
            })}
          </div>
          {p.selectionReasoning && (
            <p className="font-body text-sm text-ink-soft leading-relaxed mt-3 max-w-[70ch] m-0">
              {p.selectionReasoning}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <div>
          <H4>Baseline · {p.baseline.metricValue ?? '?'}</H4>
          <div className="border border-rule/60 p-3 space-y-1 font-mono text-sm">
            {p.baseline.method && <KV label="method" value={p.baseline.method} />}
            {p.baseline.model && <KV label="model" value={p.baseline.model} />}
            {p.baseline.metricName && (
              <KV
                label="metric"
                value={`${p.baseline.metricName} · ${p.baseline.metricDirection}`}
              />
            )}
            {p.baseline.metricLowerBound != null && p.baseline.metricUpperBound != null && (
              <KV
                label="range"
                value={`${p.baseline.metricLowerBound} – ${p.baseline.metricUpperBound}`}
              />
            )}
            {p.baseline.decoding && <KV label="decoding" value={p.baseline.decoding} />}
            {p.baseline.maxResponseLength != null && (
              <KV label="max tokens" value={p.baseline.maxResponseLength.toLocaleString()} />
            )}
            {p.baseline.nSamples != null && (
              <KV label="samples" value={String(p.baseline.nSamples)} />
            )}
            {p.baseline.systemPrompt && (
              <div className="pt-2 border-t border-rule/40 mt-2">
                <div className="font-mono text-[10px] text-ink-soft uppercase tracking-wider mb-1">
                  system prompt
                </div>
                <p className="font-mono text-xs text-ink m-0 italic">"{p.baseline.systemPrompt}"</p>
              </div>
            )}
            {p.baseline.tableReference && (
              <div className="pt-2 border-t border-rule/40 mt-2">
                <div className="font-mono text-[10px] text-ink-soft uppercase tracking-wider">
                  source
                </div>
                <p className="font-mono text-xs text-ink m-0">{p.baseline.tableReference}</p>
              </div>
            )}
          </div>
        </div>

        <div>
          <H4>Paper best · {p.paperBest.value ?? '?'}</H4>
          <div className="border border-rule/60 p-3 space-y-1 font-mono text-sm">
            {p.paperBest.tableReference && (
              <>
                <div className="font-mono text-[10px] text-ink-soft uppercase tracking-wider">
                  source
                </div>
                <p className="font-mono text-xs text-ink m-0">{p.paperBest.tableReference}</p>
              </>
            )}
            {p.paperBest.citation && (
              <details className="mt-3">
                <summary className="text-xs text-ink-soft cursor-pointer hover:text-ink select-none uppercase tracking-wider">
                  literal cell from paper
                </summary>
                <pre className="text-xs text-ink m-0 mt-2 p-2 bg-paper-deep overflow-x-hidden whitespace-pre-wrap break-words font-mono">
                  {p.paperBest.citation}
                </pre>
              </details>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6">
        <H4>Eval protocol</H4>
        {p.benchmark.evalProtocol && (
          <p className="font-body text-sm text-ink leading-relaxed max-w-[70ch] m-0 mb-2">
            {p.benchmark.evalProtocol}
          </p>
        )}
        {p.benchmark.evalDerivation && (
          <p className="font-body text-xs text-ink-soft leading-relaxed max-w-[70ch] m-0">
            <span className="uppercase tracking-wider mr-1">derivation:</span>
            {p.benchmark.evalDerivation}
          </p>
        )}
      </div>

      {p.trainingCorpus.description && (
        <div className="mb-6">
          <H4>Training corpus</H4>
          <p className="font-body text-sm text-ink leading-relaxed max-w-[70ch] m-0">
            {p.trainingCorpus.description}
          </p>
          {p.trainingCorpus.citation && (
            <Quote attribution="paper">{p.trainingCorpus.citation}</Quote>
          )}
          {p.trainingCorpus.urls.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {p.trainingCorpus.urls.map((u) => (
                <div key={u} className="font-mono text-sm">
                  <ExtLink href={u}>{u.replace(/^https?:\/\//, '')}</ExtLink>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {p.suitabilityReasoning && (
        <div className="mb-6">
          <H4>Suitability ({p.suitability})</H4>
          <p className="font-body text-sm text-ink-soft leading-relaxed max-w-[70ch] m-0">
            {p.suitabilityReasoning}
          </p>
        </div>
      )}
    </div>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="text-ink break-words">{value}</span>
    </div>
  )
}

// ─── DISCOVERY ───────────────────────────────────────────────────────

function DiscoveryDive({ p }: { p: Extract<TimelineStepPayload, { kind: 'discovery' }> }) {
  return (
    <div>
      {p.blockedArxiv.length > 0 && (
        <div className="mb-6">
          <H4>Blocked from the agent · {p.blockedArxiv.length}</H4>
          <p className="font-body text-sm text-ink-soft leading-relaxed max-w-[70ch] m-0 mb-3">
            the agent must not directly access these papers — it has to rediscover the method from
            first principles.
          </p>
          <ul className="list-none m-0 p-0 space-y-1 font-mono text-sm">
            {p.blockedArxiv.map((id) => (
              <li
                key={id}
                className="inline-block border border-accent/60 bg-accent/5 px-2 py-0.5 mr-2 rounded-sm"
              >
                <a
                  href={`https://arxiv.org/abs/${id}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent hover:underline"
                >
                  arxiv:{id}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.blockedMethods.length > 0 && (
        <div className="mb-6">
          <H4>Blocked methods · {p.blockedMethods.length}</H4>
          <ul className="list-none m-0 p-0 font-mono text-sm">
            {p.blockedMethods.map((m) => (
              <li key={m} className="text-ink">
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.diagnosisSteps.length > 0 && (
        <div className="mb-6">
          <H4>Diagnosis steps · {p.diagnosisSteps.length}</H4>
          <ol className="m-0 p-0 list-none space-y-2 font-body text-sm text-ink">
            {p.diagnosisSteps.map((s, i) => (
              <li key={`${s.instruction}-${s.purpose ?? ''}`} className="flex gap-3">
                <span className="font-mono text-xs text-ink-soft w-6 flex-shrink-0">{i + 1}.</span>
                <div>
                  <p className="m-0 leading-relaxed">{s.instruction}</p>
                  {s.purpose && <p className="m-0 mt-1 text-xs text-ink-soft">{s.purpose}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {p.diagnosisSteps.length === 0 && p.readingList.length === 0 && (
        <p className="font-body text-sm text-ink-soft leading-relaxed max-w-[70ch] m-0">
          no extra diagnosis or reading required — the agent works from the task description and its
          own knowledge.
        </p>
      )}
    </div>
  )
}

// ─── CHALLENGE ───────────────────────────────────────────────────────

function ChallengeDive({ p }: { p: Extract<TimelineStepPayload, { kind: 'challenge' }> }) {
  return (
    <div className="space-y-4">
      {p.tasks.map((t) => (
        <div key={t.slug} className="border-l-2 border-accent pl-4">
          <div className="flex items-baseline gap-3 flex-wrap mb-1">
            <span className="font-mono text-base text-ink font-semibold">{t.slug}</span>
            {t.difficulty && (
              <span
                className="font-mono text-xs uppercase tracking-wider px-2 py-0.5 rounded-sm"
                style={{ background: '#fef3c7', color: '#92400e' }}
              >
                {t.difficulty}
              </span>
            )}
            {t.estimatedGpuHours != null && (
              <span className="font-mono text-xs text-ink-soft">
                ~{t.estimatedGpuHours} GPU-hours · {t.estimatedGpus ?? '?'} GPUs
              </span>
            )}
          </div>
          {t.researchGoal && (
            <p className="font-body text-sm text-ink leading-relaxed mt-2 max-w-[70ch] m-0">
              {t.researchGoal}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── VERIFICATION ────────────────────────────────────────────────────

function VerificationDive({ p }: { p: Extract<TimelineStepPayload, { kind: 'verification' }> }) {
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <Stat
          label="models"
          value={`${p.models.filter((m) => m.exists).length}/${p.models.length}`}
        />
        <Stat
          label="datasets"
          value={`${p.datasets.filter((d) => d.exists).length}/${p.datasets.length}`}
        />
        <Stat
          label="benchmarks"
          value={`${p.benchmarks.filter((b) => b.exists).length}/${p.benchmarks.length}`}
        />
        <Stat
          label="missing"
          value={p.notFound.length === 0 ? 'none' : String(p.notFound.length)}
          accent={p.notFound.length > 0}
        />
      </div>

      {p.models.length > 0 && (
        <div className="mb-6">
          <H4>Models · {p.models.length}</H4>
          <ResourceGrid resources={p.models} variant="model" />
        </div>
      )}
      {p.datasets.length > 0 && (
        <div className="mb-6">
          <H4>Datasets · {p.datasets.length}</H4>
          <ResourceGrid resources={p.datasets} variant="dataset" />
        </div>
      )}
      {p.benchmarks.length > 0 && (
        <div className="mb-6">
          <H4>Benchmarks · {p.benchmarks.length}</H4>
          <ResourceGrid resources={p.benchmarks} variant="benchmark" />
        </div>
      )}
      {p.externalCorpora.length > 0 && (
        <div className="mb-6">
          <H4>External corpora · {p.externalCorpora.length}</H4>
          <ul className="list-none m-0 p-0 space-y-2">
            {p.externalCorpora.map((c) => (
              <li key={c.name} className="border-l-2 border-rule pl-3">
                <div className="font-mono text-sm text-ink">{c.name}</div>
                {c.description && (
                  <p className="font-body text-xs text-ink-soft leading-relaxed mt-0.5 max-w-[70ch] m-0">
                    {c.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.notes && (
        <details className="mb-6">
          <summary className="font-mono text-xs text-ink-soft uppercase tracking-wider cursor-pointer hover:text-ink select-none">
            compatibility notes
          </summary>
          <p className="font-body text-sm text-ink-soft leading-relaxed mt-2 max-w-[70ch] m-0 whitespace-pre-wrap">
            {p.notes}
          </p>
        </details>
      )}
    </div>
  )
}

function ResourceGrid({
  resources,
  variant,
}: {
  resources: ResourceEntry[]
  variant: 'model' | 'dataset' | 'benchmark'
}) {
  const [openSample, setOpenSample] = useState<string | null>(null)
  const linkBase =
    variant === 'model' ? 'https://huggingface.co/' : 'https://huggingface.co/datasets/'

  return (
    <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
      {resources.map((r) => (
        <div
          key={r.hfId}
          className="border border-rule/60 px-3 py-2 hover:bg-paper-deep/40 transition-colors"
        >
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <ExtLink href={`${linkBase}${r.hfId}`}>
              <span className="font-mono text-sm font-semibold">{r.shortName}</span>
            </ExtLink>
            <span className={r.exists ? '' : 'text-accent'}>
              {r.exists ? <span style={{ color: '#10b981' }}>✓</span> : '✗'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap font-mono text-xs text-ink-soft">
            {variant === 'model' && (
              <>
                {r.paramsBillions != null && (
                  <span className="tabular-nums">{r.paramsBillions}B params</span>
                )}
                {r.sizeGb != null && <span className="tabular-nums">{r.sizeGb} GB</span>}
                {r.architecture && <span>{r.architecture}</span>}
              </>
            )}
            {variant !== 'model' && r.rows != null && (
              <span className="tabular-nums">{r.rows.toLocaleString()} rows</span>
            )}
            {r.role && <span className="uppercase tracking-wider">{r.role}</span>}
            {r.gated && <span className="text-accent uppercase tracking-wider">gated</span>}
          </div>
          {variant === 'benchmark' && r.sampleQuestion && (
            <button
              type="button"
              onClick={() => setOpenSample(openSample === r.hfId ? null : r.hfId)}
              className="mt-2 font-mono text-xs text-ink-soft hover:text-accent uppercase tracking-wider"
            >
              {openSample === r.hfId ? '▾ hide sample' : '▸ sample problem'}
            </button>
          )}
          {openSample === r.hfId && r.sampleQuestion && (
            <div className="mt-2 pt-2 border-t border-rule/40">
              <div className="font-mono text-[10px] text-ink-soft uppercase tracking-wider mb-1">
                question
              </div>
              <p className="font-body text-xs text-ink leading-relaxed m-0 mb-2 whitespace-pre-wrap">
                {r.sampleQuestion}
              </p>
              {r.sampleAnswer && (
                <>
                  <div className="font-mono text-[10px] text-ink-soft uppercase tracking-wider mb-1">
                    answer
                  </div>
                  <p className="font-mono text-xs text-ink m-0">{r.sampleAnswer}</p>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── SIZING ──────────────────────────────────────────────────────────

function SizingDive({ p }: { p: Extract<TimelineStepPayload, { kind: 'sizing' }> }) {
  return (
    <div>
      {/* Top stats: hardware glance */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <Stat label="hardware" value={`${p.gpuCount}× ${p.gpuType}`} accent />
        <Stat
          label="estimated wall"
          value={
            p.timing?.recommendedTimeoutHours != null ? `${p.timing.recommendedTimeoutHours}h` : '—'
          }
        />
        <Stat label="strategy" value={p.training?.loraRecommended ? 'LoRA' : 'full FT'} />
        <Stat label="training tier" value={p.training?.tier ?? '—'} />
      </div>

      {p.vram && p.vram.modelGb != null && (
        <div className="mb-6">
          <H4>VRAM math · {p.vram.recommendedVramGb ?? 80} GB budget</H4>
          <VramGauge vram={p.vram} />
        </div>
      )}

      {p.timing && p.timing.totalHours != null && (
        <div className="mb-6">
          <H4>Timing breakdown</H4>
          <TimingWaterfall timing={p.timing} />
        </div>
      )}

      {p.training && (
        <div className="mb-6">
          <H4>Training config</H4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {p.training.method && (
              <Stat
                label="method"
                value={`${p.training.method}${p.training.loraRecommended ? ' + LoRA' : ''}`}
              />
            )}
            {p.training.nRuns != null && <Stat label="runs" value={String(p.training.nRuns)} />}
            {p.training.trainingStepsPerRun != null && (
              <Stat label="steps / run" value={p.training.trainingStepsPerRun.toLocaleString()} />
            )}
            {p.training.groupSize != null && (
              <Stat label="group size" value={String(p.training.groupSize)} />
            )}
            {p.training.promptBatchSize != null && (
              <Stat label="prompt batch" value={String(p.training.promptBatchSize)} />
            )}
            {p.training.maxGenerationLength != null && (
              <Stat
                label="max generation"
                value={`${p.training.maxGenerationLength.toLocaleString()} tok`}
              />
            )}
            {p.training.needsReferenceModel != null && (
              <Stat label="reference model" value={p.training.needsReferenceModel ? 'yes' : 'no'} />
            )}
          </div>
        </div>
      )}

      <div className="mb-6">
        <H4>Sandbox</H4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {p.cpus != null && <Stat label="CPU" value={`${p.cpus} cores`} />}
          {p.ramGb != null && <Stat label="RAM" value={`${p.ramGb} GB`} />}
          {p.diskGb != null && <Stat label="disk" value={`${p.diskGb} GB`} />}
          {p.cudaIndex && <Stat label="CUDA" value={p.cudaIndex} />}
        </div>
        {p.baseImage && (
          <div className="mt-3 font-mono text-xs text-ink-soft">
            <span className="uppercase tracking-wider">image: </span>
            <span className="text-ink">{p.baseImage}</span>
          </div>
        )}
        {p.preDownload.length > 0 && (
          <div className="mt-3">
            <div className="font-mono text-[10px] text-ink-soft uppercase tracking-wider mb-1">
              pre-downloaded into sandbox
            </div>
            <ul className="list-none m-0 p-0 font-mono text-sm">
              {p.preDownload.map((d) => (
                <li key={d.repoId} className="text-ink">
                  {d.repoId}{' '}
                  <span className="text-ink-soft text-xs uppercase tracking-wider">[{d.type}]</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {p.unrecordedProvenance.length > 0 && (
        <div className="mb-6">
          <H4>Not recorded · agent's responsibility</H4>
          <p className="font-body text-sm text-ink-soft leading-relaxed max-w-[70ch] m-0 mb-2">
            these are decided by the agent at runtime, not the pipeline:
          </p>
          <ul className="list-none m-0 p-0 font-mono text-sm space-y-0.5">
            {p.unrecordedProvenance.map((u) => (
              <li key={u} className="text-ink-soft">
                <span style={{ color: 'var(--color-rule)' }}>·</span> {u}
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.reasoning && (
        <details className="mt-6">
          <summary className="font-mono text-xs text-ink-soft uppercase tracking-wider cursor-pointer hover:text-ink select-none">
            scout's full reasoning
          </summary>
          <p className="font-body text-sm text-ink-soft leading-relaxed mt-2 max-w-[70ch] m-0">
            {p.reasoning}
          </p>
          {p.loraNote && (
            <p className="font-body text-sm text-ink-soft leading-relaxed mt-2 max-w-[70ch] m-0">
              {p.loraNote}
            </p>
          )}
        </details>
      )}
    </div>
  )
}

function VramGauge({
  vram,
}: {
  vram: NonNullable<Extract<TimelineStepPayload, { kind: 'sizing' }>['vram']>
}) {
  const budget = vram.recommendedVramGb ?? 80
  const candidates = [
    { label: 'model weights (bf16)', gb: vram.modelGb, color: '#6b7f8a' },
    { label: 'full fine-tune', gb: vram.fullParamGb, color: '#a53030' },
    { label: 'LoRA fine-tune', gb: vram.loraGb, color: '#10b981' },
  ].filter((c) => c.gb != null) as Array<{ label: string; gb: number; color: string }>

  return (
    <div className="space-y-3">
      {candidates.map((c) => {
        const fits = c.gb <= budget
        return (
          <div key={c.label} className="grid grid-cols-[10rem_1fr_5rem] items-center gap-3">
            <span className="font-mono text-sm text-ink">{c.label}</span>
            <div className="relative">
              <Bar ratio={c.gb / budget} color={c.color} />
              {/* budget marker line */}
              <div
                className="absolute top-0 bottom-0 w-px bg-ink"
                style={{ left: `${Math.min(100, (budget / Math.max(c.gb, budget)) * 100)}%` }}
              />
            </div>
            <span className="font-mono text-xs tabular-nums text-right">
              <span className="text-ink">{c.gb} GB</span>
              {fits ? (
                <span style={{ color: '#10b981' }} className="ml-1">
                  ✓
                </span>
              ) : (
                <span className="text-accent ml-1">✗</span>
              )}
            </span>
          </div>
        )
      })}
      {vram.recommendedGpu && (
        <div className="pt-2 mt-2 border-t border-rule/40 flex items-baseline gap-3 font-mono text-sm">
          <span className="text-ink-soft text-xs uppercase tracking-wider">verdict</span>
          <span className="text-accent font-semibold">{vram.recommendedGpu}</span>
          {vram.loraRecommended && (
            <span className="text-ink-soft text-xs">via LoRA (rank ≤ 32 typical)</span>
          )}
        </div>
      )}
    </div>
  )
}

function TimingWaterfall({
  timing,
}: {
  timing: NonNullable<Extract<TimelineStepPayload, { kind: 'sizing' }>['timing']>
}) {
  const total = timing.recommendedTimeoutHours ?? timing.totalHours ?? 0
  const bars = [
    { label: 'training', hours: timing.trainingHours, color: '#6b7f8a' },
    { label: 'eval', hours: timing.evalHours, color: '#8a7a5a' },
    { label: 'overhead', hours: timing.overheadHours, color: '#5a6b5a' },
  ].filter((b) => b.hours != null) as Array<{ label: string; hours: number; color: string }>

  const formulaSum = bars.reduce((acc, b) => acc + b.hours, 0)
  const llmEst = timing.llmWallHours ?? formulaSum
  const padding = Math.max(0, total - llmEst)

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {bars.map((b) => (
          <div key={b.label} className="grid grid-cols-[6rem_1fr_4rem] items-center gap-3">
            <span className="font-mono text-sm text-ink">{b.label}</span>
            <Bar ratio={total > 0 ? b.hours / total : 0} color={b.color} />
            <span className="font-mono text-xs tabular-nums text-ink-soft text-right">
              {b.hours.toFixed(2)}h
            </span>
          </div>
        ))}
        <div className="grid grid-cols-[6rem_1fr_4rem] items-center gap-3 pt-2 border-t border-rule/40">
          <span className="font-mono text-xs text-ink-soft uppercase tracking-wider">
            formula sum
          </span>
          <Bar ratio={total > 0 ? formulaSum / total : 0} color="var(--color-ink-soft)" />
          <span className="font-mono text-xs tabular-nums text-ink-soft text-right">
            {formulaSum.toFixed(2)}h
          </span>
        </div>
        {timing.llmWallHours != null && (
          <div className="grid grid-cols-[6rem_1fr_4rem] items-center gap-3">
            <span className="font-mono text-xs text-ink-soft uppercase tracking-wider">
              LLM bumped
            </span>
            <Bar ratio={total > 0 ? llmEst / total : 0} color="var(--color-accent)" />
            <span className="font-mono text-xs tabular-nums text-ink-soft text-right">
              {llmEst}h
            </span>
          </div>
        )}
        {padding > 0 && (
          <div className="grid grid-cols-[6rem_1fr_4rem] items-center gap-3">
            <span className="font-mono text-xs text-ink-soft uppercase tracking-wider">
              budget pad
            </span>
            <Bar ratio={total > 0 ? padding / total : 0} color="var(--color-rule)" />
            <span className="font-mono text-xs tabular-nums text-ink-soft text-right">
              +{padding.toFixed(1)}h
            </span>
          </div>
        )}
      </div>
      <div className="pt-2 border-t border-rule/40 flex items-baseline gap-3 font-mono text-sm">
        <span className="text-ink-soft text-xs uppercase tracking-wider">final timeout</span>
        <span className="text-accent font-semibold">{total}h</span>
        {timing.timeoutSource && (
          <span className="text-ink-soft text-xs">source: {timing.timeoutSource}</span>
        )}
      </div>
    </div>
  )
}
