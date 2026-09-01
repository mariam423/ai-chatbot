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
    // Default `DATABASE_URL` for any test that doesn't set its own.
    // lib/db.ts throws at import time when the env var is unset, and many
    // tests transitively import the auth chain; setting a placeholder in
    // setupFiles lets the import succeed and individual tests can
    // override (e.g. tests/actions.test.ts provisions a real SQLite DB).
    setupFiles: ['./tests/setup.ts'],
  },
})
