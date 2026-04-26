import type { Claims } from '#/lib/tasks'

export function AccuracyBar({
  claims,
  measuredAccuracy,
  grader,
}: {
  claims: Claims
  measuredAccuracy: number | null
  grader: string | null
}) {
  const baseline = claims.baseline_value
  const target = claims.target_value
  const paperBest = claims.paper_best_value

  const all = [baseline, target, paperBest, measuredAccuracy].filter((v): v is number => v != null)
  const min = Math.min(...all) - 5
  const max = Math.max(...all) + 5

  return (
    <div className="mb-6">
      <h3 className="meta-subhead">
        ACCURACY CONTEXT ({claims.benchmark_name})
        {grader && (
          <span className="ml-2 font-normal normal-case text-ink-soft">grader: {grader}</span>
        )}
      </h3>
      <div className="relative h-8 bg-paper-deep border border-rule rounded overflow-hidden">
        {measuredAccuracy != null && (
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${((measuredAccuracy - min) / (max - min)) * 100}%`,
              background: 'linear-gradient(90deg, var(--color-paper-deep), #dcfce780)',
              borderRight: '2px solid #065f46',
            }}
          />
        )}
        <Marker
          value={baseline}
          min={min}
          max={max}
          label="baseline"
          sublabel={`${baseline}%`}
          color="var(--color-ink-soft)"
        />
        <Marker
          value={target}
          min={min}
          max={max}
          label="target"
          sublabel={`${target.toFixed(1)}%`}
          color="var(--color-accent)"
        />
        <Marker
          value={paperBest}
          min={min}
          max={max}
          label="paper"
          sublabel={`${paperBest}%`}
          color="#7c3aed"
        />
        {measuredAccuracy != null && (
          <Marker
            value={measuredAccuracy}
            min={min}
            max={max}
            label="measured"
            sublabel={`${measuredAccuracy.toFixed(1)}%`}
            color="#065f46"
          />
        )}
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
      className="absolute inset-y-0 -translate-x-1/2 flex flex-col items-center"
      style={{ left }}
    >
      <div className="w-px flex-1 opacity-60" style={{ background: color }} />
      <div
        className="font-mono absolute text-xs uppercase tracking-[0.05em] whitespace-nowrap"
        style={{ top: '-1.3rem', color }}
      >
        {label}
      </div>
      <div
        className="font-mono absolute whitespace-nowrap"
        style={{ bottom: '-1.3rem', fontSize: '0.6rem', color }}
      >
        {sublabel}
      </div>
    </div>
  )
}
