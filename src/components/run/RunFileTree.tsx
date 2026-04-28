import { useEffect, useMemo, useState } from 'react'
import { SimpleFileTree } from '#/components/SimpleFileTree'
import { formatBytes } from '#/lib/formatters'

export function RunFileTree({ files }: { files: { key: string; size: number }[] }) {
  const paths = useMemo(() => files.map((file) => file.key), [files])
  const [activePath, setActivePath] = useState<string | null>(() => paths[0] ?? null)

  useEffect(() => {
    setActivePath((current) => (current && paths.includes(current) ? current : (paths[0] ?? null)))
  }, [paths])

  const activeFile = activePath ? files.find((file) => file.key === activePath) : null

  return (
    <div className="run-file-browser">
      <aside className="run-file-sidebar" aria-label="Files">
        <div className="run-file-head">
          <span>Files</span>
          <span>{files.length}</span>
        </div>
        <SimpleFileTree
          activePath={activePath}
          initialOpenDepth="all"
          onSelect={setActivePath}
          paths={paths}
        />
      </aside>
      <section className="run-file-detail" aria-label="File detail">
        {activeFile ? (
          <>
            <div className="run-file-path">{activeFile.key}</div>
            <dl className="run-file-meta">
              <div>
                <dt>size</dt>
                <dd>{formatBytes(activeFile.size)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="run-file-empty">no files</div>
        )}
      </section>
    </div>
  )
}
