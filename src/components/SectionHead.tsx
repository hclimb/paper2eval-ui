/**
 * The mono-muted header that sits above every section-level page.
 *
 * Emits an `<h1>` so every non-thesis page has a real document-outline
 * heading for screen readers and SEO — previously the element was
 * `<header class="eyebrow">` which is a landmark, not a heading, and left
 * `/meta`, `/graph`, `/theses`, and the `$page` routes with a silent
 * outline. The `.eyebrow` class preserves the mono-uppercase look.
 *
 * Thesis permalinks don't use SectionHead — they mount their own
 * screen-reader-only `<h1>` in-route because their visual header is the
 * thesis proposition itself, not a chrome label.
 */
type Props = {
  label: string
}

export default function SectionHead({ label }: Props) {
  return (
    <h1 className="eyebrow" style={{ marginBottom: 'var(--space-4)' }}>
      {label}
    </h1>
  )
}
