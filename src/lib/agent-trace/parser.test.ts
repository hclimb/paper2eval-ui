import { describe, expect, it } from 'vitest'
import { parseAgentTrace } from './parser'
import { buildFileTimeline } from './timeline'

// Fixtures are condensed but realistic — every line is shaped after a real
// claude-code trace event observed in s3 (math500 + livecodebench runs).
// See parser.ts for the schema audit notes.

const MATH500_FIXTURE = [
  // wrapper noise lines should NOT appear here — math500 has no wrapper prefix
  // attachment / queue-operation / last-prompt — claude-code 2.1.113 emits these,
  // they should be silently dropped by the parser
  '{"type":"attachment","attachment":{"type":"deferred_tools_delta","addedNames":["WebSearch"]}}',
  '{"type":"last-prompt","lastPrompt":"Beat math500"}',
  '{"type":"queue-operation","operation":"enqueue","content":"…"}',
  // synthesized user-as-string event — should become a 'note' block
  '{"type":"user","message":{"role":"user","content":"# Beat Math500\\nGet accuracy ≥ 81.456."}}',
  // system init — captures model/cwd/tools/sessionId
  '{"type":"system","subtype":"init","cwd":"/app","session_id":"sess-1","tools":["Bash","Edit","Read","Write"],"model":"claude-opus-4-7","permissionMode":"bypassPermissions"}',
  // assistant: thinking + tool_use
  '{"type":"assistant","message":{"model":"claude-opus-4-7","usage":{"input_tokens":42,"output_tokens":17,"cache_read_input_tokens":1000},"content":[{"type":"thinking","thinking":"I should check what is here."},{"type":"tool_use","id":"tu_1","name":"Bash","input":{"command":"ls /app","description":"list"}}]}}',
  // user: tool_result for tu_1 (bash) — toolUseResult is camelCase here
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"file1\\nfile2","is_error":false}]},"toolUseResult":{"stdout":"file1\\nfile2","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false}}',
  // assistant: tool_use Edit
  '{"type":"assistant","message":{"model":"claude-opus-4-7","content":[{"type":"tool_use","id":"tu_2","name":"Edit","input":{"file_path":"/app/x.py","old_string":"foo","new_string":"bar","replace_all":false}}]}}',
  // user: tool_result for Edit — has structuredPatch + originalFile + oldString/newString
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_2","content":"…","is_error":false}]},"toolUseResult":{"filePath":"/app/x.py","oldString":"foo","newString":"bar","originalFile":"prefix foo suffix","replaceAll":false,"structuredPatch":[{"oldStart":1,"oldLines":1,"newStart":1,"newLines":1,"lines":["-prefix foo suffix","+prefix bar suffix"]}],"userModified":false}}',
  // assistant: TodoWrite
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_3","name":"TodoWrite","input":{"todos":[{"content":"step 1","status":"in_progress","activeForm":"doing step 1"}]}}]}}',
  // user: tool_result for TodoWrite — has oldTodos/newTodos
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_3","content":"ok","is_error":false}]},"toolUseResult":{"oldTodos":[],"newTodos":[{"content":"step 1","status":"in_progress","activeForm":"doing step 1"}],"verificationNudgeNeeded":false}}',
  // failed bash — is_error: true on tool_result block
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_4","name":"Bash","input":{"command":"false","description":"fail"}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_4","content":"oops","is_error":true}]},"toolUseResult":{"stdout":"","stderr":"oops","interrupted":false,"isImage":false,"noOutputExpected":false}}',
  // compact_boundary — context auto-compacted at this point
  '{"type":"system","subtype":"compact_boundary","compactMetadata":{"trigger":"auto","preTokens":169048,"postTokens":6330,"durationMs":67643}}',
  // synthesized user-as-string — recovery message after context kill
  '{"type":"user","message":{"role":"user","content":"Container was killed and rebooted. ALL running processes were terminated."}}',
].join('\n')

