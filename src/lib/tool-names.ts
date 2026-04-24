export const BASH_NAMES = new Set([
  'bash',
  'bashtool',
  'execute',
  'shell',
  'terminal',
  'run_command',
])

export const READ_NAMES = new Set(['read', 'readfile', 'view', 'cat', 'readtool'])

export const WRITE_NAMES = new Set(['write', 'writefile', 'create', 'save', 'writetool'])

export const EDIT_NAMES = new Set([
  'edit',
  'editfile',
  'str_replace_editor',
  'multiedit',
  'edittool',
  'multiedittool',
  'str_replace_based_edit_tool',
  'replacetool',
])

export const SEARCH_NAMES = new Set(['grep', 'search', 'ripgrep', 'greptool'])

export const FS_NAMES = new Set(['glob', 'globtool', 'find', 'ls', 'listfiles', 'list', 'lstool'])

export const TASK_NAMES = new Set(['task', 'dispatch', 'subagent', 'tasktool', 'agent'])

export const WEB_NAMES = new Set(['webfetch', 'fetch', 'browse', 'webtool'])

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI CSI sequences are control characters by definition
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g

export function stripAnsi(t: string): string {
  return t.replace(ANSI_RE, '')
}

export function toolFilePath(args: Record<string, unknown>): string {
  return String(args.file_path ?? args.path ?? args.filename ?? '').trim()
}

export function toolIcon(name: string): string {
  const n = name.toLowerCase()
  if (BASH_NAMES.has(n)) return '▶'
  if (READ_NAMES.has(n)) return '📄'
  if (WRITE_NAMES.has(n) || EDIT_NAMES.has(n)) return '✏️'
  if (SEARCH_NAMES.has(n)) return '🔍'
  if (FS_NAMES.has(n)) return '📁'
  if (TASK_NAMES.has(n)) return '🔄'
  if (WEB_NAMES.has(n)) return '🌐'
  return '🔧'
}
