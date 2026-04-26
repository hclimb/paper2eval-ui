import { createFileRoute, Link } from '@tanstack/react-router'
import RouteErrorPanel from '#/components/RouteErrorPanel'
import { SITE } from '#/lib/constants'
import { fetchTaskFile } from '#/lib/server-fns'
import { formatBytes } from '#/lib/formatters'

type LoaderData = {
  slug: string
  path: string
  content: string
  renderedHtml: string | null
  size: number
}

function langFor(path: string): string {
  const ext = path.lastIndexOf('.') >= 0 ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
  const map: Record<string, string> = {
    py: 'python',
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    sh: 'bash',
    bash: 'bash',
    fish: 'fish',
    toml: 'toml',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    dockerfile: 'dockerfile',
    md: 'markdown',
    jsonl: 'json',
  }
  const name = path.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  return map[ext] ?? ''
}

export const Route = createFileRoute('/tasks/$slug/files/$')({
  head: ({ params }) => ({
    meta: [{ title: `${params._splat} — ${params.slug} — ${SITE.title}` }],
  }),
  loader: async ({ params }) => {
    return fetchTaskFile({ data: { slug: params.slug, path: params._splat ?? '' } })
  },
  component: FileViewer,
  errorComponent: ({ error }) => <RouteErrorPanel error={error} />,
})

function FileViewer() {
  const { slug, path, content, renderedHtml, size } = Route.useLoaderData() as LoaderData

  const lang = langFor(path)

  return (
    <main className="page-wrap" style={{ paddingBlock: 'var(--space-6)' }}>
      <div
        className="font-mono"
        style={{
          fontSize: 'var(--fs-sm)',
          marginBottom: 'var(--space-4)',
          display: 'flex',
          gap: 'var(--space-2)',
          flexWrap: 'wrap',
        }}
      >
        <Link to="/" className="muted">
          tasks
        </Link>
        <span className="muted">/</span>
        <Link to="/tasks/$slug" params={{ slug }} className="muted">
          {slug}
        </Link>
        <span className="muted">/</span>
        <span style={{ color: 'var(--ink)' }}>{path}</span>
        <span className="muted">· {formatBytes(size)}</span>
        {lang && <span className="muted">· {lang}</span>}
      </div>

      {renderedHtml ? (
        <div
          className="measure font-body prose"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : (
        <div className="raw-panel">
          <pre
            style={{
              margin: 0,
              background: 'transparent',
              border: 'none',
              padding: 0,
              borderLeft: 'none',
            }}
          >
            <code>{content}</code>
          </pre>
        </div>
      )}
    </main>
  )
}
