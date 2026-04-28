import { FileText, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { CodeBlock } from '#/components/CodeBlock'
import { SimpleFileTree } from '#/components/SimpleFileTree'
import { fetchTaskFile } from '#/lib/tasks.api'

export function FileExplorer({ paths, slug }: { paths: string[]; slug: string }) {
  const [activePath, setActivePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const openFile = useCallback(
    (path: string) => {
      setActivePath(path)
      setLoading(true)
      setLoadError(null)
      setFileContent(null)

      fetchTaskFile({ data: { slug, path } })
        .then((res) => {
          setFileContent(res.content)
        })
        .catch((error: unknown) => {
          setLoadError(error instanceof Error ? error.message : 'failed to load file')
        })
        .finally(() => {
          setLoading(false)
        })
    },
    [slug],
  )

  const closeFile = useCallback(() => {
    setActivePath(null)
    setFileContent(null)
    setLoadError(null)
  }, [])

  const fileName = activePath ? activePath.split('/').pop() : null
  const fileDir = activePath?.includes('/')
    ? activePath.slice(0, activePath.lastIndexOf('/'))
    : null

  return (
    <div className="explorer-chrome">
      <div className="explorer-title-bar">
        <span>EXPLORER</span>
        <span>{paths.length} files</span>
      </div>
      <div className="explorer-body">
        <aside className="explorer-tree-pane" aria-label="Files">
          <div className="explorer-pane-header">
            <span>Files</span>
          </div>
          <div className="explorer-tree-scroll">
            <SimpleFileTree
              activePath={activePath}
              initialOpenDepth={1}
              onSelect={openFile}
              paths={paths}
            />
          </div>
        </aside>
        <section className="explorer-editor-pane" aria-label="File preview">
          {!activePath && (
            <div className="explorer-empty">
              <FileText size={34} strokeWidth={1.2} aria-hidden="true" />
              <span className="explorer-empty-title">No file open</span>
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
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {loading && (
                <div className="explorer-skeleton" role="status" aria-label="Loading file">
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                </div>
              )}
              {loadError && <div className="explorer-error">{loadError}</div>}
              {!loading && !loadError && fileContent != null && (
                <div className="explorer-editor">
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
        </section>
      </div>
    </div>
  )
}
