import { memo, useMemo, useState } from 'react'
import { CodeBlock } from '#/components/CodeBlock'
import { fmtCost, fmtMs, fmtTokens } from '#/lib/formatters'
import {
  BASH_NAMES,
  EDIT_NAMES,
  FS_NAMES,
  READ_NAMES,
  SEARCH_NAMES,
  stripAnsi,
  TASK_NAMES,
  toolFilePath,
  toolIcon,
  WRITE_NAMES,
} from '#/lib/tool-names'

interface TokenUsage {
  input: number
  output: number
  cacheRead?: number
  cacheCreation?: number
}

interface ToolResult {
  content: string
  isError: boolean
  exitCode?: number
}

type Block =
  | { kind: 'system'; model: string; cwd: string; tools: string[] }
  | { kind: 'thinking'; content: string }
  | { kind: 'text'; content: string; model?: string; usage?: TokenUsage }
  | {
      kind: 'tool'
      toolName: string
      callId: string
      args: Record<string, unknown>
      result?: ToolResult
      usage?: TokenUsage
    }
  | {
      kind: 'result'
      numTurns?: number
      costUsd?: number
      durationMs?: number
      durationApiMs?: number
      isError: boolean
      text?: string
    }
  | { kind: 'raw'; content: string }

interface ToolDisplay {
  label: string
  code?: string
  lang?: string
  filename?: string
}

function toolDisplay(name: string, args: Record<string, unknown>): ToolDisplay {
  const n = name.toLowerCase()
  const fp = toolFilePath(args)

  if (BASH_NAMES.has(n)) {
    return { label: '', code: String(args.command ?? args.cmd ?? ''), lang: 'bash' }
  }
  if (READ_NAMES.has(n)) return { label: fp }
  if (WRITE_NAMES.has(n)) {
    const content = args.content != null ? String(args.content) : undefined
    return { label: fp, code: content, filename: fp }
  }
  if (EDIT_NAMES.has(n)) {
    const oldStr = args.old_string ?? args.old_str
    const newStr = args.new_string ?? args.new_str
    if (oldStr != null && newStr != null) {
      const lines: string[] = []
      for (const l of String(oldStr).split('\n')) lines.push(`- ${l}`)
      for (const l of String(newStr).split('\n')) lines.push(`+ ${l}`)
      return { label: fp, code: lines.join('\n'), lang: 'diff' }
    }
    return { label: fp }
  }
  if (SEARCH_NAMES.has(n)) {
    const pattern = String(args.pattern ?? args.regex ?? args.query ?? '')
    const dir = args.path ?? args.directory ?? ''
    return { label: `/${pattern}/${dir ? ` in ${dir}` : ''}` }
  }
  if (FS_NAMES.has(n)) {
    return { label: String(args.pattern ?? args.glob ?? args.path ?? '.') }
  }
  if (TASK_NAMES.has(n)) {
    const desc = String(args.description ?? args.prompt ?? args.task ?? '')
    return { label: desc.length > 120 ? `${desc.slice(0, 120)}…` : desc }
  }
  return { label: '' }
}

const MAX_PARSE_BYTES = 5 * 1024 * 1024

function parseStreamJson(raw: string): Block[] | null {
  if (raw.length > MAX_PARSE_BYTES) return null

  const lines = raw.split('\n')
  let jsonHits = 0
  let nonEmpty = 0
  // biome-ignore lint/suspicious/noExplicitAny: raw json events
  const events: any[] = []
  const rawLines: string[] = []

  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    nonEmpty++
    try {
      const obj = JSON.parse(t)
      if (obj && typeof obj === 'object' && 'type' in obj) {
        events.push(obj)
        jsonHits++
        continue
      }
    } catch {
      /* not json */
    }
    rawLines.push(t)
  }

  if (jsonHits < 2 || (nonEmpty > 0 && jsonHits / nonEmpty < 0.25)) return null
  return flattenEvents(events, rawLines)
}

