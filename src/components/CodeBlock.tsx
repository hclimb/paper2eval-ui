import type { Element, Root, RootContent } from 'hast'
import {
  createElement,
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  createHighlighterCore,
  type DynamicImportLanguageRegistration,
  type HighlighterCore,
} from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

const MAX_HIGHLIGHT_BYTES = 150 * 1024

const LANG_LOADERS: Record<string, DynamicImportLanguageRegistration> = {
  bash: () => import('@shikijs/langs/bash'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsonl: () => import('@shikijs/langs/jsonl'),
  markdown: () => import('@shikijs/langs/markdown'),
  python: () => import('@shikijs/langs/python'),
  toml: () => import('@shikijs/langs/toml'),
  typescript: () => import('@shikijs/langs/typescript'),
  yaml: () => import('@shikijs/langs/yaml'),
}

let hlPromise: Promise<HighlighterCore> | null = null
const tried = new Set<string>(['plaintext'])

function getHL(): Promise<HighlighterCore> {
  if (!hlPromise) {
    hlPromise = createHighlighterCore({
      themes: [
        import('@shikijs/themes/github-light'),
        import('@shikijs/themes/github-dark-default'),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return hlPromise
}

async function ensureLang(lang: string) {
  if (tried.has(lang)) return
  tried.add(lang)
  const loader = LANG_LOADERS[lang]
  if (!loader) return
  const hl = await getHL()
  try {
    await hl.loadLanguage(loader)
  } catch {
    /* falls back to plaintext */
  }
}

const EXT_MAP: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  json: 'json',
  jsonl: 'jsonl',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  sh: 'bash',
  bash: 'bash',
  diff: 'diff',
  patch: 'diff',
  toml: 'toml',
}

const BASENAME_MAP: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'bash',
}

function langFromFilename(name: string): string | null {
  const base = (name.split('/').pop() ?? name).toLowerCase()
  if (BASENAME_MAP[base]) return BASENAME_MAP[base]
  const ext = base.includes('.') ? base.split('.').pop()! : ''
  return EXT_MAP[ext] ?? null
}

function langFromContent(text: string): string {
  const head = text.slice(0, 2048).trimStart()
  if (head.startsWith('#!')) {
    const first = head.split('\n')[0]!
    if (/python/.test(first)) return 'python'
    if (/\b(ba)?sh\b/.test(first)) return 'bash'
    return 'bash'
  }
  if (
    (head.startsWith('{') || head.startsWith('[')) &&
    (text.trimEnd().endsWith('}') || text.trimEnd().endsWith(']'))
  ) {
    try {
      JSON.parse(text)
      return 'json'
    } catch {
      /* not json */
    }
  }
  if (/^(import |from \w+ import |def |class |if __name__)/m.test(head)) return 'python'
  return 'plaintext'
}

function kebabToCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

function parseStyle(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of css.split(';')) {
    const sep = decl.indexOf(':')
    if (sep < 0) continue
    const prop = decl.slice(0, sep).trim()
    if (!prop) continue
    out[kebabToCamel(prop)] = decl.slice(sep + 1).trim()
  }
  return out
}

function hastPropsToReact(props: Element['properties']): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue
    if (k === 'className') {
      out.className = Array.isArray(v) ? v.join(' ') : v
    } else if (k === 'style' && typeof v === 'string') {
      out.style = parseStyle(v)
    } else if (k === 'tabindex') {
      out.tabIndex = typeof v === 'string' ? Number(v) : v
    } else {
      out[k] = v
    }
  }
  return out
}

function renderHastChild(child: RootContent, key: number): ReactNode {
  if (child.type === 'text') return child.value
  if (child.type === 'element') {
    return createElement(
      child.tagName,
      { ...hastPropsToReact(child.properties ?? {}), key },
      ...child.children.map((c, i) => renderHastChild(c, i)),
    )
  }
  return null
}

function renderHast(root: Root): ReactNode {
  return createElement(Fragment, null, ...root.children.map((c, i) => renderHastChild(c, i)))
}

const STYLE_ID = 'code-block-shiki-css'

function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
.cb-root {
  overflow: auto;
  background: var(--paper-deep);
  border: 1px solid var(--rule);
  border-radius: 4px;
  color: var(--ink);
}
.cb-root pre {
  margin: 0;
  padding: 0.75rem 1rem;
  font-size: 0.75rem;
  line-height: 1.75;
  background: transparent !important;
  min-width: fit-content;
  border: 0;
  border-left: 0;
}
.cb-root code {
  display: block;
  font-family: var(--font-mono);
  background: transparent;
  padding: 0;
  font-size: 1em;
}
.cb-root .line:empty::after {
  content: " ";
}
.cb-root.cb-wrap pre {
  white-space: pre-wrap;
  word-break: break-word;
  min-width: 0;
}
`
  document.head.appendChild(el)
}

export function CodeBlock({
  content,
  maxHeight = 600,
  wrap = false,
  lang,
  filename,
  theme = 'github-light',
}: {
  content: string
  maxHeight?: number
  wrap?: boolean
  lang?: string
  filename?: string
  theme?: 'github-light' | 'github-dark-default'
}) {
  const [hast, setHast] = useState<Root | null>(null)
  const mountRef = useRef(true)

  const resolvedLang = useMemo(() => {
    if (lang) return lang
    if (filename) {
      const detected = langFromFilename(filename)
      if (detected) return detected
    }
    return langFromContent(content)
  }, [lang, filename, content])

  const shouldHighlight = content.length <= MAX_HIGHLIGHT_BYTES && resolvedLang !== 'plaintext'

  useEffect(injectStyles, [])

  useEffect(() => {
    mountRef.current = true
    if (!shouldHighlight) {
      setHast(null)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        await ensureLang(resolvedLang)
        const hl = await getHL()
        const available = hl.getLoadedLanguages()
        const effective = available.includes(resolvedLang) ? resolvedLang : 'plaintext'
        if (effective === 'plaintext' || cancelled) {
          if (!cancelled) setHast(null)
          return
        }
        const out = hl.codeToHast(content, {
          lang: effective,
          theme,
        })
        if (!cancelled && mountRef.current) setHast(out)
      } catch (err) {
        console.error('[CodeBlock] highlight failed:', err)
        if (!cancelled) setHast(null)
      }
    })()

    return () => {
      cancelled = true
      mountRef.current = false
    }
  }, [content, resolvedLang, shouldHighlight, theme])

  const cls = ['cb-root', wrap && 'cb-wrap'].filter(Boolean).join(' ')

  const rendered = useMemo(() => (hast ? renderHast(hast) : null), [hast])

  if (rendered) {
    return (
      <div className={cls} style={{ maxHeight }}>
        {rendered}
      </div>
    )
  }

  return (
    <div className={cls} style={{ maxHeight }}>
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  )
}
