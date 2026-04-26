import { MultiFileDiff } from '@pierre/diffs/react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileCode2,
  Terminal,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BASH_NAMES,
  type Block,
  buildFileTimeline,
  EDIT_NAMES,
  type FileChange,
  type FileTimeline,
  FS_NAMES,
  parseAgentTrace,
  READ_NAMES,
  SEARCH_NAMES,
  TASK_NAMES,
  toolFilePath,
  WEB_NAMES,
  WRITE_NAMES,
} from '#/lib/agent-trace'
import { fmtCost, fmtMs } from '#/lib/formatters'

type EntryKind =
  | 'thinking'
  | 'text'
  | 'bash'
  | 'read'
  | 'write'
  | 'edit'
  | 'search'
  | 'fs'
  | 'web'
  | 'task'
  | 'tool'
  | 'system'
  | 'result'

interface TimelineEntry {
  idx: number
  kind: EntryKind
  label: string
  filePath?: string
  exitCode?: number
  isError?: boolean
  fileChange?: FileChange
  block: Block
}

function trunc(s: string, n: number): string {
  const l = s.split('\n')[0] ?? ''
  return l.length > n ? `${l.slice(0, n)}…` : l
}
function base(p: string): string {
  return p.split('/').pop() ?? p
}

type ParseResult =
  | { kind: 'ok'; blocks: Block[]; entries: TimelineEntry[] }
  | { kind: 'too-large'; bytes: number }
  | { kind: 'not-stream' }

function parseAll(raw: string): ParseResult {
  const result = parseAgentTrace(raw)
  if (!result.ok) {
    return result.reason === 'too-large'
      ? { kind: 'too-large', bytes: result.bytes }
      : { kind: 'not-stream' }
  }
  const blocks = result.blocks.filter((b) => b.kind !== 'raw')
  const entries: TimelineEntry[] = []
  for (let i = 0; i < blocks.length; i++) {
    const e = mkEntry(i, blocks[i]!)
    if (e) entries.push(e)
  }
  return { kind: 'ok', blocks, entries }
}

function mkEntry(idx: number, b: Block): TimelineEntry | null {
  if (b.kind === 'thinking')
    return { idx, kind: 'thinking', label: trunc(b.content, 80), block: b }
  if (b.kind === 'text') return { idx, kind: 'text', label: trunc(b.content, 80), block: b }
  if (b.kind === 'system') return { idx, kind: 'system', label: b.model || 'session', block: b }
  if (b.kind === 'result')
    return {
      idx,
      kind: 'result',
      label: b.isError ? 'Failed' : 'Completed',
      isError: b.isError,
      block: b,
    }
  if (b.kind !== 'tool') return null
  const name = b.toolName.toLowerCase()
  const args = b.args
  const path = toolFilePath(args)
  const ec = b.result?.exitCode
  if (BASH_NAMES.has(name))
    return {
      idx,
      kind: 'bash',
      label: trunc(String(args.command ?? args.cmd ?? ''), 60) || 'shell',
      exitCode: ec,
      isError: b.result?.isError,
      block: b,
    }
  if (READ_NAMES.has(name))
    return { idx, kind: 'read', label: path || 'read', filePath: path, block: b }
  if (WRITE_NAMES.has(name))
    return { idx, kind: 'write', label: path || 'write', filePath: path, block: b }
  if (EDIT_NAMES.has(name)) {
    const isCreate = args.file_text != null && !args.old_string && !args.old_str && !args.edits
    return {
      idx,
      kind: isCreate ? 'write' : 'edit',
      label: path || 'edit',
      filePath: path,
      block: b,
    }
  }
  if (SEARCH_NAMES.has(name))
    return {
      idx,
      kind: 'search',
      label: trunc(String(args.pattern ?? args.regex ?? args.query ?? ''), 50) || 'search',
      block: b,
    }
  if (FS_NAMES.has(name))
    return {
      idx,
      kind: 'fs',
      label: trunc(String(args.pattern ?? args.glob ?? args.path ?? '.'), 50),
      block: b,
    }
  if (TASK_NAMES.has(name))
    return {
      idx,
      kind: 'task',
      label: trunc(String(args.description ?? args.prompt ?? 'subagent'), 60),
      block: b,
    }
  if (WEB_NAMES.has(name))
    return { idx, kind: 'web', label: trunc(String(args.url ?? 'web'), 60), block: b }
  return { idx, kind: 'tool', label: String(b.toolName ?? 'tool'), block: b }
}

