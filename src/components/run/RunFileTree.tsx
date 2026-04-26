import { useEffect, useMemo, useState } from 'react'
import { TREE_THEME_COLORS } from '#/lib/tree-theme'

export function RunFileTree({ files }: { files: { key: string; size: number }[] }) {
  const [mod, setMod] = useState<typeof import('@pierre/trees/react') | null>(null)
  const [treeStyles, setTreeStyles] = useState<Record<string, string>>({})
  const paths = useMemo(() => files.map((f) => f.key), [files])

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

  if (!mod) return null

  return (
    <RunFileTreeInner
      FileTree={mod.FileTree}
      useFileTree={mod.useFileTree}
      paths={paths}
      treeStyles={treeStyles}
    />
  )
}

function RunFileTreeInner({
  FileTree: TreeComponent,
  useFileTree: useTreeHook,
  paths,
  treeStyles,
}: {
  FileTree: typeof import('@pierre/trees/react').FileTree
  useFileTree: typeof import('@pierre/trees/react').useFileTree
  paths: string[]
  treeStyles: Record<string, string>
}) {
  const treeOpts = useMemo(
    () => ({
      paths,
      initialExpansion: 'open' as const,
      flattenEmptyDirectories: true,
      search: true,
      icons: 'standard' as const,
    }),
    [paths],
  )

  const { model } = useTreeHook(treeOpts)

  const mergedStyle = useMemo(() => ({ height: '400px', ...treeStyles }), [treeStyles])

  return <TreeComponent model={model} style={mergedStyle as React.CSSProperties} />
}
