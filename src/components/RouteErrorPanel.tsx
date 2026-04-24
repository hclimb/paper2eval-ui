import { Link } from '@tanstack/react-router'

type Props = {
  error: Error
}

export default function RouteErrorPanel({ error }: Props) {
  const message = error instanceof Error ? error.message : String(error)

  return (
    <main className="page-wrap" style={{ paddingBlock: '4rem', paddingInline: 0 }}>
      <div className="raw-panel" role="alert" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 'var(--space-2)' }}>
          loader error
        </div>
        <div className="font-mono" style={{ fontSize: 'var(--fs-base)', lineHeight: 1.6 }}>
          {message || 'unknown error'}
        </div>
      </div>
      <p className="font-mono muted" style={{ fontSize: 'var(--fs-base)' }}>
        <Link to="/">← tasks</Link>
      </p>
    </main>
  )
}
