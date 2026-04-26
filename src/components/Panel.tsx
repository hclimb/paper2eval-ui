import type { ReactNode } from 'react'

export const PANEL_ACCENTS: Record<string, string> = {
  METRIC: 'var(--color-accent)',
  ENVIRONMENT: '#6b7f8a',
  TIMING: '#8a7a5a',
  MODEL: '#5a6b5a',
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  const accent = PANEL_ACCENTS[title] ?? 'var(--color-rule)'
  return (
    <div
      className="border border-rule bg-paper-deep px-4 py-3"
      style={{ boxShadow: `inset 0 2px 0 ${accent}` }}
    >
      <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-ink m-0 mb-3 pb-2 border-b border-rule/50 font-bold">
        {title}
      </h3>
      <div className="font-mono text-base">{children}</div>
    </div>
  )
}

export function KV({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="grid grid-cols-[11ch_1fr] gap-3 py-[0.2rem]">
      <span className="text-ink-soft">{label}</span>
      <span
        className={`break-all ${accent ? 'text-accent font-semibold' : 'text-ink'}`}
      >
        {value}
      </span>
    </div>
  )
}
