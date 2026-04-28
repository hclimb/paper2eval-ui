import type {
  BashResult,
  Block,
  FileEditResult,
  FileWriteResult,
  ReadResult,
  TodoItem,
  TodoWriteResult,
  TokenUsage,
  ToolResult,
  TraceMeta,
} from './blocks'
import { stripAnsi } from './tool-names'

export const MAX_PARSE_BYTES = 5 * 1024 * 1024

export type ParseResult =
  | { ok: true; blocks: Block[]; meta: TraceMeta }
  | { ok: false; reason: 'too-large'; bytes: number }
  | { ok: false; reason: 'not-stream' }

const RESUMING_RE = /^RESUMING session [\w-]+/
const FOUND_SESSION_RE = /found session [\w-]+\s*\((\d+)\s*messages?\)/

// biome-ignore lint/suspicious/noExplicitAny: jsonl events have loose shape
type Json = any

export function parseAgentTrace(raw: string): ParseResult {
  if (raw.length > MAX_PARSE_BYTES) return { ok: false, reason: 'too-large', bytes: raw.length }

  const events: Json[] = []
  const wrapperLog: string[] = []
  let isResumed = false
  let resumedFromMessages: number | undefined

  let nonEmpty = 0
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    nonEmpty++
    if (t.startsWith('[wrapper]')) {
      const stripped = t.replace(/^\[wrapper\]\s*/, '')
      wrapperLog.push(stripped)
      if (RESUMING_RE.test(stripped)) isResumed = true
      const m = FOUND_SESSION_RE.exec(stripped)
      if (m) resumedFromMessages = Number(m[1])
      continue
    }
    if (t[0] !== '{') continue // non-JSON noise that isn't wrapper-prefixed
    try {
      const obj = JSON.parse(t)
      if (obj && typeof obj === 'object' && 'type' in obj) events.push(obj)
    } catch {
      /* malformed line — silently skip */
    }
  }

  if (events.length < 2 || (nonEmpty > 0 && events.length / nonEmpty < 0.25)) {
    return { ok: false, reason: 'not-stream' }
  }

  const blocks: Block[] = []
  const pendingTools = new Map<string, number>()
  let sessionId: string | undefined

  for (const ev of events) {
    switch (ev.type) {
      case 'system':
        handleSystem(ev, blocks)
        if (typeof ev.session_id === 'string' && !sessionId) sessionId = ev.session_id
        break
      case 'assistant':
        handleAssistant(ev, blocks, pendingTools)
        break
      case 'user':
        handleUser(ev, blocks, pendingTools)
        break
      case 'result':
        handleResult(ev, blocks)
        break
      // attachment / last-prompt / queue-operation / system/status are intentionally dropped
    }
  }

  return {
    ok: true,
    blocks,
    meta: { isResumed, resumedFromMessages, wrapperLog, sessionId },
  }
}

// ─── handlers ───────────────────────────────────────────────────────

function handleSystem(ev: Json, blocks: Block[]): void {
  switch (ev.subtype) {
    case 'init':
      blocks.push({
        kind: 'system',
        model: ev.model ?? 'unknown',
        cwd: ev.cwd ?? '',
        tools: Array.isArray(ev.tools)
          ? ev.tools.map((t: { name?: string } | string) =>
              typeof t === 'string' ? t : (t.name ?? '?'),
            )
          : [],
        sessionId: ev.session_id,
        permissionMode: ev.permissionMode,
      })
      return

    case 'compact_boundary':
      blocks.push({
        kind: 'compact_boundary',
        preTokens: ev.compactMetadata?.preTokens ?? 0,
        postTokens: ev.compactMetadata?.postTokens ?? 0,
        durationMs: ev.compactMetadata?.durationMs ?? 0,
        trigger: ev.compactMetadata?.trigger ?? 'unknown',
      })
      return

    case 'task_started':
      blocks.push({
        kind: 'task_event',
        subtype: 'started',
        taskId: ev.task_id,
        toolUseId: ev.tool_use_id,
        description: ev.description,
      })
      return

    case 'task_notification':
      blocks.push({
        kind: 'task_event',
        subtype: 'notification',
        taskId: ev.task_id,
        toolUseId: ev.tool_use_id,
        status: ev.status,
        summary: ev.summary,
      })
      return

    case 'task_updated':
      blocks.push({
        kind: 'task_event',
        subtype: 'updated',
        taskId: ev.task_id,
        status: ev.patch?.status,
      })
      return

    case 'api_retry':
      blocks.push({
        kind: 'api_retry',
        attempt: typeof ev.attempt === 'number' ? ev.attempt : 0,
        maxRetries: typeof ev.max_retries === 'number' ? ev.max_retries : 0,
        retryDelayMs: typeof ev.retry_delay_ms === 'number' ? ev.retry_delay_ms : 0,
        errorStatus: typeof ev.error_status === 'string' ? ev.error_status : null,
        error: typeof ev.error === 'string' ? ev.error : 'unknown',
      })
      return

    // 'status' is intentionally dropped — duplicate of compact_boundary's trigger info
  }
}

