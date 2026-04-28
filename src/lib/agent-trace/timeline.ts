import type { Block } from './blocks'

export type FileChangeKind = 'create' | 'edit' | 'read'

export interface FileChange {
  blockIndex: number
  path: string
  kind: FileChangeKind
  oldContent: string | null
  newContent: string
}

export interface FileTimeline {
  changes: FileChange[]
  paths: string[]
  finalState: ReadonlyMap<string, string>
}

/**
 * Build a per-file change timeline from the parsed blocks.
 *
 * Pulls authoritative pre/post content from the tool_use_result envelope claude-code
 * provides — `originalFile` for the baseline, `newContent` for the post-edit state.
 * No simulator. No string-replace approximation. If the envelope is missing
 * (e.g. corrupt mid-session trace), we skip the change rather than fabricate one.
 */
export function buildFileTimeline(blocks: readonly Block[]): FileTimeline {
  const files = new Map<string, string>()
  const changes: FileChange[] = []
  const pathSet = new Set<string>()

  for (const [i, block] of blocks.entries()) {
    if (block.kind !== 'tool' || !block.result) continue

    if (block.result.kind === 'write') {
      const r = block.result.data
      pathSet.add(r.filePath)
      files.set(r.filePath, r.newContent)
      changes.push({
        blockIndex: i,
        path: r.filePath,
        kind: r.type === 'create' ? 'create' : 'edit',
        oldContent: r.type === 'create' ? null : r.originalFile,
        newContent: r.newContent,
      })
      continue
    }

    if (block.result.kind === 'edit') {
      const r = block.result.data
      pathSet.add(r.filePath)
      files.set(r.filePath, r.newContent)
      changes.push({
        blockIndex: i,
        path: r.filePath,
        kind: 'edit',
        oldContent: r.originalFile,
        newContent: r.newContent,
      })
      continue
    }

    if (block.result.kind === 'read') {
      const r = block.result.data
      if (r.isError) continue
      pathSet.add(r.filePath)
      if (!files.has(r.filePath)) files.set(r.filePath, r.content)
      changes.push({
        blockIndex: i,
        path: r.filePath,
        kind: 'read',
        oldContent: files.get(r.filePath) ?? r.content,
        newContent: files.get(r.filePath) ?? r.content,
      })
    }
  }

  return { changes, paths: [...pathSet].sort(), finalState: files }
}

export function contentAt(timeline: FileTimeline, path: string, blockIndex: number): string | null {
  for (let i = timeline.changes.length - 1; i >= 0; i--) {
    const c = timeline.changes[i]
    if (c && c.path === path && c.blockIndex <= blockIndex) return c.newContent
  }
  return null
}

export function changesAtBlock(timeline: FileTimeline, blockIndex: number): FileChange[] {
  return timeline.changes.filter((c) => c.blockIndex === blockIndex)
}
