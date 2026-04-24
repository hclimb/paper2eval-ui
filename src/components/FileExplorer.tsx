import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CodeBlock } from '#/components/CodeBlock'
import { fetchTaskFile } from '#/lib/server-fns'
import { TREE_THEME_COLORS } from '#/lib/tree-theme'

export function FileExplorer({ paths, slug }: { paths: string[]; slug: string }) {
  const [mod, setMod] = useState<typeof import('@pierre/trees/react') | null>(null)
  const [treeStyles, setTreeStyles] = useState<Record<string, string>>({})
  const [activePath, setActivePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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

  if (!mod) return null

  const fileName = activePath ? activePath.split('/').pop() : null
  const fileDir = activePath?.includes('/')
    ? activePath.slice(0, activePath.lastIndexOf('/'))
    : null

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
            <ExplorerTree
              FileTree={mod.FileTree}
              useFileTree={mod.useFileTree}
              useFileTreeSelection={mod.useFileTreeSelection}
              paths={paths}
              filePaths={paths}
              treeStyles={treeStyles}
              onFileOpen={handleFileOpen}
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
              >
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
              <span className="explorer-empty-title">No file open</span>
              <span className="explorer-empty-hint">
                Select a file from the tree to view its contents
              </span>
            </div>
          )}
          {activePath && loading && (
            <div className="explorer-tab-bar">
              <div className="explorer-tab" data-active="true">
                <span className="explorer-tab-name">{fileName}</span>
              </div>
            </div>
          )}
          {activePath && loading && (
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
          {activePath && !loading && fileContent != null && (
            <>
              <div className="explorer-tab-bar">
                <div className="explorer-tab" data-active="true">
                  <span className="explorer-tab-name">{fileName}</span>
                  {fileDir && <span className="explorer-tab-path">{fileDir}</span>}
                  <span className="explorer-tab-close">
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      fill="none"
                    >
                      <line x1="2" y1="2" x2="8" y2="8" />
                      <line x1="8" y1="2" x2="2" y2="8" />
                    </svg>
                  </span>
                </div>
              </div>
              <div className="explorer-editor" style={{ flex: 1, overflow: 'auto' }}>
                <CodeBlock
                  content={fileContent}
                  filename={activePath}
                  maxHeight={9999}
                  theme="github-dark-default"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ExplorerTree({
  FileTree: TreeComponent,
  useFileTree: useTreeHook,
  useFileTreeSelection: useSelectionHook,
  paths,
  filePaths,
  treeStyles,
  onFileOpen,
}: {
  FileTree: typeof import('@pierre/trees/react').FileTree
  useFileTree: typeof import('@pierre/trees/react').useFileTree
  useFileTreeSelection: typeof import('@pierre/trees/react').useFileTreeSelection
  paths: string[]
  filePaths: string[]
  treeStyles: Record<string, string>
  onFileOpen: (path: string) => void
}) {
  const treeOpts = useMemo(
    () => ({
      paths,
      initialExpansion: 1 as const,
      flattenEmptyDirectories: true,
      search: true,
      icons: 'standard' as const,
    }),
    [paths],
  )

  const { model } = useTreeHook(treeOpts)
  const selectedPaths = useSelectionHook(model)

  const lastOpenedRef = useRef<string | null>(null)
  useEffect(() => {
    const path = selectedPaths[0]
    if (!path || path === lastOpenedRef.current) return
    const isDir = filePaths.some((p) => p !== path && p.startsWith(`${path}/`))
    if (isDir) return
    lastOpenedRef.current = path
    onFileOpen(path)
  }, [selectedPaths, filePaths, onFileOpen])

  const mergedStyle = useMemo(() => ({ height: '100%', ...treeStyles }), [treeStyles])

  return <TreeComponent model={model} style={mergedStyle as React.CSSProperties} />
}
