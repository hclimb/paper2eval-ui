import { createServerFn } from '@tanstack/react-start'
import { markdownToHtml } from './markdown'

const DOC_MODULES = import.meta.glob<string>('../../public/docs/**/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
})

const DOCS_BY_PATH = new Map(
  Object.entries(DOC_MODULES).map(([key, raw]) => [key.replace(/^.*\/public\/docs\//, ''), raw]),
)
const DOC_PATHS = [...DOCS_BY_PATH.keys()].sort()

function normalizeDocPath(input: string): string {
  if (input.startsWith('/') || input.includes('\\') || input.includes('\0')) {
    throw new Error('invalid path')
  }

  const parts: string[] = []
  for (const part of input.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') throw new Error('invalid path')
    parts.push(part)
  }

  const normalized = parts.join('/')
  if (!DOCS_BY_PATH.has(normalized)) {
    throw new Error('document not found')
  }

  return normalized
}

export const fetchDocList = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string[]> => {
    return DOC_PATHS
  },
)

export const fetchDocContent = createServerFn({ method: 'GET' })
  .inputValidator((d: { path: string }) => d)
  .handler(async ({ data }) => {
    const normalized = normalizeDocPath(data.path)
    const raw = DOCS_BY_PATH.get(normalized)
    if (raw == null) throw new Error('document not found')
    const html = await markdownToHtml(raw)

    return { path: normalized, raw, html }
  })
