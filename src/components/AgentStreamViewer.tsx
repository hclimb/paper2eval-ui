import { memo, useMemo, useState } from 'react'
import { CodeBlock } from '#/components/CodeBlock'
import {
  BASH,
  type Block,
  EDIT,
  parseAgentTrace,
  READ,
  TODO_WRITE,
  TOOL_SEARCH,
  type TokenUsage,
  type ToolResult,
  toolFilePath,
  toolIcon,
  WRITE,
} from '#/lib/agent-trace'
import { fmtCost, fmtMs, fmtTokens } from '#/lib/formatters'

interface ToolDisplay {
  label: string
  code?: string
  lang?: string
  filename?: string
}

interface ResultDisplay {
  isError: boolean
  badge: string | null
  content: string | null
}

function resultDisplay(r: ToolResult): ResultDisplay {
  switch (r.kind) {
    case 'bash': {
      const out = [r.data.stdout, r.data.stderr].filter(Boolean).join('\n').trim()
      const isError = r.data.isError || r.data.interrupted
      return {
        isError,
        badge: r.data.interrupted ? 'interrupted' : isError ? 'failed' : null,
        content: out || null,
      }
    }
    case 'read':
      return { isError: r.data.isError, badge: null, content: r.data.content || null }
    case 'write':
      return { isError: false, badge: r.data.type, content: null }
    case 'edit':
      return { isError: false, badge: r.data.replaceAll ? 'replace-all' : null, content: null }
    case 'todo': {
      const lines = r.data.newTodos.map((t) => {
        const mark = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '►' : '·'
        return `${mark} ${t.content}`
      })
      return { isError: false, badge: `${r.data.newTodos.length} todos`, content: lines.join('\n') }
    }
    case 'generic':
      return { isError: r.data.isError, badge: null, content: r.data.content || null }
  }
}

function toolDisplay(name: string, args: Record<string, unknown>): ToolDisplay {
  const fp = toolFilePath(args)

  switch (name) {
    case BASH:
      return { label: '', code: String(args.command ?? ''), lang: 'bash' }
    case READ:
      return { label: fp }
    case WRITE: {
      const content = typeof args.content === 'string' ? args.content : undefined
      return { label: fp, code: content, filename: fp }
    }
    case EDIT: {
      const oldStr = args.old_string
      const newStr = args.new_string
      if (typeof oldStr === 'string' && typeof newStr === 'string') {
        const lines: string[] = []
        for (const l of oldStr.split('\n')) lines.push(`- ${l}`)
        for (const l of newStr.split('\n')) lines.push(`+ ${l}`)
        return { label: fp, code: lines.join('\n'), lang: 'diff' }
      }
      return { label: fp }
    }
    case TODO_WRITE:
      return { label: 'todo update' }
    case TOOL_SEARCH:
      return { label: String(args.query ?? '') }
    default:
      return { label: '' }
  }
}

// --- sub-components (cream/ink/oxblood palette) ---

const S = {
  eyebrow: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--fs-xs)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    fontWeight: 600,
  },
  mono11: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--fs-sm)',
  },
  mono10: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--fs-xs)',
  },
} as const

// Hoisted merged styles — avoids allocating new objects per render in hot paths
const HS = {
  /** Expandable collapse/expand button */
  expandableBtn: {
    ...S.mono10,
    marginTop: '0.25rem',
    color: 'var(--ink-soft)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  /** UsagePill span */
  usagePill: { ...S.mono10, color: 'var(--ink-soft)', opacity: 0.7 },
  /** Eyebrow label at xs size, soft ink — ToolBlock "output" + RawBlock "raw output" */
  eyebrowSoft: { ...S.eyebrow, fontSize: 'var(--fs-xs)', color: 'var(--ink-soft)' },
  /** ThinkingBlock eyebrow */
  eyebrowThinking: { ...S.eyebrow, fontSize: 'var(--fs-xs)', color: '#7c3aed' },
  /** ToolBlock tool name */
  toolName: { ...S.mono11, fontWeight: 600, color: '#b45309' } as const,
  /** ToolBlock label (file path / search pattern) */
  toolLabel: {
    ...S.mono11,
    color: 'var(--ink-soft)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '60ch',
  } as const,
  /** ToolBlock / RawBlock "(no output)" */
  noOutput: { ...S.mono11, color: 'var(--ink-soft)', fontStyle: 'italic' } as const,
} as const

function Expandable({
  content,
  maxLines = 8,
  defaultOpen = true,
}: {
  content: string
  maxLines?: number
  defaultOpen?: boolean
}) {
  const lines = useMemo(() => content.split('\n'), [content])
  const collapsible = lines.length > maxLines + 3
  const [open, setOpen] = useState(defaultOpen || !collapsible)

  const displayed = open ? content : `${lines.slice(0, maxLines).join('\n')}`
  const remaining = lines.length - maxLines

  return (
    <div>
      <pre
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-sm)',
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
          background: 'transparent',
          border: 0,
          padding: 0,
        }}
      >
        {displayed}
      </pre>
      {collapsible && (
        <button type="button" onClick={() => setOpen((o) => !o)} style={HS.expandableBtn}>
          {open ? '▾ collapse' : `▸ +${remaining} more lines`}
        </button>
      )}
    </div>
  )
}