const LIVECODEBENCH_FIXTURE = [
  // wrapper prefix — newer claude-code wraps in shell that emits these
  '[wrapper] workspace: run',
  '[wrapper] sessions → /mnt/models/_workspace/run/claude_sessions',
  '[wrapper] found session 2feb5448-64f9-48d9-8a30-98a4fd284423 (636 messages)',
  '[wrapper] RESUMING session 2feb5448-64f9-48d9-8a30-98a4fd284423',
  // system init
  '{"type":"system","subtype":"init","cwd":"/app","session_id":"2feb5448","tools":["Bash","Read","Write"],"model":"claude-opus-4-7"}',
  // background bash launch (run_in_background:true)
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_5","name":"Bash","input":{"command":"sleep 3600","description":"slow","run_in_background":true}}]}}',
  // tool_use_result (snake_case envelope this time) — has backgroundTaskId
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_5","content":"queued","is_error":false}]},"tool_use_result":{"stdout":"","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false,"backgroundTaskId":"bg-1"}}',
  // task_started + notification + updated lifecycle
  '{"type":"system","subtype":"task_started","task_id":"bg-1","tool_use_id":"tu_5","description":"slow"}',
  '{"type":"system","subtype":"task_notification","task_id":"bg-1","tool_use_id":"tu_5","status":"completed","summary":"done"}',
  '{"type":"system","subtype":"task_updated","task_id":"bg-1","patch":{"status":"completed","end_time":1777199417624}}',
  // synthesized text-as-array continuation (different shape from math500)
  '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"This session is being continued from a previous conversation that ran out of context."}]}}',
  // redacted thinking — signature only, no content
  '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"","signature":"sig-abc123"}]}}',
  // api_retry — fired when claude-code retries an API call (rate-limit / timeout)
  '{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":577.4,"error_status":null,"error":"unknown"}',
  // a Bash whose tool_use_result is a STRING (not an object) — happens when the
  // tool errors out hard. parser should still classify the result as "bash" and
  // route the string into stderr, NOT fall through to a generic ToolResult.
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_6","name":"Bash","input":{"command":"false","description":"err"}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_6","content":"Exit code 1","is_error":true}]},"tool_use_result":"Error: Exit code 1"}',
  // result event with NEW field names: total_cost_usd not cost_usd
  '{"type":"result","subtype":"success","num_turns":42,"duration_ms":582733,"duration_api_ms":401123,"total_cost_usd":1.73,"is_error":false,"result":"done","stop_reason":"end_turn","terminal_reason":"completed"}',
].join('\n')

