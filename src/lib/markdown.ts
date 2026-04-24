import type { RehypeShikiOptions } from '@shikijs/rehype'
import rehypeShiki from '@shikijs/rehype'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

const SHIKI_OPTIONS: RehypeShikiOptions = {
  themes: { light: 'github-light' },
  defaultColor: 'light',
  langs: [
    'bash',
    'python',
    'typescript',
    'javascript',
    'json',
    'yaml',
    'markdown',
    'diff',
    'toml',
    'dockerfile',
  ],
}

const pipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSlug)
  .use(rehypeShiki, SHIKI_OPTIONS)
  .use(rehypeStringify)

export async function markdownToHtml(md: string): Promise<string> {
  const result = await pipeline.process(md)
  return String(result)
}
