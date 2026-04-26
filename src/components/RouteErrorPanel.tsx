import { Link } from '@tanstack/react-router'

type Props = {
  error: Error
}

export default function RouteErrorPanel({ error }: Props) {
  const message = error instanceof Error ? error.message : String(error)

  return (
    <main className="page-wrap py-16 px-0">
      <div className="raw-panel mb-6" role="alert">
        <div className="eyebrow text-accent mb-2">loader error</div>
        <div className="font-mono text-base leading-relaxed">{message || 'unknown error'}</div>
      </div>
      <p className="font-mono muted text-base">
        <Link to="/">← tasks</Link>
      </p>
    </main>
  )
}