// biome-ignore lint/suspicious/noExplicitAny: loose event shapes from jsonl
function flattenEvents(events: any[], rawLines: string[]): Block[] {
  const blocks: Block[] = []
  const pendingTools = new Map<string, number>()

  for (const ev of events) {
    if (ev.type === 'system' && ev.subtype === 'init') {
      blocks.push({
        kind: 'system',
        model: ev.model ?? 'unknown',
        cwd: ev.cwd ?? '',
        tools: Array.isArray(ev.tools)
          ? ev.tools.map((t: { name?: string }) => (typeof t === 'string' ? t : (t.name ?? '?')))
          : [],
      })
      continue
    }

    if (ev.type === 'result') {
      blocks.push({
        kind: 'result',
        numTurns: ev.num_turns,
        costUsd: ev.cost_usd,
        durationMs: ev.duration_ms,
        durationApiMs: ev.duration_api_ms,
        isError: !!ev.is_error,
        text: typeof ev.result === 'string' ? ev.result : undefined,
      })
      continue
    }

    const msg = ev.message
    if (!msg) continue
    const content = msg.content

    if (ev.type === 'assistant' && Array.isArray(content)) {
      const usage: TokenUsage | undefined = msg.usage
        ? {
            input: msg.usage.input_tokens ?? 0,
            output: msg.usage.output_tokens ?? 0,
            cacheRead: msg.usage.cache_read_input_tokens,
            cacheCreation: msg.usage.cache_creation_input_tokens,
          }
        : undefined

      let usageAttached = false

      for (const blk of content) {
        if (blk.type === 'thinking' || blk.type === 'reasoning' || blk.type === 'analysis') {
          const text = blk.thinking ?? blk.text ?? ''
          if (text.trim()) blocks.push({ kind: 'thinking', content: text })
          continue
        }

        if (blk.type === 'text' && blk.text?.trim()) {
          blocks.push({
            kind: 'text',
            content: blk.text,
            model: msg.model,
            usage: !usageAttached ? usage : undefined,
          })
          usageAttached = true
          continue
        }

        if (blk.type === 'tool_use') {
          const idx = blocks.length
          blocks.push({
            kind: 'tool',
            toolName: blk.name ?? 'unknown',
            callId: blk.id ?? '',
            args: blk.input ?? {},
            usage: !usageAttached ? usage : undefined,
          })
          usageAttached = true
          if (blk.id) pendingTools.set(blk.id, idx)
        }
      }
      continue
    }

    if (ev.type === 'user' && Array.isArray(content)) {
      for (const blk of content) {
        if (blk.type !== 'tool_result') continue
        const callId: string = blk.tool_use_id ?? ''

        let resultContent = ''
        if (typeof blk.content === 'string') {
          resultContent = blk.content
        } else if (Array.isArray(blk.content)) {
          resultContent = blk.content
            .map((c: { text?: string }) =>
              typeof c === 'string' ? c : (c.text ?? JSON.stringify(c)),
            )
            .join('\n')
        }

        const tur = ev.toolUseResult ?? ev.tool_use_result
        let exitCode: number | undefined
        if (tur && typeof tur === 'object') {
          if (tur.stdout && !resultContent) resultContent = tur.stdout
          if (tur.stderr) resultContent += `${resultContent ? '\n' : ''}${tur.stderr}`
          exitCode = tur.exitCode ?? tur.exit_code
        }

        const result: ToolResult = {
          content: stripAnsi(resultContent),
          isError: !!blk.is_error,
          exitCode,
        }

        const toolIdx = callId ? pendingTools.get(callId) : undefined
        if (toolIdx !== undefined) {
          ;(blocks[toolIdx] as { result?: ToolResult }).result = result
          pendingTools.delete(callId)
        } else {
          blocks.push({ kind: 'tool', toolName: 'result', callId, args: {}, result })
        }
      }
    }
  }

  if (rawLines.length > 0) {
    blocks.push({ kind: 'raw', content: rawLines.join('\n') })
  }

  return blocks
}