function handleAssistant(ev: Json, blocks: Block[], pendingTools: Map<string, number>): void {
  const msg = ev.message
  if (!msg || !Array.isArray(msg.content)) return

  const usage: TokenUsage | undefined = msg.usage
    ? {
        input: msg.usage.input_tokens ?? 0,
        output: msg.usage.output_tokens ?? 0,
        cacheRead: msg.usage.cache_read_input_tokens,
        cacheCreation: msg.usage.cache_creation_input_tokens,
      }
    : undefined

  let usageAttached = false

  for (const blk of msg.content) {
    if (blk.type === 'thinking') {
      const text = typeof blk.thinking === 'string' ? blk.thinking : ''
      if (text.trim()) {
        blocks.push({ kind: 'thinking', content: text })
      } else if (typeof blk.signature === 'string') {
        // anthropic sometimes returns a signed-but-redacted thinking block
        blocks.push({ kind: 'redacted_thinking', signature: blk.signature })
      }
      continue
    }

    if (blk.type === 'text' && typeof blk.text === 'string' && blk.text.trim()) {
      blocks.push({
        kind: 'text',
        content: blk.text,
        model: msg.model,
        usage: usageAttached ? undefined : usage,
      })
      usageAttached = true
      continue
    }

    if (blk.type === 'tool_use') {
      const idx = blocks.length
      const callId = typeof blk.id === 'string' ? blk.id : ''
      blocks.push({
        kind: 'tool',
        toolName: blk.name,
        callId,
        args: blk.input ?? {},
        usage: usageAttached ? undefined : usage,
      })
      usageAttached = true
      if (callId) pendingTools.set(callId, idx)
    }
  }
}

function handleUser(ev: Json, blocks: Block[], pendingTools: Map<string, number>): void {
  const msg = ev.message
  if (!msg) return

  // The two real envelope-casing variants found in the wild:
  //   math500 (claude-code 2.1.113) → ev.toolUseResult (camel)
  //   livecodebench (newer)         → ev.tool_use_result (snake)
  const tur = ev.tool_use_result ?? ev.toolUseResult

  // synthesized recovery / continuation messages can appear as either
  //   - msg.content === string                                    (math500 shape)
  //   - msg.content === [{type:'text', text:'…'}]                 (livecodebench shape)
  const synthesizedText = extractSynthesizedText(msg.content)
  if (synthesizedText) {
    blocks.push({ kind: 'note', content: synthesizedText, source: classifyNote(synthesizedText) })
    return
  }

  if (!Array.isArray(msg.content)) return

  for (const blk of msg.content) {
    if (blk.type !== 'tool_result') continue
    const callId: string = blk.tool_use_id ?? ''
    if (!callId) continue

    const toolIdx = pendingTools.get(callId)
    if (toolIdx === undefined) continue
    const target = blocks[toolIdx]
    if (target?.kind !== 'tool') continue

    const isError = blk.is_error === true
    target.result = buildToolResult(target.toolName, target.args, blk, tur, isError)
    pendingTools.delete(callId)
  }
}

function handleResult(ev: Json, blocks: Block[]): void {
  blocks.push({
    kind: 'result',
    numTurns: typeof ev.num_turns === 'number' ? ev.num_turns : undefined,
    totalCostUsd:
      typeof ev.total_cost_usd === 'number'
        ? ev.total_cost_usd
        : typeof ev.cost_usd === 'number'
          ? ev.cost_usd
          : undefined,
    durationMs: typeof ev.duration_ms === 'number' ? ev.duration_ms : undefined,
    durationApiMs: typeof ev.duration_api_ms === 'number' ? ev.duration_api_ms : undefined,
    isError: ev.is_error === true,
    text: typeof ev.result === 'string' ? ev.result : undefined,
    stopReason: typeof ev.stop_reason === 'string' ? ev.stop_reason : undefined,
    terminalReason: typeof ev.terminal_reason === 'string' ? ev.terminal_reason : undefined,
  })
}

// ─── result envelope construction (the gold-data path) ──────────────

