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
      <div className="px-3 py-1 text-ink-soft" style={{ borderBottom }}>
        {value.toFixed(1)}
      </div>
      <div
        className={`px-3 py-1 ${isHigh ? 'text-accent font-semibold' : 'text-ink'}`}
        style={{ borderBottom }}
      >
        {reward}
      </div>
      <div className="flex items-center px-2 py-1" style={{ borderBottom }}>
        <div
          className="h-1 rounded-[2px] transition-[width] duration-300"
          style={{
            width: `${reward * 100}%`,
            background: isHigh
              ? 'var(--color-accent)'
              : 'color-mix(in oklab, var(--color-ink-soft) 40%, transparent)',
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
  const isMin = direction === 'minimize'
  const worst = isMin ? Math.max(baseline, paperBest) : Math.min(baseline, paperBest)
  const range = Math.abs(paperBest - baseline)
  if (range <= 0) return null

  const pct = (v: number) => {
    const ratio = isMin ? (worst - v) / range : (v - worst) / range
    return Math.max(0, Math.min(100, ratio * 100))
  }

  const baselinePct = pct(baseline)
  const targetPct = pct(target)
  const bestPct = pct(paperBest)

  const fillLeft = Math.min(baselinePct, bestPct)
  const fillWidth = Math.abs(bestPct - baselinePct)

  return (
    <div className="mt-3 pt-2">
      <div
        className="font-mono relative text-xs text-ink-soft mb-0.5"
        style={{ height: '1.2em' }}
      >
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${baselinePct}%` }}
        >
          baseline
        </span>
        <span
          className="absolute -translate-x-1/2 text-accent font-semibold"
          style={{ left: `${targetPct}%` }}
        >
          target
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${bestPct}%` }}>
          best
        </span>
      </div>
      <div
        className="relative h-1.5 rounded-[3px] overflow-visible"
        style={{ background: 'color-mix(in oklab, var(--color-rule) 60%, transparent)' }}
      >
        <div
          className="absolute h-full rounded-[3px]"
          style={{
            left: `${fillLeft}%`,
            width: `${fillWidth}%`,
            background: 'color-mix(in oklab, var(--color-accent) 25%, var(--color-rule))',
          }}
        />
        <div
          className="absolute -translate-x-1/2 bg-ink-soft rounded-[1px]"
          style={{ left: `${baselinePct}%`, top: '-2px', width: '2px', height: '10px' }}
        />
        <div
          className="absolute -translate-x-1/2 bg-accent rounded-[2px]"
          style={{ left: `${targetPct}%`, top: '-3px', width: '4px', height: '12px' }}
        />
        <div
          className="absolute -translate-x-1/2 bg-ink-soft rounded-[1px]"
          style={{ left: `${bestPct}%`, top: '-2px', width: '2px', height: '10px' }}
        />
      </div>
    </div>
  )
}
