import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RouteErrorPanel from '#/components/RouteErrorPanel'
import SectionHead from '#/components/SectionHead'
import { SITE } from '#/lib/constants'
import { fetchDocContent, fetchDocList } from '#/lib/doc-fns'
import { TREE_THEME_COLORS } from '#/lib/tree-theme'

const ACRONYMS = new Set(['json', 'api', 'gpu', 'cpu', 'llm', 'rlvr', 'ui'])

function prettifySegment(seg: string): string {
  return seg
    .split('-')
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

function prettifyPath(path: string): string {
  return path
    .replace(/\.md$/, '')
    .split('/')
    .map(prettifySegment)
    .join('/')
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
  const [mod, setMod] = useState<typeof import('@pierre/trees/react') | null>(null)
  const [treeStyles, setTreeStyles] = useState<Record<string, string>>({})
  const [activePath, setActivePath] = useState<string | null>(null)
  const [docHtml, setDocHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { displayPaths, displayToReal } = useMemo(() => {
    const sorted = [...paths].sort((a, b) => {
      const aDepth = a.split('/').length
      const bDepth = b.split('/').length
      if (aDepth !== bDepth) return aDepth - bDepth
      return a.localeCompare(b)
    })
    const map = new Map<string, string>()
    const display = sorted.map((p) => {
      const d = prettifyPath(p)
      map.set(d, p)
      return d
    })
    return { displayPaths: display, displayToReal: map }
  }, [paths])

  useEffect(() => {
    import('@pierre/trees/react').then(setMod)
    import('@pierre/trees').then(({ themeToTreeStyles }) => {
      setTreeStyles(
        themeToTreeStyles({
          type: 'light',
          bg: '#ede5d3',
          fg: '#141410',
          colors: TREE_THEME_COLORS,
        }),
      )
    })
  }, [])

  const handleFileOpen = useCallback(
    (displayPath: string) => {
      const realPath = displayToReal.get(displayPath)
      if (!realPath) return
      setActivePath(realPath)
      setLoading(true)
      setDocHtml(null)
      fetchDocContent({ data: { path: realPath } }).then((res) => {
        setDocHtml(res.html)
        setLoading(false)
      })
    },
    [displayToReal],
  )

  useEffect(() => {
    if (paths.length > 0 && !activePath) {
      const overviewDisplay = displayPaths.find((p) => displayToReal.get(p) === 'overview.md')
      if (overviewDisplay) handleFileOpen(overviewDisplay)
      else if (displayPaths[0]) handleFileOpen(displayPaths[0])
    }
  }, [paths, activePath, displayPaths, displayToReal, handleFileOpen])

  const prettyActive = activePath ? prettifyPath(activePath) : null
  const fileName = prettyActive ? prettyActive.split('/').pop() : null
  const fileDir = prettyActive?.includes('/')
    ? prettyActive.slice(0, prettyActive.lastIndexOf('/'))
    : null

  return (
    <main className="page-wrap" style={{ paddingBlock: 'var(--space-6)' }}>
      <SectionHead label="/DOCS" />

      <div className="docs-chrome">
        <div className="docs-title-bar">
          <span>DOCUMENTATION</span>
          <span style={{ fontWeight: 400, fontSize: '10px' }}>{paths.length} pages</span>
        </div>
        <div className="docs-body">
          <div className="docs-tree-pane">
            <div className="docs-pane-header">Pages</div>
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              {mod && (
                <DocsTree
                  FileTree={mod.FileTree}
                  useFileTree={mod.useFileTree}
                  useFileTreeSelection={mod.useFileTreeSelection}
                  paths={displayPaths}
                  treeStyles={treeStyles}
                  onFileOpen={handleFileOpen}
                />
              )}
            </div>
          </div>
          <div className="docs-content-pane">
            {!activePath && !loading && (
              <div className="docs-empty">
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                >
                  <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
                </svg>
                <span className="docs-empty-title">select a page</span>
                <span className="docs-empty-hint">
                  choose a document from the tree to start reading
                </span>
              </div>
            )}
            {activePath && loading && (
              <>
                <div className="docs-breadcrumb">
                  {fileDir && <span className="docs-breadcrumb-dir">{fileDir} / </span>}
                  <span className="docs-breadcrumb-file">{fileName}</span>
                </div>
                <div className="docs-skeleton">
                  <div className="docs-skeleton-line" style={{ width: '40%', height: '24px' }} />
                  <div className="docs-skeleton-line" style={{ width: '90%' }} />
                  <div className="docs-skeleton-line" style={{ width: '75%' }} />
                  <div className="docs-skeleton-line" style={{ width: '85%' }} />
                  <div className="docs-skeleton-line" style={{ width: '60%' }} />
                  <div className="docs-skeleton-line" style={{ width: '95%' }} />
                  <div className="docs-skeleton-line" style={{ width: '70%' }} />
                </div>
              </>
            )}
            {activePath && !loading && docHtml != null && (
              <>
                <div className="docs-breadcrumb">
                  {fileDir && <span className="docs-breadcrumb-dir">{fileDir} / </span>}
                  <span className="docs-breadcrumb-file">{fileName}</span>
                </div>
                <div className="docs-prose prose" dangerouslySetInnerHTML={{ __html: docHtml }} />
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

function DocsTree({
  FileTree: TreeComponent,
  useFileTree: useTreeHook,
  useFileTreeSelection: useSelectionHook,
  paths,
  treeStyles,
  onFileOpen,
}: {
  FileTree: typeof import('@pierre/trees/react').FileTree
  useFileTree: typeof import('@pierre/trees/react').useFileTree
  useFileTreeSelection: typeof import('@pierre/trees/react').useFileTreeSelection
  paths: string[]
  treeStyles: Record<string, string>
  onFileOpen: (path: string) => void
}) {
  const treeOpts = useMemo(
    () => ({
      paths,
      initialExpansion: 2 as const,
      flattenEmptyDirectories: true,
      search: true,
      icons: { set: 'none' as const },
    }),
    [paths],
  )

  const { model } = useTreeHook(treeOpts)
  const selectedPaths = useSelectionHook(model)

  const lastOpenedRef = useRef<string | null>(null)
  useEffect(() => {
    const path = selectedPaths[0]
    if (!path || path === lastOpenedRef.current) return
    const isDir = paths.some((p) => p !== path && p.startsWith(`${path}/`))
    if (isDir) return
    lastOpenedRef.current = path
    onFileOpen(path)
  }, [selectedPaths, paths, onFileOpen])

  const mergedStyle = useMemo(() => ({ height: '100%', ...treeStyles }), [treeStyles])

  return <TreeComponent model={model} style={mergedStyle as React.CSSProperties} />
}
