import { createFileRoute } from '@tanstack/react-router'
import { type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react'
import RouteErrorPanel from '#/components/RouteErrorPanel'
import { SITE } from '#/lib/constants'
import { fetchDocContent, fetchDocList } from '#/lib/docs.api'

const ACRONYMS = new Set(['json', 'api', 'gpu', 'cpu', 'llm', 'rlvr', 'ui'])
const GROUP_ORDER = ['start', 'getting-started', 'architecture', 'tasks']

type DocNavItem = {
  group: string
  path: string
  title: string
}

function prettifySegment(seg: string): string {
  return seg
    .split('-')
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

function docTitle(path: string): string {
  const filename = path.split('/').pop() ?? path
  return prettifySegment(filename.replace(/\.md$/, ''))
}

function docGroup(path: string): string {
  const first = path.split('/')[0] ?? ''
  return path.includes('/') ? prettifySegment(first) : 'Start'
}

function docsRailGroupLabel(label: string): string {
  if (label === 'Getting Started') return 'Setup'
  return label
}

function sortDocPaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const aRoot = a.includes('/') ? (a.split('/')[0] ?? '') : 'start'
    const bRoot = b.includes('/') ? (b.split('/')[0] ?? '') : 'start'
    const aRank = GROUP_ORDER.indexOf(aRoot)
    const bRank = GROUP_ORDER.indexOf(bRoot)
    const rankA = aRank === -1 ? GROUP_ORDER.length : aRank
    const rankB = bRank === -1 ? GROUP_ORDER.length : bRank
    if (rankA !== rankB) return rankA - rankB
    if (a === 'overview.md') return -1
    if (b === 'overview.md') return 1
    return docTitle(a).localeCompare(docTitle(b))
  })
}

function defaultDocPath(paths: string[]): string | null {
  return paths.includes('overview.md') ? 'overview.md' : (sortDocPaths(paths)[0] ?? null)
}

function normalizeDocHref(
  href: string,
  activePath: string | null,
  docPaths: Set<string>,
): string | null {
  const target = href.split('#')[0]?.trim() ?? ''
  if (!target.endsWith('.md')) return null
  if (/^[a-z]+:/i.test(target)) return null

  const parts = target.startsWith('/') || !activePath ? [] : activePath.split('/').slice(0, -1)
  for (const part of target
    .replace(/^\/+/, '')
    .replace(/^docs\//, '')
    .split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }

  const normalized = parts.join('/')
  return docPaths.has(normalized) ? normalized : null
}

export const Route = createFileRoute('/docs')({
  head: () => ({
    meta: [
      { title: `docs — ${SITE.title}` },
      { name: 'description', content: 'paper2eval documentation' },
    ],
  }),
  loader: async () => {
    const paths = await fetchDocList()
    return { paths }
  },
  component: DocsPage,
  errorComponent: ({ error }) => <RouteErrorPanel error={error} />,
})

function DocsPage() {
  const { paths } = Route.useLoaderData()
  const [activePath, setActivePath] = useState<string | null>(() => defaultDocPath(paths))
  const [docHtml, setDocHtml] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const docs = useMemo<DocNavItem[]>(
    () =>
      sortDocPaths(paths).map((path) => ({
        group: docGroup(path),
        path,
        title: docTitle(path),
      })),
    [paths],
  )

  const docPaths = useMemo(() => new Set(paths), [paths])
  const activeIndex = activePath ? docs.findIndex((d) => d.path === activePath) : -1

  const groups = useMemo(() => {
    const byGroup = new Map<string, DocNavItem[]>()
    for (const doc of docs) {
      const group = byGroup.get(doc.group) ?? []
      group.push(doc)
      byGroup.set(doc.group, group)
    }
    return [...byGroup.entries()].map(([label, items]) => ({ label, items }))
  }, [docs])

  const previousDoc = activeIndex > 0 ? docs[activeIndex - 1] : null
  const nextDoc = activeIndex >= 0 && activeIndex < docs.length - 1 ? docs[activeIndex + 1] : null

  useEffect(() => {
    if (activePath && docPaths.has(activePath)) return
    setActivePath(defaultDocPath(paths))
  }, [activePath, docPaths, paths])

  useEffect(() => {
    if (!activePath) return

    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setDocHtml(null)

    fetchDocContent({ data: { path: activePath } })
      .then((res) => {
        if (!cancelled) setDocHtml(res.html)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'failed to load document')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activePath])

  const handleDocLinkClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest('a')
      const href = anchor?.getAttribute('href')
      if (!href) return

      const nextPath = normalizeDocHref(href, activePath, docPaths)
      if (!nextPath) return

      event.preventDefault()
      setActivePath(nextPath)
    },
    [activePath, docPaths],
  )

  return (
    <main className="page-wrap docs-page">
      <section className="docs-stage">
        <aside className="docs-sidebar" aria-label="Documentation files">
          <div className="docs-sidebar-head">
            <span className="eyebrow">/DOCS</span>
          </div>
          <nav className="docs-file-nav" aria-label="Documentation files">
            {groups.map((group) => (
              <section className="docs-nav-group" key={group.label}>
                <div className="docs-nav-group-label">{docsRailGroupLabel(group.label)}</div>
                <div className="docs-nav-pages">
                  {group.items.map((doc) => (
                    <button
                      type="button"
                      className="docs-file-button"
                      data-active={doc.path === activePath}
                      onClick={() => setActivePath(doc.path)}
                      key={doc.path}
                    >
                      <span className="docs-file-title">{doc.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </aside>

        <article className="docs-reader">
          {loading && (
            <div className="docs-skeleton">
              <div className="docs-skeleton-line" style={{ width: '40%', height: '24px' }} />
              <div className="docs-skeleton-line" style={{ width: '90%' }} />
              <div className="docs-skeleton-line" style={{ width: '75%' }} />
              <div className="docs-skeleton-line" style={{ width: '85%' }} />
              <div className="docs-skeleton-line" style={{ width: '60%' }} />
            </div>
          )}

          {!loading && loadError && (
            <div className="docs-error" role="alert">
              {loadError}
            </div>
          )}

          {!loading && !loadError && docHtml != null && (
            <div
              className="docs-prose prose"
              dangerouslySetInnerHTML={{ __html: docHtml }}
              onClick={handleDocLinkClick}
            />
          )}

          {!loading && !loadError && docHtml != null && docs.length > 1 && (
            <nav className="docs-reader-nav" aria-label="Documentation pagination">
              <button
                type="button"
                className="docs-reader-nav-button"
                disabled={!previousDoc}
                onClick={() => previousDoc && setActivePath(previousDoc.path)}
              >
                <span className="docs-reader-nav-dir">Previous</span>
                <span className="docs-reader-nav-title">{previousDoc?.title ?? 'Start'}</span>
              </button>
              <button
                type="button"
                className="docs-reader-nav-button"
                disabled={!nextDoc}
                onClick={() => nextDoc && setActivePath(nextDoc.path)}
              >
                <span className="docs-reader-nav-dir">Next</span>
                <span className="docs-reader-nav-title">{nextDoc?.title ?? 'End'}</span>
              </button>
            </nav>
          )}
        </article>
      </section>
    </main>
  )
}
