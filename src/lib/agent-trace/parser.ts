import type { Block, TokenUsage, ToolResult } from './blocks'
import { stripAnsi } from './tool-names'

export const MAX_PARSE_BYTES = 5 * 1024 * 1024

export type ParseResult =
  | { ok: true; blocks: Block[] }
  | { ok: false; reason: 'too-large'; bytes: number }
  | { ok: false; reason: 'not-stream' }

export function parseAgentTrace(raw: string): ParseResult {
  if (raw.length > MAX_PARSE_BYTES) return { ok: false, reason: 'too-large', bytes: raw.length }

  const blocks: Block[] = []
  const pendingTools = new Map<string, number>()
  // biome-ignore lint/suspicious/noExplicitAny: jsonl events have loose shape
  const events: any[] = []
  const rawLines: string[] = []
  let nonEmpty = 0

  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    nonEmpty++
    try {
      const obj = JSON.parse(t)
      if (obj && typeof obj === 'object' && 'type' in obj) {
        events.push(obj)
        continue
      }
    } catch {
      /* not json — falls through to raw */
    }
    rawLines.push(t)
  }

  if (events.length < 2 || (nonEmpty > 0 && events.length / nonEmpty < 0.25)) {
    return { ok: false, reason: 'not-stream' }
  }

  for (const ev of events) {
    if (ev.type === 'system' && ev.subtype === 'init') {
      blocks.push({
        kind: 'system',
        model: ev.model ?? 'unknown',
        cwd: ev.cwd ?? '',
        tools: Array.isArray(ev.tools)
          ? ev.tools.map((t: { name?: string } | string) =>
              typeof t === 'string' ? t : (t.name ?? '?'),
            )
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
            .map((c: { text?: string } | string) =>
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
          const target = blocks[toolIdx]
          if (target?.kind === 'tool') {
            target.result = result
          }
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

  return { ok: true, blocks }
}

/** Quick peek at the first 20 non-empty lines — used as a cheap content-type probe. */
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
