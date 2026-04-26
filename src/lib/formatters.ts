export function toNum(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? Number.parseFloat(v) : Number(v)
  return Number.isNaN(n) ? null : n
}

export function fmtReward(v: unknown): string {
  const n = toNum(v)
  if (n == null) return '—'
  return n % 1 === 0 ? String(n) : n.toFixed(3)
}

export function fmtCost(v: unknown): string {
  const n = toNum(v)
  if (n == null) return '—'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export function fmtTokens(v: unknown): string {
  const n = toNum(v)
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

export function fmtMs(v: unknown): string {
  const n = toNum(v)
  if (n == null || n < 0) return '—'
  if (n < 1000) return `${Math.round(n)}ms`
  const secs = Math.floor(n / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remSecs = secs % 60
  if (mins < 60) return `${mins}m ${remSecs}s`
  const hrs = Math.floor(mins / 60)
  const remMins = mins % 60
  return `${hrs}h ${remMins}m`
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / 1024 ** i
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
