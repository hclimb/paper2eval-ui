export interface TokenUsage {
  input: number
  output: number
  cacheRead?: number
  cacheCreation?: number
}

export interface ToolResult {
  content: string
  isError: boolean
  exitCode?: number
}

export type Block =
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