function UsagePill({ usage }: { usage: TokenUsage }) {
  const parts: string[] = []
  if (usage.input) parts.push(`${fmtTokens(usage.input)} in`)
  if (usage.output) parts.push(`${fmtTokens(usage.output)} out`)
  if (usage.cacheRead) parts.push(`${fmtTokens(usage.cacheRead)} cached`)
  if (parts.length === 0) return null
  return <span style={HS.usagePill}>{parts.join(' · ')}</span>
}

function SystemBlock({ block }: { block: Extract<Block, { kind: 'system' }> }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.75rem 1rem',
        borderRadius: '4px',
        background: 'var(--paper-deep)',
        ...S.mono11,
        color: 'var(--ink-soft)',
      }}
    >
      <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{block.model}</span>
      {block.cwd && (
        <>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{block.cwd}</span>
        </>
      )}
      {block.tools.length > 0 && (
        <>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>
            {block.tools.length} tool{block.tools.length !== 1 ? 's' : ''}
          </span>
        </>
      )}
    </div>
  )
}

function ThinkingBlock({ block }: { block: Extract<Block, { kind: 'thinking' }> }) {
  return (
    <div
      style={{
        borderLeft: '2px solid #8b5cf6',
        background: 'color-mix(in oklab, var(--paper-deep) 80%, #8b5cf620)',
        borderRadius: '0 4px 4px 0',
      }}
    >
      <div
        style={{
          padding: '0.75rem 1rem 0.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
        }}
      >
        <span style={{ fontSize: 'var(--fs-sm)' }}>🧠</span>
        <span style={HS.eyebrowThinking}>Thinking</span>
      </div>
      <div style={{ padding: '0 1rem 0.75rem' }}>
        <Expandable content={block.content} maxLines={4} defaultOpen={false} />
      </div>
    </div>
  )
}

function TextBlock({ block }: { block: Extract<Block, { kind: 'text' }> }) {
  return (
    <div style={{ borderLeft: '2px solid var(--accent)', borderRadius: '0 4px 4px 0' }}>
      <div style={{ padding: '0.75rem 1rem' }}>
        <div style={{ color: 'var(--ink)' }}>
          <Expandable content={block.content} maxLines={20} defaultOpen={true} />
        </div>
        {block.usage && (
          <div style={{ marginTop: '0.35rem', display: 'flex', justifyContent: 'flex-end' }}>
            <UsagePill usage={block.usage} />
          </div>
        )}
      </div>
    </div>
  )
}

