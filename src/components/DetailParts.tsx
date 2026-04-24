import type { ReactNode } from 'react'
import { useMemo } from 'react'

export const PANEL_ACCENTS: Record<string, string> = {
  METRIC: 'var(--accent)',
  ENVIRONMENT: '#6b7f8a',
  TIMING: '#8a7a5a',
  MODEL: '#5a6b5a',
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  const accent = PANEL_ACCENTS[title] ?? 'var(--rule)'
  return (
    <div
      style={{
        border: '1px solid var(--rule)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--paper-deep)',
        boxShadow: `inset 0 2px 0 ${accent}`,
      }}
    >
      <h3
        className="font-mono"
        style={{
          fontSize: 'var(--fs-sm)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ink)',
          margin: '0 0 var(--space-3) 0',
          paddingBottom: 'var(--space-2)',
          borderBottom: '1px solid color-mix(in oklab, var(--rule) 50%, transparent)',
          fontWeight: 700,
        }}
      >
        {title}
      </h3>
      <div className="font-mono" style={{ fontSize: 'var(--fs-base)' }}>
        {children}
      </div>
    </div>
  )
}

export function KV({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '11ch 1fr',
        gap: 'var(--space-3)',
        padding: '0.2rem 0',
      }}
    >
      <span className="muted">{label}</span>
      <span
        style={{
          color: accent ? 'var(--accent)' : 'var(--ink)',
          fontWeight: accent ? 600 : 400,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </span>
    </div>
  )
}

export function RewardRow({
  value,
  reward,
  isHigh,
  borderBottom,
}: {
  value: number
  reward: number
  isHigh: boolean
  borderBottom: string
}) {
  return (
    <>
      <div
        style={{
          padding: 'var(--space-1) var(--space-3)',
          borderBottom,
          color: 'var(--ink-soft)',
        }}
      >
        {value.toFixed(1)}
      </div>
      <div
        style={{
          padding: 'var(--space-1) var(--space-3)',
          borderBottom,
          color: isHigh ? 'var(--accent)' : 'var(--ink)',
          fontWeight: isHigh ? 600 : 400,
        }}
      >
        {reward}
      </div>
      <div
        style={{
          borderBottom,
          padding: 'var(--space-1) var(--space-2)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            height: '4px',
            width: `${reward * 100}%`,
            background: isHigh
              ? 'var(--accent)'
              : 'color-mix(in oklab, var(--ink-soft) 40%, transparent)',
            borderRadius: '2px',
            transition: 'width 300ms ease',
          }}
        />
      </div>
    </>
  )
}

export function MetricProgress({
  baseline,
  target,
  paperBest,
  direction,
}: {
  baseline: number
  target: number
  paperBest: number
  direction: string
}) {
  // Axis reads worse (left) to better (right) regardless of direction
  const isMin = direction === 'minimize'
  const worst = isMin ? Math.max(baseline, paperBest) : Math.min(baseline, paperBest)
  const range = Math.abs(paperBest - baseline)
  if (range <= 0) return null

  // 0 = worst end (left), 100 = best end (right)
  const pct = (v: number) => {
    const ratio = isMin ? (worst - v) / range : (v - worst) / range
    return Math.max(0, Math.min(100, ratio * 100))
  }

  const baselinePct = pct(baseline)
  const targetPct = pct(target)
  const bestPct = pct(paperBest)

  // The "filled" region runs from baseline toward paper_best
  const fillLeft = Math.min(baselinePct, bestPct)
  const fillWidth = Math.abs(bestPct - baselinePct)

  return (
    <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
      {/* Labels row */}
      <div
        className="font-mono"
        style={{
          position: 'relative',
          height: '1.2em',
          fontSize: 'var(--fs-xs)',
          color: 'var(--ink-soft)',
          marginBottom: '2px',
        }}
      >
        <span
          style={{ position: 'absolute', left: `${baselinePct}%`, transform: 'translateX(-50%)' }}
        >
          baseline
        </span>
        <span
          style={{
            position: 'absolute',
            left: `${targetPct}%`,
            transform: 'translateX(-50%)',
            color: 'var(--accent)',
            fontWeight: 600,
          }}
        >
          target
        </span>
        <span style={{ position: 'absolute', left: `${bestPct}%`, transform: 'translateX(-50%)' }}>
          best
        </span>
      </div>
      {/* Track */}
      <div
        style={{
          position: 'relative',
          height: '6px',
          background: 'color-mix(in oklab, var(--rule) 60%, transparent)',
          borderRadius: '3px',
          overflow: 'visible',
        }}
      >
        {/* Filled region */}
        <div
          style={{
            position: 'absolute',
            left: `${fillLeft}%`,
            width: `${fillWidth}%`,
            height: '100%',
            background: 'color-mix(in oklab, var(--accent) 25%, var(--rule))',
            borderRadius: '3px',
          }}
        />
        {/* Baseline marker */}
        <div
          style={{
            position: 'absolute',
            left: `${baselinePct}%`,
            top: '-2px',
            width: '2px',
            height: '10px',
            background: 'var(--ink-soft)',
            borderRadius: '1px',
            transform: 'translateX(-50%)',
          }}
        />
        {/* Target marker */}
        <div
          style={{
            position: 'absolute',
            left: `${targetPct}%`,
            top: '-3px',
            width: '4px',
            height: '12px',
            background: 'var(--accent)',
            borderRadius: '2px',
            transform: 'translateX(-50%)',
          }}
        />
        {/* Paper best marker */}
        <div
          style={{
            position: 'absolute',
            left: `${bestPct}%`,
            top: '-2px',
            width: '2px',
            height: '10px',
            background: 'var(--ink-soft)',
            borderRadius: '1px',
            transform: 'translateX(-50%)',
          }}
        />
      </div>
    </div>
  )
}

export function InstructionCollapse({ instructionHtml }: { instructionHtml: string }) {
  const wordCount = useMemo(() => {
    const text = instructionHtml.replace(/<[^>]+>/g, ' ').trim()
    return text ? text.split(/\s+/).filter(Boolean).length : 0
  }, [instructionHtml])

  return (
    <details className="instruction-collapse">
      <summary className="meta-subhead" style={{ cursor: 'pointer', userSelect: 'none' }}>
        <span className="instruction-chevron">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M4.5 2L9 6L4.5 10V2Z" />
          </svg>
        </span>
        AGENT INSTRUCTION
        {wordCount > 0 && <span className="instruction-badge">{wordCount} words</span>}
      </summary>
      <div
        className="measure font-body prose"
        style={{ marginTop: 'var(--space-3)' }}
        dangerouslySetInnerHTML={{ __html: instructionHtml }}
      />
    </details>
  )
}