export function isStreamJson(raw: string): boolean {
  const lines = raw.split('\n', 20)
  let hits = 0
  let checked = 0
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    checked++
    try {
      const obj = JSON.parse(t)
      if (obj && typeof obj === 'object' && 'type' in obj) hits++
    } catch {
      /* skip */
    }
  }
  return checked > 0 && hits / checked > 0.4
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

function ExitBadge({ code }: { code: number | undefined }) {
  if (code === undefined) return null
  const ok = code === 0
  return (
    <span
      style={{
        ...S.mono10,
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.1rem 0.4rem',
        borderRadius: '3px',
        fontWeight: 500,
        background: ok ? '#d1fae5' : '#fee2e2',
        color: ok ? '#065f46' : '#991b1b',
      }}
    >
      {ok ? '✓' : '✗'} {code}
    </span>
  )
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
  const isBash = BASH_NAMES.has(block.toolName.toLowerCase())
  const isRead = READ_NAMES.has(block.toolName.toLowerCase())
  const isWrite =
    WRITE_NAMES.has(block.toolName.toLowerCase()) || EDIT_NAMES.has(block.toolName.toLowerCase())

  const resultFilename =
    isRead || isWrite
      ? String(block.args.file_path ?? block.args.path ?? block.args.filename ?? '')
      : undefined

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

      {block.result && (
        <div
          style={{
            borderTop: `1px solid ${block.result.isError ? '#fca5a5' : 'var(--rule)'}`,
            background: block.result.isError ? '#fee2e220' : 'var(--paper-deep)',
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
            <ExitBadge code={block.result.exitCode} />
          </div>
          {block.result.content && (
            <div style={{ overflow: 'hidden' }}>
              {isRead && resultFilename ? (
                <CodeBlock
                  content={block.result.content}
                  maxHeight={400}
                  filename={resultFilename}
                />
              ) : (
                <div style={{ background: 'var(--paper-deep)' }}>
                  <div style={{ padding: '0.75rem 1rem', color: 'var(--ink)' }}>
                    <Expandable
                      content={block.result.content}
                      maxLines={15}
                      defaultOpen={block.result.content.length < 2000}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          {!block.result.content && (
            <div style={{ padding: '0 1rem 0.75rem' }}>
              <span style={HS.noOutput}>(no output)</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultBlock({ block }: { block: Extract<Block, { kind: 'result' }> }) {
  const parts: string[] = []
  if (block.numTurns != null) parts.push(`${block.numTurns} turn${block.numTurns !== 1 ? 's' : ''}`)
  if (block.costUsd != null) parts.push(fmtCost(block.costUsd))
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

function RawBlock({ block }: { block: Extract<Block, { kind: 'raw' }> }) {
  return (
    <div style={{ borderRadius: '4px', overflow: 'hidden' }}>
      <div style={{ padding: '0.25rem 0.75rem' }}>
        <span style={HS.eyebrowSoft}>raw output</span>
      </div>
      <CodeBlock content={block.content} maxHeight={300} />
    </div>
  )
}

function BlockRenderer({ block }: { block: Block }) {
  switch (block.kind) {
    case 'system':
      return <SystemBlock block={block} />
    case 'thinking':
      return <ThinkingBlock block={block} />
    case 'text':
      return <TextBlock block={block} />
    case 'tool':
      return <ToolBlock block={block} />
    case 'result':
      return <ResultBlock block={block} />
    case 'raw':
      return <RawBlock block={block} />
  }
}

const MemoBlockRenderer = memo(BlockRenderer)

export function AgentStreamViewer({ content }: { content: string }) {
  const blocks = useMemo(() => parseStreamJson(content), [content])

  if (!blocks) {
    return <CodeBlock content={content} maxHeight={800} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {blocks.map((block, i) => (
        <MemoBlockRenderer key={`${block.kind}-${i}`} block={block} />
      ))}
    </div>
  )
}