function ToolBlock({ block }: { block: Extract<Block, { kind: 'tool' }> }) {
  const display = toolDisplay(block.toolName, block.args)
  const icon = toolIcon(block.toolName)
  const isBash = block.toolName === BASH
  const isRead = block.toolName === READ
  const isWrite = block.toolName === WRITE || block.toolName === EDIT

  const resultFilename = isRead || isWrite ? toolFilePath(block.args) || undefined : undefined

  const hasSpecialDisplay = isBash || display.label || display.code
  const genericArgs =
    !hasSpecialDisplay && Object.keys(block.args).length > 0
      ? JSON.stringify(block.args, null, 2)
      : null

  return (
    <div
      style={{
        borderLeft: '2px solid #d97706',
        borderRadius: '0 4px 4px 0',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '0.75rem 1rem 0.35rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 'var(--fs-sm)', lineHeight: 1 }}>{icon}</span>
        <span style={HS.toolName}>{block.toolName}</span>
        {display.label && <span style={HS.toolLabel}>{display.label}</span>}
        {block.usage && (
          <span style={{ marginLeft: 'auto' }}>
            <UsagePill usage={block.usage} />
          </span>
        )}
      </div>

      {isBash && display.code && (
        <div style={{ margin: '0 1rem 0.75rem', borderRadius: '4px', overflow: 'hidden' }}>
          <div
            style={{
              background: 'var(--paper-deep)',
              padding: '0.75rem 1rem',
              border: '1px solid var(--rule)',
              borderRadius: '4px',
            }}
          >
            <pre
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-base)',
                lineHeight: 1.7,
                color: 'var(--ink)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
                background: 'transparent',
                border: 0,
                padding: 0,
              }}
            >
              <span style={{ color: 'var(--accent)', userSelect: 'none', fontWeight: 600 }}>
                ${' '}
              </span>
              {display.code}
            </pre>
          </div>
        </div>
      )}

      {!isBash && display.code && (
        <div style={{ margin: '0 1rem 0.75rem', borderRadius: '4px', overflow: 'hidden' }}>
          <CodeBlock
            content={display.code}
            maxHeight={300}
            lang={display.lang}
            filename={display.filename}
          />
        </div>
      )}

      {genericArgs && (
        <div style={{ margin: '0 1rem 0.75rem', borderRadius: '4px', overflow: 'hidden' }}>
          <CodeBlock content={genericArgs} maxHeight={200} lang="json" />
        </div>
      )}

      {block.result &&
        (() => {
          const { isError, badge, content } = resultDisplay(block.result)
          return (
            <div
              style={{
                borderTop: `1px solid ${isError ? '#fca5a5' : 'var(--rule)'}`,
                background: isError ? '#fee2e220' : 'var(--paper-deep)',
              }}
            >
              <div
                style={{
                  padding: '0.5rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}
              >
                <span style={HS.eyebrowSoft}>output</span>
                {badge && (
                  <span
                    style={{
                      ...S.mono10,
                      padding: '0 0.4rem',
                      borderRadius: '2px',
                      background: isError ? '#a53030' : 'transparent',
                      color: isError ? 'var(--paper)' : 'var(--ink-soft)',
                      border: `1px solid ${isError ? '#a53030' : 'var(--rule)'}`,
                    }}
                  >
                    {badge}
                  </span>
                )}
              </div>
              {content && (
                <div style={{ overflow: 'hidden' }}>
                  {isRead && resultFilename ? (
                    <CodeBlock content={content} maxHeight={400} filename={resultFilename} />
                  ) : (
                    <div style={{ background: 'var(--paper-deep)' }}>
                      <div style={{ padding: '0.75rem 1rem', color: 'var(--ink)' }}>
                        <Expandable
                          content={content}
                          maxLines={15}
                          defaultOpen={content.length < 2000}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!content && (
                <div style={{ padding: '0 1rem 0.75rem' }}>
                  <span style={HS.noOutput}>(no output)</span>
                </div>
              )}
            </div>
          )
        })()}
    </div>
  )
}

function ResultBlock({ block }: { block: Extract<Block, { kind: 'result' }> }) {
  const parts: string[] = []
  if (block.numTurns != null) parts.push(`${block.numTurns} turn${block.numTurns !== 1 ? 's' : ''}`)
  if (block.totalCostUsd != null) parts.push(fmtCost(block.totalCostUsd))
  if (block.durationMs != null) {
    let dur = fmtMs(block.durationMs)
    if (block.durationApiMs != null) dur += ` (api: ${fmtMs(block.durationApiMs)})`
    parts.push(dur)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.75rem 1rem',
        borderRadius: '4px',
        fontSize: 'var(--fs-sm)',
        fontWeight: 500,
        border: `1px solid ${block.isError ? '#fca5a5' : '#86efac'}`,
        background: block.isError ? '#fee2e2' : '#dcfce7',
        color: block.isError ? '#991b1b' : '#065f46',
      }}
    >
      <span>{block.isError ? '✗ Failed' : '✓ Completed'}</span>
      {parts.length > 0 && (
        <>
          <span style={{ opacity: 0.4 }}>·</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{parts.join(' · ')}</span>
        </>
      )}
    </div>
  )
}

function NoteBlock({ block }: { block: Extract<Block, { kind: 'note' }> }) {
  const label = block.source.replace(/-/g, ' ')
  return (
    <div
      style={{
        borderLeft: '2px solid var(--ink-soft)',
        background: 'var(--paper-deep)',
        borderRadius: '0 4px 4px 0',
        padding: '0.75rem 1rem',
      }}
    >
      <div style={{ ...HS.eyebrowSoft, marginBottom: '0.4rem' }}>{label}</div>
      <Expandable content={block.content} maxLines={6} defaultOpen={block.content.length < 400} />
    </div>
  )
}

function CompactBoundaryBlock({ block }: { block: Extract<Block, { kind: 'compact_boundary' }> }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.5rem 1rem',
        background: 'var(--paper-deep)',
        border: '1px dashed var(--rule)',
        borderRadius: '4px',
        ...S.mono10,
        color: 'var(--ink-soft)',
      }}
    >
      <span>↯ context compacted ({block.trigger})</span>
      <span>
        {block.preTokens.toLocaleString()} → {block.postTokens.toLocaleString()} tokens in{' '}
        {fmtMs(block.durationMs)}
      </span>
    </div>
  )
}

