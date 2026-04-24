import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Shiki loads its WASM highlighter on first use (~2s). Cold-start of each
    // test file that transitively loads markdown.ts hits this. 10s gives headroom.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
})
