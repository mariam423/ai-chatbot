import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Match the `@/*` path alias from tsconfig so tests can import app
      // modules (e.g. the route's runtime imports) the same way Next does.
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // Unit/integration suites only — Playwright e2e specs live in e2e/
    // and are run by `npm run test:e2e`, not vitest.
    include: ['tests/**/*.test.ts'],
  },
})
