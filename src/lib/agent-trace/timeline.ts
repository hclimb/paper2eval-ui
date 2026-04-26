import type { Block } from './blocks'
import { EDIT_NAMES, READ_NAMES, WRITE_NAMES } from './tool-names'

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

function getFilePath(args: Record<string, unknown>): string {
  return String(args.file_path ?? args.path ?? args.filename ?? '').trim()
}

function getWriteContent(args: Record<string, unknown>): string | null {
  const v = args.content ?? args.file_text
  return v != null ? String(v) : null
}

interface SingleEdit {
  oldStr: string
  newStr: string
}

function getEdits(args: Record<string, unknown>): SingleEdit[] {
  const editsArr = args.edits
  if (Array.isArray(editsArr)) {
    return editsArr
      .filter((e): e is Record<string, unknown> => e != null && typeof e === 'object')
      .map((e) => ({
        oldStr: String(e.old_string ?? e.old_str ?? ''),
        newStr: String(e.new_string ?? e.new_str ?? ''),
      }))
      .filter((e) => e.oldStr !== '')
  }
  const oldStr = args.old_string ?? args.old_str
  const newStr = args.new_string ?? args.new_str
  if (oldStr != null && newStr != null) {
    return [{ oldStr: String(oldStr), newStr: String(newStr) }]
  }
  return []
}

function applyReplace(content: string, oldStr: string, newStr: string): string {
  const idx = content.indexOf(oldStr)
  if (idx === -1) return content
  return content.slice(0, idx) + newStr + content.slice(idx + oldStr.length)
}

export function buildFileTimeline(blocks: readonly Block[]): FileTimeline {
  const files = new Map<string, string>()
  const changes: FileChange[] = []
  const pathSet = new Set<string>()

  for (const [i, block] of blocks.entries()) {
    if (block.kind !== 'tool') continue
    const name = block.toolName.toLowerCase()
    const args = block.args
    const fp = getFilePath(args)
    if (!fp) continue

    const isWrite = WRITE_NAMES.has(name)
    const isEdit = EDIT_NAMES.has(name)
    const isRead = READ_NAMES.has(name)
    if (!isWrite && !isEdit && !isRead) continue

    pathSet.add(fp)
    const prev = files.get(fp) ?? null

    if (isWrite) {
      const content = getWriteContent(args)
      if (content != null) {
        files.set(fp, content)
        changes.push({
          blockIndex: i,
          path: fp,
          kind: prev == null ? 'create' : 'edit',
          oldContent: prev,
          newContent: content,
        })
      }
      continue
    }

    if (isEdit) {
      const fileText = args.file_text
      if (fileText != null && !args.old_string && !args.old_str && !args.edits) {
        const content = String(fileText)
        files.set(fp, content)
        changes.push({
          blockIndex: i,
          path: fp,
          kind: prev == null ? 'create' : 'edit',
          oldContent: prev,
          newContent: content,
        })
        continue
      }
      const edits = getEdits(args)
      if (edits.length === 0) continue
      let current = prev ?? ''
      for (const e of edits) {
        current = applyReplace(current, e.oldStr, e.newStr)
      }
      files.set(fp, current)
      changes.push({
        blockIndex: i,
        path: fp,
        kind: prev == null ? 'create' : 'edit',
        oldContent: prev,
        newContent: current,
      })
      continue
    }

    if (isRead) {
      const resultContent = block.result?.content
      if (resultContent != null && !block.result?.isError) {
        if (!files.has(fp)) files.set(fp, resultContent)
        changes.push({
          blockIndex: i,
          path: fp,
          kind: 'read',
          oldContent: files.get(fp) ?? null,
          newContent: files.get(fp) ?? resultContent,
        })
      }
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
