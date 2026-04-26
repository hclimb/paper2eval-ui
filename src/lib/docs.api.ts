import { readdir, readFile } from 'node:fs/promises'
import { join, normalize, relative } from 'node:path'
import { createServerFn } from '@tanstack/react-start'
import { markdownToHtml } from './markdown'

const DOCS_ROOT = join(process.cwd(), 'public', 'docs')

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      paths.push(...(await walkDir(full)))
    } else if (entry.name.endsWith('.md')) {
      paths.push(relative(DOCS_ROOT, full))
    }
  }
  return paths.sort()
}

export const fetchDocList = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string[]> => {
    return walkDir(DOCS_ROOT)
  },
)

export const fetchDocContent = createServerFn({ method: 'GET' })
  .inputValidator((d: { path: string }) => d)
  .handler(async ({ data }) => {
    const normalized = normalize(data.path)
    if (normalized.includes('..') || normalized.startsWith('/')) {
      throw new Error('invalid path')
    }

    const fullPath = join(DOCS_ROOT, normalized)
    if (!fullPath.startsWith(DOCS_ROOT)) {
      throw new Error('invalid path')
    }

    const raw = await readFile(fullPath, 'utf-8')
    const html = await markdownToHtml(raw)

    return { path: data.path, raw, html }
  })