function buildToolResult(
  toolName: string,
  args: Record<string, unknown>,
  blk: Json,
  tur: Json,
  isError: boolean,
): ToolResult {
  const name = toolName // claude-code emits canonical PascalCase names; we don't lowercase here

  if (name === 'Bash') {
    // claude-code emits two shapes for Bash result envelopes:
    //   object — the normal case with {stdout, stderr, interrupted, ...}
    //   string — fallback when the tool itself errored; the string is the error
    if (tur && typeof tur === 'object') {
      const data: BashResult = {
        stdout: stripAnsi(typeof tur.stdout === 'string' ? tur.stdout : ''),
        stderr: stripAnsi(typeof tur.stderr === 'string' ? tur.stderr : ''),
        interrupted: tur.interrupted === true,
        isError,
        backgroundTaskId:
          typeof tur.backgroundTaskId === 'string' ? tur.backgroundTaskId : undefined,
      }
      return { kind: 'bash', data }
    }
    if (typeof tur === 'string') {
      const data: BashResult = {
        stdout: '',
        stderr: stripAnsi(tur),
        interrupted: false,
        isError,
      }
      return { kind: 'bash', data }
    }
  }

  if (name === 'Write' && tur && typeof tur === 'object' && typeof tur.content === 'string') {
    const data: FileWriteResult = {
      filePath: typeof tur.filePath === 'string' ? tur.filePath : String(args.file_path ?? ''),
      originalFile: typeof tur.originalFile === 'string' ? tur.originalFile : '',
      newContent: tur.content,
      type: tur.type === 'create' ? 'create' : 'update',
      userModified: tur.userModified === true,
    }
    return { kind: 'write', data }
  }

  if (name === 'Edit' && tur && typeof tur === 'object' && typeof tur.oldString === 'string') {
    const original = typeof tur.originalFile === 'string' ? tur.originalFile : ''
    const oldStr = tur.oldString
    const newStr = typeof tur.newString === 'string' ? tur.newString : ''
    const replaceAll = tur.replaceAll === true
    const newContent = replaceAll
      ? original.split(oldStr).join(newStr)
      : applySingleEdit(original, oldStr, newStr)
    const data: FileEditResult = {
      filePath: typeof tur.filePath === 'string' ? tur.filePath : String(args.file_path ?? ''),
      originalFile: original,
      newContent,
      oldString: oldStr,
      newString: newStr,
      replaceAll,
      userModified: tur.userModified === true,
    }
    return { kind: 'edit', data }
  }

  if (name === 'Read' && tur && typeof tur === 'object') {
    // Read result envelope is small ({file, type}) — the actual content lives in blk.content
    const fileMeta = tur.file ?? {}
    const data: ReadResult = {
      filePath: String(args.file_path ?? fileMeta.filePath ?? ''),
      content: extractTextContent(blk.content),
      isError,
    }
    return { kind: 'read', data }
  }

  if (name === 'TodoWrite' && tur && typeof tur === 'object' && Array.isArray(tur.newTodos)) {
    const data: TodoWriteResult = {
      oldTodos: Array.isArray(tur.oldTodos) ? (tur.oldTodos as TodoItem[]) : [],
      newTodos: tur.newTodos as TodoItem[],
    }
    return { kind: 'todo', data }
  }

  // Generic fallback — content from the tool_result block itself
  return {
    kind: 'generic',
    data: { content: stripAnsi(extractTextContent(blk.content)), isError },
  }
}

function applySingleEdit(content: string, oldStr: string, newStr: string): string {
  // claude-code requires oldString to be unique when replaceAll=false. The result
  // envelope is post-success, so this should always succeed; if the substring
  // isn't found we return content unchanged (extreme edge case).
  const idx = content.indexOf(oldStr)
  if (idx === -1) return content
  return content.slice(0, idx) + newStr + content.slice(idx + oldStr.length)
}

function extractTextContent(content: Json): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((c: Json) => {
      if (typeof c === 'string') return c
      if (c && typeof c === 'object' && typeof c.text === 'string') return c.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractSynthesizedText(content: Json): string | null {
  if (typeof content === 'string') {
    // string-content user events in math500 — these are synthesized by claude-code's wrapper
    return content
  }
  if (!Array.isArray(content)) return null
  // livecodebench shape: array of [{type:'text', text:'...'}] WITHOUT any tool_result blocks
  const hasToolResult = content.some((c: Json) => c && c.type === 'tool_result')
  if (hasToolResult) return null
  const text = content
    .map((c: Json) => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .filter(Boolean)
    .join('\n')
  return text || null
}

function classifyNote(text: string): 'session-resume' | 'container-reboot' | 'user-prompt' {
  if (text.includes('session is being continued')) return 'session-resume'
  if (text.includes('Container was killed') || text.includes('rebooted')) return 'container-reboot'
  return 'user-prompt'
}
