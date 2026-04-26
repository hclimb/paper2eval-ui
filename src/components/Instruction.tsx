import { useMemo } from 'react'

export function InstructionCollapse({ instructionHtml }: { instructionHtml: string }) {
  const wordCount = useMemo(() => {
    const text = instructionHtml.replace(/<[^>]+>/g, ' ').trim()
    return text ? text.split(/\s+/).filter(Boolean).length : 0
  }, [instructionHtml])

  return (
    <details className="instruction-collapse">
      <summary className="meta-subhead cursor-pointer select-none">
        <span className="instruction-chevron">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <title>toggle</title>
            <path d="M4.5 2L9 6L4.5 10V2Z" />
          </svg>
        </span>
        AGENT INSTRUCTION
        {wordCount > 0 && <span className="instruction-badge">{wordCount} words</span>}
      </summary>
      <div
        className="measure font-body prose mt-3"
        dangerouslySetInnerHTML={{ __html: instructionHtml }}
      />
    </details>
  )
}
