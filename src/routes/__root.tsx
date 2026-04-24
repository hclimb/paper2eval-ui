import { TanStackDevtools } from '@tanstack/react-devtools'
import { createRootRoute, HeadContent, Link, Scripts } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import Footer from '../components/Footer'
import Header from '../components/Header'

import appCss from '../styles.css?url'

/** Same topology as the header's BrandMark, but scaled up and dashed — a
 *  "broken edges" motif for the 404 page. */
function BrokenNodeMark() {
  return (
    <svg
      className="not-found-mark"
      width="96"
      height="96"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="7" r="1.6" />
      <circle cx="18" cy="7" r="1.6" strokeDasharray="1 1.2" />
      <circle cx="12" cy="18" r="1.6" />
      <path d="M8 7 L16 7" strokeDasharray="1.5 1.5" />
      <path d="M7 8.6 L11 16.4" />
      <path d="M17 8.6 L13 16.4" strokeDasharray="1.5 1.5" />
    </svg>
  )
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'paper2eval' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <main className="page-wrap not-found">
      <BrokenNodeMark />
      <div className="not-found-eyebrow">404 &middot; not found</div>
      <h1 className="not-found-title">nothing here.</h1>
      <p className="not-found-desc">
        The page you were looking for doesn&apos;t exist, or the link has drifted since it was last
        indexed. Head back and try a different thread.
      </p>
      <div className="not-found-actions">
        <Link to="/">&larr; back to tasks</Link>
      </div>
    </main>
  ),
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="font-body antialiased">
        <Header />
        {children}
        <Footer />
        {import.meta.env.DEV && (
          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[{ name: 'Tanstack Router', render: <TanStackRouterDevtoolsPanel /> }]}
          />
        )}
        <Scripts />
      </body>
    </html>
  )
}
