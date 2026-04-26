import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CodeBlock } from '#/components/CodeBlock'
import { fetchTaskFile } from '#/lib/tasks.api'
import { TREE_THEME_COLORS } from '#/lib/tree-theme'

type TreesReact = typeof import('@pierre/trees/react')
type TreesCore = typeof import('@pierre/trees')

export function FileExplorer({ paths, slug }: { paths: string[]; slug: string }) {
  // pierre/trees uses web components + shadow DOM, so it's client-only.
  const [mods, setMods] = useState<{ react: TreesReact; core: TreesCore } | null>(null)
  useEffect(() => {
    let cancelled = false
    Promise.all([import('@pierre/trees/react'), import('@pierre/trees')]).then(([react, core]) => {
      if (!cancelled) setMods({ react, core })
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!mods) {
    return (
      <div className="explorer-chrome">
        <div className="explorer-title-bar">
          <span>EXPLORER</span>
          <span style={{ fontWeight: 400, fontSize: '10px' }}>{paths.length} files</span>
        </div>
      </div>
    )
  }

  return <ExplorerInner mods={mods} paths={paths} slug={slug} />
}

function ExplorerInner({
  mods,
  paths,
  slug,
}: {
  mods: { react: TreesReact; core: TreesCore }
  paths: string[]
  slug: string
}) {
  const [activePath, setActivePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // pre-compute directory paths for fast isDirectory check inside selection callback
  const directoryPaths = useMemo(() => {
    const dirs = new Set<string>()
    for (const p of paths) {
      const segments = p.split('/')
      for (let i = 1; i < segments.length; i++) {
        dirs.add(segments.slice(0, i).join('/'))
      }
    }
    return dirs
  }, [paths])

  const treeStyles = useMemo(
    () =>
      mods.core.themeToTreeStyles({
        type: 'light',
        bg: '#ede5d3',
        fg: '#141410',
        colors: TREE_THEME_COLORS,
      }),
    [mods],
  )

  // ref-callback so the model's stable onSelectionChange always sees the latest open logic
  const openFile = useCallback(
    (path: string) => {
      setActivePath(path)
      setLoading(true)
      setFileContent(null)
      fetchTaskFile({ data: { slug, path } }).then((res) => {
        setFileContent(res.content)
        setLoading(false)
      })
    },
    [slug],
  )
  const openFileRef = useRef(openFile)
  openFileRef.current = openFile

  const { model } = mods.react.useFileTree({
    paths,
    initialExpansion: 1,
    flattenEmptyDirectories: true,
    search: true,
    icons: 'standard',
    onSelectionChange: (selectedPaths) => {
      const path = selectedPaths[0]
      if (!path || directoryPaths.has(path)) return
      openFileRef.current(path)
    },
  })

  const closeFile = useCallback(() => {
    if (activePath) {
      const handle = model.getItem(activePath)
      handle?.deselect()
    }
    setActivePath(null)
    setFileContent(null)
  }, [activePath, model])

  const fileName = activePath ? activePath.split('/').pop() : null
  const fileDir = activePath?.includes('/')
    ? activePath.slice(0, activePath.lastIndexOf('/'))
    : null

  const FileTreeComponent = mods.react.FileTree

  return (
    <div className="explorer-chrome">
      <div className="explorer-title-bar">
        <span>EXPLORER</span>
        <span style={{ fontWeight: 400, fontSize: '10px' }}>{paths.length} files</span>
      </div>
      <div className="explorer-body">
        <div className="explorer-tree-pane">
          <div className="explorer-pane-header">Files</div>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            <FileTreeComponent
              model={model}
              style={{ height: '100%', ...treeStyles } as React.CSSProperties}
            />
          </div>
        </div>
        <div className="explorer-editor-pane">
          {!activePath && (
            <div className="explorer-empty">
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                aria-label="empty"
              >
                <title>no file open</title>
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
              <span className="explorer-empty-title">No file open</span>
              <span className="explorer-empty-hint">
                Select a file from the tree to view its contents
              </span>
            </div>
          )}
          {activePath && (
            <>
              <div className="explorer-tab-bar">
                <div className="explorer-tab" data-active="true">
                  <span className="explorer-tab-name">{fileName}</span>
                  {fileDir && <span className="explorer-tab-path">{fileDir}</span>}
                  <button
                    type="button"
                    className="explorer-tab-close"
                    onClick={closeFile}
                    aria-label={`close ${fileName}`}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      fill="none"
                    >
                      <title>close</title>
                      <line x1="2" y1="2" x2="8" y2="8" />
                      <line x1="8" y1="2" x2="2" y2="8" />
                    </svg>
                  </button>
                </div>
              </div>
              {loading && (
                <div className="explorer-skeleton">
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                </div>
              )}
              {!loading && fileContent != null && (
                <div className="explorer-editor" style={{ flex: 1, overflow: 'auto' }}>
                  <CodeBlock
                    content={fileContent}
                    filename={activePath}
                    maxHeight={9999}
                    theme="github-dark-default"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