function linkChanges(entries: TimelineEntry[], tl: FileTimeline): void {
  const m = new Map<number, FileChange>()
  for (const c of tl.changes) m.set(c.blockIndex, c)
  for (const e of entries) {
    if (e.filePath) e.fileChange = m.get(e.idx)
  }
}

const TRACK_COLORS: Record<string, string> = {
  write: '#22c55e',
  edit: '#d97706',
  bash: '#6b645a',
  read: '#3b82f6',
  thinking: '#8b5cf680',
  text: '#a5303040',
  search: '#3b82f680',
  fs: '#6b645a',
  web: '#6366f1',
  task: '#8b5cf6',
  tool: '#6b645a',
  system: '#b8ac9a',
  result: '#b8ac9a',
}

function trackColor(e: TimelineEntry): string {
  if (e.kind === 'bash' && e.exitCode !== undefined && e.exitCode !== 0) return '#a53030'
  return TRACK_COLORS[e.kind] ?? '#b8ac9a'
}

function Scrubber({
  entries,
  step,
  onStep,
}: {
  entries: TimelineEntry[]
  step: number
  onStep: (n: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const resolve = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || entries.length < 2) return
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      onStep(Math.round(pct * (entries.length - 1)))
    },
    [entries.length, onStep],
  )
  const dragging = useRef(false)
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      resolve(e.clientX)
    },
    [resolve],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging.current) resolve(e.clientX)
    },
    [resolve],
  )
  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  const ticks = useMemo(
    () => (
      <div
        style={{
          position: 'absolute',
          inset: '0',
          top: '50%',
          transform: 'translateY(-50%)',
          height: '5px',
          borderRadius: '3px',
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        {entries.map((e) => (
          <div key={e.idx} style={{ flex: 1, minWidth: 0, background: trackColor(e) }} />
        ))}
      </div>
    ),
    [entries],
  )
  const pct = entries.length > 1 ? (step / (entries.length - 1)) * 100 : 0

  return (
    <div
      ref={trackRef}
      style={{
        position: 'relative',
        height: '1rem',
        cursor: 'pointer',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {ticks}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: `${pct}%`,
          transform: 'translate(-50%, -50%)',
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: 'var(--paper)',
          boxShadow: '0 0 0 2px var(--ink)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

function FileSidebar({
  files,
  activeFile,
  touchedFile,
  touchKind,
  onSelect,
}: {
  files: string[]
  activeFile: string | null
  touchedFile: string | null
  touchKind: string | null
  onSelect: (f: string) => void
}) {
  return (
    <div
      style={{
        width: '180px',
        flexShrink: 0,
        borderRight: '1px solid var(--rule)',
        background: 'var(--paper-deep)',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          padding: '0.75rem 1rem',
          fontSize: 'var(--fs-xs)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--ink-soft)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        Files
      </div>
      {files.length === 0 && (
        <div
          style={{
            padding: '1rem 0.75rem',
            fontSize: 'var(--fs-sm)',
            color: 'var(--ink-soft)',
            fontStyle: 'italic',
          }}
        >
          no files yet
        </div>
      )}
      {files.map((f) => {
        const isActive = f === activeFile
        const isTouched = f === touchedFile
        const dotColor =
          touchKind === 'write' ? '#22c55e' : touchKind === 'edit' ? '#d97706' : '#3b82f6'
        return (
          <button
            key={f}
            type="button"
            onClick={() => onSelect(f)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.4rem 1rem',
              fontSize: 'var(--fs-sm)',
              fontFamily: 'var(--font-mono)',
              textAlign: 'left',
              border: 'none',
              cursor: 'pointer',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              background: isActive ? 'var(--accent)' : 'transparent',
              color: isActive ? 'var(--paper)' : 'var(--ink-soft)',
            }}
          >
            {isTouched ? (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: dotColor,
                }}
              />
            ) : (
              <FileCode2 size={11} style={{ flexShrink: 0, opacity: 0.3 }} />
            )}
            {base(f)}
          </button>
        )
      })}
    </div>
  )
}

function DiffPane({ change }: { change: FileChange }) {
  const oldFile = useMemo(
    () => ({ name: change.path, contents: change.oldContent ?? '' }),
    [change.path, change.oldContent],
  )
  const newFile = useMemo(
    () => ({ name: change.path, contents: change.newContent }),
    [change.path, change.newContent],
  )
  const opts = useMemo(
    () => ({
      diffStyle: 'unified' as const,
      diffIndicators: 'bars' as const,
      lineDiffType: 'word' as const,
      overflow: 'wrap' as const,
      expandUnchanged: true,
      theme: 'pierre-light',
    }),
    [],
  )
  return <MultiFileDiff oldFile={oldFile} newFile={newFile} options={opts} />
}

function ThinkingOverlay({ text, onClose }: { text: string; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const lines = text.split('\n')
  const isLong = lines.length > 6
  const shown = expanded || !isLong ? text : lines.slice(0, 6).join('\n')

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '1rem',
        right: '1rem',
        left: '1rem',
        zIndex: 10,
        pointerEvents: 'none',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          width: '100%',
          maxWidth: '28rem',
          borderRadius: '8px',
          border: '1px solid #c4b5fd80',
          background: 'color-mix(in oklab, var(--paper) 95%, #8b5cf620)',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 4px 16px rgba(20,20,16,0.15)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            borderBottom: '1px solid #c4b5fd40',
          }}
        >
          <span style={{ fontSize: 'var(--fs-sm)' }}>🧠</span>
          <span
            style={{
              flex: 1,
              fontSize: 'var(--fs-xs)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#7c3aed',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Thinking
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#7c3aed80',
              padding: 0,
            }}
          >
            <X size={12} />
          </button>
        </div>
        <div style={{ padding: '0.75rem 1rem', maxHeight: '200px', overflowY: 'auto' }}>
          <pre
            style={{
              fontSize: 'var(--fs-sm)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.6,
              color: 'var(--ink)',
              margin: 0,
              fontFamily: 'var(--font-mono)',
              background: 'transparent',
              border: 0,
              padding: 0,
            }}
          >
            {shown}
          </pre>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              style={{
                marginTop: '0.25rem',
                fontSize: 'var(--fs-xs)',
                fontFamily: 'var(--font-mono)',
                color: '#7c3aed80',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {expanded ? '▾ less' : `▸ +${lines.length - 6} lines`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CenterContent({ change, entry }: { change: FileChange | null; entry: TimelineEntry }) {
  if (change) return <DiffPane change={change} />

  if (entry.kind === 'bash') {
    const b = entry.block as Extract<Block, { kind: 'tool' }>
    const cmd = String(b.args.command ?? b.args.cmd ?? '')
    const output = b.result?.content ?? ''
    const bad = entry.exitCode !== undefined && entry.exitCode !== 0
    return (
      <div style={{ padding: '1rem', height: '100%', display: 'flex', alignItems: 'flex-start' }}>
        <div
          style={{
            borderRadius: '8px',
            overflow: 'hidden',
            border: `1px solid ${bad ? '#fca5a580' : 'var(--rule)'}`,
            width: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.6rem 1rem',
              background: '#1a1a1a',
              borderBottom: '1px solid #333',
            }}
          >
            <Terminal size={13} style={{ color: '#888', flexShrink: 0 }} />
            <pre
              style={{
                fontSize: 'var(--fs-base)',
                fontFamily: 'var(--font-mono)',
                color: '#4ade80',
                flex: 1,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                margin: 0,
                background: 'transparent',
                border: 0,
                padding: 0,
              }}
            >
              <span style={{ color: '#555', userSelect: 'none' }}>$ </span>
              {cmd}
            </pre>
            {entry.exitCode !== undefined && (
              <span
                style={{
                  fontSize: 'var(--fs-xs)',
                  fontFamily: 'var(--font-mono)',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '3px',
                  flexShrink: 0,
                  background: bad ? '#991b1b' : 'transparent',
                  color: bad ? '#fca5a5' : '#4ade80',
                  border: `1px solid ${bad ? '#991b1b' : '#065f46'}`,
                }}
              >
                exit {entry.exitCode}
              </span>
            )}
          </div>
          {output && (
            <div style={{ background: '#111', maxHeight: '60vh', overflow: 'auto' }}>
              <pre
                style={{
                  padding: '0.75rem 1rem',
                  fontSize: 'var(--fs-sm)',
                  fontFamily: 'var(--font-mono)',
                  color: '#ccc',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.7,
                  margin: 0,
                  background: 'transparent',
                  border: 0,
                }}
              >
                {output}
              </pre>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (entry.kind === 'result') {
    const b = entry.block as Extract<Block, { kind: 'result' }>
    const bad = b.isError
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '1.5rem',
        }}
      >
        <div
          style={{
            borderRadius: '8px',
            border: `1px solid ${bad ? '#fca5a5' : '#86efac'}`,
            padding: '1.5rem',
            background: bad ? '#fee2e2' : '#dcfce7',
          }}
        >
          <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>
            {bad ? '✗ Session failed' : '✓ Session completed'}
          </span>
          <div
            style={{
              display: 'flex',
              gap: '1.5rem',
              marginTop: '0.75rem',
              fontSize: 'var(--fs-sm)',
            }}
          >
            {b.numTurns != null && (
              <div>
                <div
                  style={{
                    fontSize: 'var(--fs-xs)',
                    textTransform: 'uppercase',
                    color: 'var(--ink-soft)',
                  }}
                >
                  Turns
                </div>
                <span className="font-mono">{String(b.numTurns)}</span>
              </div>
            )}
            {b.costUsd != null && (
              <div>
                <div
                  style={{
                    fontSize: 'var(--fs-xs)',
                    textTransform: 'uppercase',
                    color: 'var(--ink-soft)',
                  }}
                >
                  Cost
                </div>
                <span className="font-mono">{fmtCost(Number(b.costUsd))}</span>
              </div>
            )}
            {b.durationMs != null && (
              <div>
                <div
                  style={{
                    fontSize: 'var(--fs-xs)',
                    textTransform: 'uppercase',
                    color: 'var(--ink-soft)',
                  }}
                >
                  Duration
                </div>
                <span className="font-mono">{fmtMs(Number(b.durationMs))}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (entry.kind === 'system') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '1.5rem',
        }}
      >
        <div style={{ borderRadius: '8px', border: '1px solid var(--rule)', padding: '1.5rem' }}>
          <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--ink-soft)' }}>
            ⚙ Session started
          </span>
          {(entry.block as Extract<Block, { kind: 'system' }>).model ? (
            <p className="font-mono" style={{ fontSize: 'var(--fs-sm)', marginTop: '0.5rem' }}>
              {(entry.block as Extract<Block, { kind: 'system' }>).model}
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  if (entry.kind === 'text' || entry.kind === 'thinking') {
    const b = entry.block as Extract<Block, { kind: 'text' | 'thinking' }>
    const isThinking = entry.kind === 'thinking'
    return (
      <div
        style={{
          padding: '1.5rem',
          overflowY: 'auto',
          height: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            maxWidth: '48rem',
            width: '100%',
            borderLeft: `3px solid ${isThinking ? '#8b5cf6' : 'var(--accent)'}`,
            background: isThinking
              ? 'color-mix(in oklab, var(--paper-deep) 80%, #8b5cf610)'
              : 'var(--paper-deep)',
            borderRadius: '0 6px 6px 0',
            padding: '1.25rem 1.5rem',
          }}
        >
          <div
            style={{
              fontSize: 'var(--fs-xs)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: isThinking ? '#7c3aed' : 'var(--accent)',
              fontFamily: 'var(--font-mono)',
              marginBottom: '0.75rem',
            }}
          >
            {isThinking ? '🧠 Agent Thinking' : '💬 Agent Reasoning'}
          </div>
          <pre
            style={{
              fontSize: 'var(--fs-base)',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.8,
              color: 'var(--ink)',
              margin: 0,
              background: 'transparent',
              border: 0,
              padding: 0,
            }}
          >
            {b.content}
          </pre>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--ink-soft)',
        fontSize: 'var(--fs-sm)',
      }}
    >
      no file selected
    </div>
  )
}

function TermPanel({
  entry,
  isOpen,
  onToggle,
}: {
  entry: TimelineEntry | null
  isOpen: boolean
  onToggle: () => void
}) {
  if (!entry) return null
  const b = entry.block as Extract<Block, { kind: 'tool' }>
  const cmd = String(b.args.command ?? b.args.cmd ?? '')
  const output = b.result?.content ?? ''
  const bad = entry.exitCode !== undefined && entry.exitCode !== 0

  return (
    <div style={{ borderTop: `1px solid ${bad ? '#a5303080' : 'var(--rule)'}`, flexShrink: 0 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.4rem 1rem',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <Terminal size={11} style={{ color: 'var(--ink-soft)', flexShrink: 0, opacity: 0.5 }} />
        <pre
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--ink-soft)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            margin: 0,
            background: 'transparent',
            border: 0,
            padding: 0,
          }}
        >
          <span style={{ color: 'var(--ink-soft)', opacity: 0.4, userSelect: 'none' }}>$ </span>
          {trunc(cmd, 80)}
        </pre>
        {entry.exitCode !== undefined && (
          <span
            style={{
              fontSize: 'var(--fs-xs)',
              fontFamily: 'var(--font-mono)',
              padding: '0 0.3rem',
              borderRadius: '2px',
              flexShrink: 0,
              background: bad ? '#a53030' : 'transparent',
              color: bad ? 'var(--paper)' : '#065f46',
              border: `1px solid ${bad ? '#a53030' : '#86efac'}`,
            }}
          >
            {entry.exitCode}
          </span>
        )}
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-soft)', opacity: 0.3 }}>
          {isOpen ? '▾' : '▸'}
        </span>
      </button>
      {isOpen && output && (
        <div
          style={{
            background: '#1a1a1a',
            maxHeight: '160px',
            overflow: 'auto',
            borderTop: '1px solid #333',
          }}
        >
          <pre
            style={{
              padding: '0.75rem 1rem',
              fontSize: 'var(--fs-xs)',
              fontFamily: 'var(--font-mono)',
              color: '#aaa',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.7,
              margin: 0,
              background: 'transparent',
              border: 0,
            }}
          >
            {output}
          </pre>
        </div>
      )}
    </div>
  )
}

export function ReplayViewer({ content }: { content: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const parsed = useMemo(() => parseAll(content), [content])
  const timeline = useMemo(
    () => (parsed.kind === 'ok' ? buildFileTimeline(parsed.blocks) : null),
    [parsed],
  )
  const entries = useMemo(() => {
    if (parsed.kind !== 'ok' || !timeline) return []
    linkChanges(parsed.entries, timeline)
    return parsed.entries
  }, [parsed, timeline])

  const [step, setStep] = useState(() => {
    const idx = entries.findIndex((e) => e.kind === 'write' || e.kind === 'edit')
    return idx >= 0 ? idx : 0
  })
  const safe = entries.length ? Math.min(step, entries.length - 1) : 0
  const entry = entries[safe]

  const [pinnedFile, setPinnedFile] = useState<string | null>(null)
  const derivedFile = useMemo(() => {
    if (pinnedFile) return pinnedFile
    for (let i = safe; i >= 0; i--) {
      if (entries[i]?.filePath) return entries[i]!.filePath!
    }
    return null
  }, [safe, pinnedFile, entries])

  const availableFiles = useMemo(() => {
    if (!timeline) return []
    const s = new Set<string>()
    for (const c of timeline.changes) {
      if (c.blockIndex <= (entry?.idx ?? 0)) s.add(c.path)
    }
    return [...s].sort()
  }, [timeline, entry])

  const currentChange = useMemo((): FileChange | null => {
    if (!entry || !derivedFile || !timeline) return null
    if (entry.fileChange && entry.filePath === derivedFile) return entry.fileChange
    for (let i = timeline.changes.length - 1; i >= 0; i--) {
      const c = timeline.changes[i]!
      if (c.path === derivedFile && c.blockIndex <= entry.idx && c.kind !== 'read') return c
    }
    return null
  }, [entry, derivedFile, timeline])

  const [thinkDismissed, setThinkDismissed] = useState(-1)
  const [prevSafeForThink, setPrevSafeForThink] = useState(safe)
  if (safe !== prevSafeForThink) {
    setPrevSafeForThink(safe)
    setThinkDismissed(-1)
  }
  const thinkingText = useMemo((): string | null => {
    if (!entry) return null
    if (entry.kind === 'thinking' || entry.kind === 'text') {
      return (entry.block as Extract<Block, { kind: 'text' | 'thinking' }>).content
    }
    if (safe > 0) {
      const prev = entries[safe - 1]!
      if (prev.kind === 'thinking') {
        return (prev.block as Extract<Block, { kind: 'thinking' }>).content
      }
    }
    return null
  }, [entry, entries, safe])
  const showThinking = thinkingText != null && thinkDismissed !== safe && currentChange != null

  const lastBash = useMemo(() => {
    for (let i = safe; i >= 0; i--) {
      if (entries[i]?.kind === 'bash') return entries[i]!
    }
    return null
  }, [entries, safe])
  const [termOpen, setTermOpen] = useState(false)
  const [prevSafeForTerm, setPrevSafeForTerm] = useState(safe)
  if (safe !== prevSafeForTerm) {
    setPrevSafeForTerm(safe)
    if (entry?.kind === 'bash') setTermOpen(true)
  }

  const go = useCallback(
    (n: number) => setStep(Math.max(0, Math.min(entries.length - 1, n))),
    [entries.length],
  )
  const goUp = useCallback(() => go(safe - 1), [go, safe])
  const goDown = useCallback(() => go(safe + 1), [go, safe])
  const goFileUp = useCallback(() => {
    for (let i = safe - 1; i >= 0; i--) {
      if (entries[i]!.kind === 'write' || entries[i]!.kind === 'edit') {
        go(i)
        return
      }
    }
  }, [safe, entries, go])
  const goFileDown = useCallback(() => {
    for (let i = safe + 1; i < entries.length; i++) {
      if (entries[i]!.kind === 'write' || entries[i]!.kind === 'edit') {
        go(i)
        return
      }
    }
  }, [safe, entries, go])

  const kbdRef = useRef({ goUp, goDown, goFileUp, goFileDown, showThinking, safe })
  kbdRef.current = { goUp, goDown, goFileUp, goFileDown, showThinking, safe }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const k = kbdRef.current
      if (e.key === 'ArrowLeft' || e.key === 'k') {
        e.preventDefault()
        e.shiftKey ? k.goFileUp() : k.goUp()
      }
      if (e.key === 'ArrowRight' || e.key === 'j') {
        e.preventDefault()
        e.shiftKey ? k.goFileDown() : k.goDown()
      }
      if (e.key === 't') {
        e.preventDefault()
        setTermOpen((t) => !t)
      }
      if (e.key === 'Escape' && k.showThinking) setThinkDismissed(k.safe)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (parsed.kind === 'too-large')
    return (
      <div
        className="font-mono"
        style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-soft)' }}
      >
        trace too large for replay ({(parsed.bytes / (1024 * 1024)).toFixed(1)} MB)
      </div>
    )
  if (parsed.kind === 'not-stream')
    return (
      <div
        className="font-mono"
        style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-soft)' }}
      >
        not a stream-json session
      </div>
    )
  if (!entries.length)
    return (
      <div
        className="font-mono"
        style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-soft)' }}
      >
        no events found
      </div>
    )

  const navBtnStyle: React.CSSProperties = {
    height: '1.75rem',
    padding: '0 0.5rem',
    display: 'flex',
    alignItems: 'center',
    color: 'var(--ink-soft)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '75vh',
        minHeight: '420px',
        border: '1px solid var(--rule)',
        borderRadius: '8px',
        overflow: 'hidden',
        background: 'var(--paper)',
      }}
    >
      {/* top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid var(--rule)',
          background: 'var(--paper-deep)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            border: '1px solid var(--rule)',
            borderRadius: '6px',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={goFileUp}
            title="Prev file change (Shift ←)"
            style={navBtnStyle}
          >
            <ChevronsLeft size={14} />
          </button>
          <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--rule)' }} />
          <button type="button" onClick={goUp} title="Prev step (← / k)" style={navBtnStyle}>
            <ChevronLeft size={14} />
          </button>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Scrubber entries={entries} step={safe} onStep={go} />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            border: '1px solid var(--rule)',
            borderRadius: '6px',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <button type="button" onClick={goDown} title="Next step (→ / j)" style={navBtnStyle}>
            <ChevronRight size={14} />
          </button>
          <div style={{ width: '1px', alignSelf: 'stretch', background: 'var(--rule)' }} />
          <button
            type="button"
            onClick={goFileDown}
            title="Next file change (Shift →)"
            style={navBtnStyle}
          >
            <ChevronsRight size={14} />
          </button>
        </div>
        <span
          className="font-mono"
          style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-soft)', flexShrink: 0 }}
        >
          {safe + 1}/{entries.length}
        </span>
      </div>

      {/* main body */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <FileSidebar
          files={availableFiles}
          activeFile={derivedFile}
          touchedFile={entry?.filePath ?? null}
          touchKind={
            entry?.kind === 'write' || entry?.kind === 'edit' || entry?.kind === 'read'
              ? entry.kind
              : null
          }
          onSelect={(f) => setPinnedFile(f === pinnedFile ? null : f)}
        />
        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'auto' }}>
          {mounted ? (
            <CenterContent change={currentChange} entry={entry!} />
          ) : (
            <div style={{ height: '100%', background: 'var(--paper-deep)' }} />
          )}
          {showThinking && mounted && (
            <ThinkingOverlay text={thinkingText!} onClose={() => setThinkDismissed(safe)} />
          )}
        </div>
      </div>

      {/* terminal panel */}
      <TermPanel entry={lastBash} isOpen={termOpen} onToggle={() => setTermOpen((t) => !t)} />
    </div>
  )
}
