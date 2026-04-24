export const SITE = {
  title: 'paper2eval',
  description: 'RLVR task browser — browse, inspect, and observe evaluation environments.',
  repo: 'github.com/hclimb/paper2eval-ui',
} as const

// Vite replaces __BUILD_DATE__ at bundle time (see vite.config.ts `define`).
// Falls back to runtime ISO date so the footer always renders something.
declare const __BUILD_DATE__: string | undefined
export const BUILD_DATE: string =
  typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : new Date().toISOString().slice(0, 10)
