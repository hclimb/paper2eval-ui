// Real tool names emitted by claude-code. Audited against production traces;
// older speculative aliases (str_replace_editor, bashtool, fetch, glob, etc.)
// were never observed and have been removed.

export const BASH = 'Bash'
export const READ = 'Read'
export const WRITE = 'Write'
export const EDIT = 'Edit'
export const TODO_WRITE = 'TodoWrite'
export const TOOL_SEARCH = 'ToolSearch'

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI CSI sequences are control characters by definition
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g

export function stripAnsi(t: string): string {
  return t.replace(ANSI_RE, '')
}

export function toolFilePath(args: Record<string, unknown>): string {
  return typeof args.file_path === 'string' ? args.file_path : ''
}

export function toolIcon(name: string): string {
  switch (name) {
    case BASH:
      return '▶'
    case READ:
      return '📄'
    case WRITE:
    case EDIT:
      return '✏️'
    case TODO_WRITE:
      return '📋'
    case TOOL_SEARCH:
      return '🔍'
    default:
      return '🔧'
  }
}
