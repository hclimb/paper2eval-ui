import { BUILD_DATE, SITE } from '#/lib/constants'

export default function Footer() {
  return (
    <footer className="app-footer">
      <div className="page-wrap app-footer-row">
        <div className="app-footer-brand">
          <span className="app-footer-title">{SITE.title}</span>
          <span className="app-footer-desc">{SITE.description}</span>
        </div>
        <div className="app-footer-meta">
          <a href={`https://${SITE.repo}`} rel="noreferrer noopener" target="_blank">
            {SITE.repo}
          </a>
          <span className="app-footer-sep" aria-hidden="true">
            &middot;
          </span>
          <span title="Build date">build {BUILD_DATE}</span>
        </div>
      </div>
    </footer>
  )
}