function TaskEventBlock({ block }: { block: Extract<Block, { kind: 'task_event' }> }) {
  const detail =
    block.subtype === 'started'
      ? block.description
      : block.subtype === 'notification'
        ? (block.summary ?? block.status)
        : block.status
  return (
    <div
      style={{
        ...S.mono10,
        color: 'var(--ink-soft)',
        padding: '0.25rem 0.75rem',
        borderLeft: '2px solid #6366f1',
        background: 'color-mix(in oklab, var(--paper-deep) 80%, #6366f110)',
      }}
    >
      <span style={{ ...S.eyebrow, color: '#6366f1', marginRight: '0.5rem' }}>
        bg-task / {block.subtype}
      </span>
      {detail && <span>{detail}</span>}
    </div>
  )
}

function RedactedThinkingBlock() {
  return (
    <div
      style={{
        ...S.mono10,
        color: 'var(--ink-soft)',
        padding: '0.5rem 0.75rem',
        borderLeft: '2px solid #8b5cf680',
        fontStyle: 'italic',
      }}
    >
      🧠 thinking redacted (signed)
    </div>
  )
}

function ApiRetryBlock({ block }: { block: Extract<Block, { kind: 'api_retry' }> }) {
  return (
    <div
      style={{
        ...S.mono10,
        color: 'var(--ink-soft)',
        padding: '0.25rem 0.75rem',
        borderLeft: '2px solid #d97706',
        background: 'color-mix(in oklab, var(--paper-deep) 80%, #d9770610)',
      }}
    >
      <span style={{ ...S.eyebrow, color: '#d97706', marginRight: '0.5rem' }}>
        api retry · attempt {block.attempt}/{block.maxRetries}
      </span>
      <span>
        delay {Math.round(block.retryDelayMs)}ms
        {block.errorStatus && ` · ${block.errorStatus}`}
        {block.error !== 'unknown' && ` · ${block.error}`}
      </span>
    </div>
  )
}

function BlockRenderer({ block }: { block: Block }) {
  switch (block.kind) {
    case 'system':
      return <SystemBlock block={block} />
    case 'thinking':
      return <ThinkingBlock block={block} />
    case 'redacted_thinking':
      return <RedactedThinkingBlock />
    case 'text':
      return <TextBlock block={block} />
    case 'tool':
      return <ToolBlock block={block} />
    case 'result':
      return <ResultBlock block={block} />
    case 'note':
      return <NoteBlock block={block} />
    case 'compact_boundary':
      return <CompactBoundaryBlock block={block} />
    case 'task_event':
      return <TaskEventBlock block={block} />
    case 'api_retry':
      return <ApiRetryBlock block={block} />
  }
}

const MemoBlockRenderer = memo(BlockRenderer)

function hashText(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function blockKey(block: Block): string {
  switch (block.kind) {
    case 'tool':
      return `tool-${block.callId}`
    case 'system':
      return `system-${block.sessionId ?? block.model}-${block.cwd}`
    case 'thinking':
      return `thinking-${hashText(block.content)}`
    case 'redacted_thinking':
      return `redacted-${block.signature}`
    case 'text':
      return `text-${hashText(block.content)}`
    case 'result':
      return `result-${block.isError}-${block.numTurns ?? ''}-${block.durationMs ?? ''}`
    case 'note':
      return `note-${block.source}-${hashText(block.content)}`
    case 'compact_boundary':
      return `compact-${block.preTokens}-${block.postTokens}-${block.durationMs}`
    case 'task_event':
      return `task-${block.subtype}-${block.taskId}-${block.toolUseId ?? ''}`
    case 'api_retry':
      return `retry-${block.attempt}-${block.retryDelayMs}-${hashText(block.error)}`
  }
}

export function AgentStreamViewer({ content }: { content: string }) {
  const result = useMemo(() => parseAgentTrace(content), [content])

  if (!result.ok) {
    return <CodeBlock content={content} maxHeight={800} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {result.blocks.map((block) => (
        <MemoBlockRenderer key={blockKey(block)} block={block} />
      ))}
    </div>
  )
}
