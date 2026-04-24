import { Link } from '@tanstack/react-router'
import { SITE } from '#/lib/constants'

/** Minimal graph-node glyph — three nodes + connecting edges. Inline SVG
 *  so it inherits `currentColor` and carries no dep weight. Used again
 *  (scaled up, dashed) on the 404 page for visual continuity. */
function BrandMark() {
  return (
    <svg
      className="brand-mark"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="7" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M8 7 L16 7" />
      <path d="M7 8.8 L11 16.2" />
      <path d="M17 8.8 L13 16.2" />
    </svg>
  )
}

export default function Header() {
  return (
    <header className="app-header sticky top-0 z-50">
      <div className="app-header-row page-wrap">
        <Link to="/" className="brand" aria-label={SITE.title}>
          <BrandMark />
          <span>paper2eval</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          <Link to="/" className="nav-link" activeProps={{ className: 'active' }}>
            tasks
          </Link>
          <Link to="/runs/beat-math500" className="nav-link" activeProps={{ className: 'active' }}>
            runs
          </Link>
          <Link to="/docs" className="nav-link" activeProps={{ className: 'active' }}>
            docs
          </Link>
        </nav>
      </div>
    </header>
  )
}