describe('parseAgentTrace', () => {
  describe('math500 (claude-code 2.1.113, camelCase envelope)', () => {
    const result = parseAgentTrace(MATH500_FIXTURE)
    if (!result.ok) throw new Error(`parse failed: ${result.reason}`)

    it('drops attachment / last-prompt / queue-operation noise', () => {
      const blocks = result.blocks.map((b) => b.kind)
      expect(blocks).not.toContain('attachment')
      expect(blocks).not.toContain('last-prompt')
      expect(blocks).not.toContain('queue-operation')
    })

    it('promotes synthesized user-string events into note blocks', () => {
      const notes = result.blocks.filter((b) => b.kind === 'note')
      expect(notes).toHaveLength(2)
      const note = notes[0]
      if (note?.kind !== 'note') throw new Error('expected note')
      expect(note.source).toBe('user-prompt')
      const reboot = notes[1]
      if (reboot?.kind !== 'note') throw new Error('expected note')
      expect(reboot.source).toBe('container-reboot')
    })

    it('captures system init metadata', () => {
      const sys = result.blocks.find((b) => b.kind === 'system')
      if (sys?.kind !== 'system') throw new Error('expected system block')
      expect(sys.model).toBe('claude-opus-4-7')
      expect(sys.cwd).toBe('/app')
      expect(sys.tools).toEqual(['Bash', 'Edit', 'Read', 'Write'])
      expect(sys.permissionMode).toBe('bypassPermissions')
      expect(result.meta.sessionId).toBe('sess-1')
    })

    it('captures bash result with interrupted/stderr (NOT exitCode)', () => {
      const bash = result.blocks.find(
        (b) => b.kind === 'tool' && b.toolName === 'Bash' && b.callId === 'tu_1',
      )
      if (bash?.kind !== 'tool' || bash.result?.kind !== 'bash') throw new Error('expected bash')
      expect(bash.result.data.stdout).toBe('file1\nfile2')
      expect(bash.result.data.interrupted).toBe(false)
      expect(bash.result.data.isError).toBe(false)
    })

    it('captures Edit result with originalFile + computed newContent', () => {
      const edit = result.blocks.find(
        (b) => b.kind === 'tool' && b.toolName === 'Edit' && b.callId === 'tu_2',
      )
      if (edit?.kind !== 'tool' || edit.result?.kind !== 'edit') throw new Error('expected edit')
      expect(edit.result.data.filePath).toBe('/app/x.py')
      expect(edit.result.data.originalFile).toBe('prefix foo suffix')
      // Authoritative newContent computed from originalFile + oldString → newString
      expect(edit.result.data.newContent).toBe('prefix bar suffix')
      expect(edit.result.data.replaceAll).toBe(false)
    })

    it('captures TodoWrite with old/new todos diff', () => {
      const todo = result.blocks.find(
        (b) => b.kind === 'tool' && b.toolName === 'TodoWrite' && b.callId === 'tu_3',
      )
      if (todo?.kind !== 'tool' || todo.result?.kind !== 'todo') throw new Error('expected todo')
      expect(todo.result.data.oldTodos).toEqual([])
      expect(todo.result.data.newTodos).toHaveLength(1)
      expect(todo.result.data.newTodos[0]?.status).toBe('in_progress')
    })

    it('detects bash failure via is_error (NOT a phantom exitCode field)', () => {
      const failed = result.blocks.find(
        (b) => b.kind === 'tool' && b.toolName === 'Bash' && b.callId === 'tu_4',
      )
      if (failed?.kind !== 'tool' || failed.result?.kind !== 'bash')
        throw new Error('expected bash')
      expect(failed.result.data.isError).toBe(true)
      expect(failed.result.data.stderr).toBe('oops')
    })

    it('captures compact_boundary as a first-class block', () => {
      const boundary = result.blocks.find((b) => b.kind === 'compact_boundary')
      if (boundary?.kind !== 'compact_boundary') throw new Error('expected boundary')
      expect(boundary.preTokens).toBe(169048)
      expect(boundary.postTokens).toBe(6330)
      expect(boundary.trigger).toBe('auto')
    })

    it('reports non-resumed session for math500', () => {
      expect(result.meta.isResumed).toBe(false)
      expect(result.meta.wrapperLog).toEqual([])
    })
  })

  describe('livecodebench (newer claude-code, snake_case envelope)', () => {
    const result = parseAgentTrace(LIVECODEBENCH_FIXTURE)
    if (!result.ok) throw new Error(`parse failed: ${result.reason}`)

    it('detects resumed session from wrapper log', () => {
      expect(result.meta.isResumed).toBe(true)
      expect(result.meta.resumedFromMessages).toBe(636)
      expect(result.meta.wrapperLog.length).toBeGreaterThan(0)
    })

    it('handles snake_case tool_use_result envelope (vs camel)', () => {
      const bash = result.blocks.find(
        (b) => b.kind === 'tool' && b.toolName === 'Bash' && b.callId === 'tu_5',
      )
      if (bash?.kind !== 'tool' || bash.result?.kind !== 'bash') throw new Error('expected bash')
      expect(bash.result.data.backgroundTaskId).toBe('bg-1')
    })

    it('emits task_event blocks for the background task lifecycle', () => {
      const taskEvents = result.blocks.filter((b) => b.kind === 'task_event')
      expect(taskEvents.map((b) => b.kind === 'task_event' && b.subtype)).toEqual([
        'started',
        'notification',
        'updated',
      ])
      const started = taskEvents[0]
      if (started?.kind !== 'task_event') throw new Error('expected task_event')
      expect(started.toolUseId).toBe('tu_5')
    })

    it('promotes array-of-text continuation messages into note blocks', () => {
      const note = result.blocks.find((b) => b.kind === 'note')
      if (note?.kind !== 'note') throw new Error('expected note')
      expect(note.source).toBe('session-resume')
    })

    it('emits redacted_thinking when thinking is empty but signed', () => {
      const redacted = result.blocks.find((b) => b.kind === 'redacted_thinking')
      if (redacted?.kind !== 'redacted_thinking') throw new Error('expected redacted')
      expect(redacted.signature).toBe('sig-abc123')
    })

    it('handles the total_cost_usd rename (was cost_usd in older claude-code)', () => {
      const res = result.blocks.find((b) => b.kind === 'result')
      if (res?.kind !== 'result') throw new Error('expected result')
      expect(res.totalCostUsd).toBe(1.73)
      expect(res.numTurns).toBe(42)
      expect(res.terminalReason).toBe('completed')
      expect(res.stopReason).toBe('end_turn')
    })

    it('emits api_retry blocks for upstream-retry events', () => {
      const retry = result.blocks.find((b) => b.kind === 'api_retry')
      if (retry?.kind !== 'api_retry') throw new Error('expected api_retry')
      expect(retry.attempt).toBe(1)
      expect(retry.maxRetries).toBe(10)
      expect(retry.retryDelayMs).toBeCloseTo(577.4, 1)
    })

    it('handles string-shaped tool_use_result for Bash (routes string to stderr)', () => {
      const errored = result.blocks.find(
        (b) => b.kind === 'tool' && b.toolName === 'Bash' && b.callId === 'tu_6',
      )
      if (errored?.kind !== 'tool' || errored.result?.kind !== 'bash')
        throw new Error('expected bash result kind even when envelope is a string')
      expect(errored.result.data.stderr).toBe('Error: Exit code 1')
      expect(errored.result.data.stdout).toBe('')
      expect(errored.result.data.isError).toBe(true)
    })
  })

  describe('rejection paths', () => {
    it('rejects content above MAX_PARSE_BYTES', () => {
      const huge = 'x'.repeat(6 * 1024 * 1024)
      const r = parseAgentTrace(huge)
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe('too-large')
    })

    it('rejects non-stream content', () => {
      const r = parseAgentTrace('this is not jsonl\nat all\njust\ntext')
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.reason).toBe('not-stream')
    })
  })
})

describe('buildFileTimeline (uses authoritative envelope, NOT a simulator)', () => {
  it('derives diffs from originalFile + computed newContent (no string-replace simulation)', () => {
    const result = parseAgentTrace(MATH500_FIXTURE)
    if (!result.ok) throw new Error('parse failed')
    const timeline = buildFileTimeline(result.blocks)

    expect(timeline.paths).toEqual(['/app/x.py'])

    const change = timeline.changes.find((c) => c.path === '/app/x.py')
    expect(change?.kind).toBe('edit')
    expect(change?.oldContent).toBe('prefix foo suffix')
    expect(change?.newContent).toBe('prefix bar suffix')
  })
})
