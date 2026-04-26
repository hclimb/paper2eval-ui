import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import RouteErrorPanel from '#/components/RouteErrorPanel'
import { SITE } from '#/lib/constants'
import { fetchPaperContent } from '#/lib/tasks.api'

const taskRoute = getRouteApi('/tasks/$slug')

export const Route = createFileRoute('/tasks/$slug/paper')({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} paper — ${SITE.title}` },
      { name: 'description', content: `Full paper content for ${params.slug}` },
    ],
  }),
  loader: ({ params }) => fetchPaperContent({ data: { slug: params.slug } }),
  component: PaperReader,
  errorComponent: ({ error }) => <RouteErrorPanel error={error} />,
})

function PaperReader() {
  const { slug, claims } = taskRoute.useLoaderData()
  const { html } = Route.useLoaderData() as { html: string | null }

  return (
    <main className="page-wrap py-8">
      <nav className="font-mono text-sm mb-6 flex items-baseline gap-2 flex-wrap">
        <Link to="/" className="muted">
          tasks
        </Link>
        <span className="text-rule">/</span>
        <Link to="/tasks/$slug" params={{ slug }} className="muted">
          {slug}
        </Link>
        <span className="text-rule">/</span>
        <span className="text-ink">paper</span>
      </nav>

      <h1 className="font-body text-2xl font-semibold text-ink leading-tight max-w-[70ch] mb-2">
        {claims.paper_title}
      </h1>
      <p className="font-mono text-sm mb-8">
        {claims.paper_id && (
          <a
            href={`https://arxiv.org/abs/${claims.paper_id}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink-soft hover:text-accent"
          >
            arxiv:{claims.paper_id} ↗
          </a>
        )}
      </p>

      {html ? (
        <article
          className="prose font-body max-w-[75ch]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="font-mono text-sm text-ink-soft">paper content unavailable.</p>
      )}
    </main>
  )
}
