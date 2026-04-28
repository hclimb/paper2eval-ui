import { ChevronRight, FileCode2, FileText, Folder, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type RawTreeNode = {
  children: Map<string, RawTreeNode>
  kind: 'directory' | 'file'
  name: string
  path: string
}

type TreeNode = {
  children: TreeNode[]
  kind: 'directory' | 'file'
  name: string
  path: string
}

type InitialOpenDepth = number | 'all'

type SimpleFileTreeProps = {
  activePath: string | null
  initialOpenDepth?: InitialOpenDepth
  onSelect: (path: string) => void
  paths: string[]
}

function buildRawTree(paths: string[]): RawTreeNode {
  const root: RawTreeNode = {
    children: new Map(),
    kind: 'directory',
    name: '',
    path: '',
  }

  for (const path of paths) {
    const parts = path.split('/').filter(Boolean)
    let cursor = root

    for (let index = 0; index < parts.length; index++) {
      const name = parts[index]
      if (!name) continue

      const childPath = parts.slice(0, index + 1).join('/')
      const isFile = index === parts.length - 1
      let child = cursor.children.get(name)

      if (!child) {
        child = {
          children: new Map(),
          kind: isFile ? 'file' : 'directory',
          name,
          path: childPath,
        }
        cursor.children.set(name, child)
      }

      if (!isFile) child.kind = 'directory'
      cursor = child
    }
  }

  return root
}

function toTreeNode(node: RawTreeNode): TreeNode {
  const children = [...node.children.values()]
    .map(toTreeNode)
    .map(compactDirectory)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return {
    children,
    kind: node.kind,
    name: node.name,
    path: node.path,
  }
}

function compactDirectory(node: TreeNode): TreeNode {
  if (node.kind !== 'directory') return node

  let current = node
  while (current.children.length === 1 && current.children[0]?.kind === 'directory') {
    const child = current.children[0]
    current = {
      ...child,
      name: `${current.name}/${child.name}`,
    }
  }

  return current
}

function collectOpenPaths(node: TreeNode, initialOpenDepth: InitialOpenDepth): Set<string> {
  const open = new Set<string>()

  function visit(current: TreeNode, depth: number) {
    for (const child of current.children) {
      if (child.kind !== 'directory') continue
      if (initialOpenDepth === 'all' || depth < initialOpenDepth) {
        open.add(child.path)
        visit(child, depth + 1)
      }
    }
  }

  visit(node, 0)
  return open
}

function fileIconFor(path: string) {
  if (/\.(json|toml|ya?ml|md|txt|lock)$/i.test(path)) return FileText
  return FileCode2
}

export function SimpleFileTree({
  activePath,
  initialOpenDepth = 1,
  onSelect,
  paths,
}: SimpleFileTreeProps) {
  const tree = useMemo(() => toTreeNode(buildRawTree(paths)), [paths])
  const initialOpen = useMemo(
    () => collectOpenPaths(tree, initialOpenDepth),
    [initialOpenDepth, tree],
  )
  const [openPaths, setOpenPaths] = useState<Set<string>>(() => initialOpen)

  useEffect(() => {
    setOpenPaths(initialOpen)
  }, [initialOpen])

  const toggleDirectory = (path: string) => {
    setOpenPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const renderNode = (node: TreeNode, depth: number) => {
    const isDirectory = node.kind === 'directory'
    const isOpen = openPaths.has(node.path)
    const isActive = activePath === node.path
    const FileIcon = fileIconFor(node.path)

    return (
      <li key={node.path} className="file-tree-item">
        <button
          type="button"
          className="file-tree-row"
          data-active={isActive || undefined}
          onClick={() => {
            if (isDirectory) toggleDirectory(node.path)
            else onSelect(node.path)
          }}
          aria-expanded={isDirectory ? isOpen : undefined}
          title={node.path}
          style={{ paddingLeft: `calc(var(--space-2) + ${depth * 1.05}rem)` }}
        >
          {isDirectory ? (
            <>
              <ChevronRight
                className="file-tree-chevron"
                size={14}
                aria-hidden="true"
                data-open={isOpen || undefined}
              />
              {isOpen ? (
                <FolderOpen className="file-tree-icon" size={15} aria-hidden="true" />
              ) : (
                <Folder className="file-tree-icon" size={15} aria-hidden="true" />
              )}
            </>
          ) : (
            <>
              <span className="file-tree-spacer" aria-hidden="true" />
              <FileIcon className="file-tree-icon" size={15} aria-hidden="true" />
            </>
          )}
          <span className="file-tree-name">{node.name}</span>
        </button>
        {isDirectory && isOpen && node.children.length > 0 && (
          <ul className="file-tree-list">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  if (tree.children.length === 0) {
    return <div className="file-tree-empty">no files</div>
  }

  return <ul className="file-tree-list">{tree.children.map((node) => renderNode(node, 0))}</ul>
}
