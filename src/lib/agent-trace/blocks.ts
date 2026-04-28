// Authoritative shapes captured from real claude-code traces.
// See parser.ts for the field-by-field audit notes.

export interface TokenUsage {
  input: number
  output: number
  cacheRead?: number
  cacheCreation?: number
}

export interface BashResult {
  stdout: string
  stderr: string
  interrupted: boolean
  isError: boolean
  backgroundTaskId?: string
}

export interface FileWriteResult {
  filePath: string
  originalFile: string
  newContent: string
  type: 'create' | 'update'
  userModified: boolean
}

export interface FileEditResult {
  filePath: string
  originalFile: string
  newContent: string
  oldString: string
  newString: string
  replaceAll: boolean
  userModified: boolean
}

export interface ReadResult {
  filePath: string
  content: string
  isError: boolean
}

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

export interface TodoWriteResult {
  oldTodos: TodoItem[]
  newTodos: TodoItem[]
}

export interface GenericToolResult {
  content: string
  isError: boolean
}

export type ToolResult =
  | { kind: 'bash'; data: BashResult }
  | { kind: 'write'; data: FileWriteResult }
  | { kind: 'edit'; data: FileEditResult }
  | { kind: 'read'; data: ReadResult }
  | { kind: 'todo'; data: TodoWriteResult }
  | { kind: 'generic'; data: GenericToolResult }

export type Block =
  | {
      kind: 'system'
      model: string
      cwd: string
      tools: string[]
      sessionId?: string
      permissionMode?: string
    }
  | { kind: 'note'; content: string; source: 'session-resume' | 'container-reboot' | 'user-prompt' }
  | { kind: 'thinking'; content: string }
  | { kind: 'redacted_thinking'; signature: string }
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
      kind: 'compact_boundary'
      preTokens: number
      postTokens: number
      durationMs: number
      trigger: string
    }
  | {
      kind: 'task_event'
      subtype: 'started' | 'notification' | 'updated'
      taskId: string
      toolUseId?: string
      description?: string
      status?: string
      summary?: string
    }
  | {
      kind: 'api_retry'
      attempt: number
      maxRetries: number
      retryDelayMs: number
      errorStatus: string | null
      error: string
    }
  | {
      kind: 'result'
      numTurns?: number
      totalCostUsd?: number
      durationMs?: number
      durationApiMs?: number
      isError: boolean
      text?: string
      stopReason?: string
      terminalReason?: string
    }

export interface TraceMeta {
  isResumed: boolean
  resumedFromMessages?: number
  wrapperLog: string[]
  sessionId?: string
}
