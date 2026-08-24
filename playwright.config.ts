import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  // Run against the production build: no dev-mode overlays (which can
  // intercept pointer events) and no StrictMode double-rendering, matching
  // what users actually get.
  webServer: [
    {
      command: 'npm run build && npm run start',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // Point the REAL /api/chat proxy at the local mock LLM server below so
      // e2e/proxy-stream.spec.ts can exercise the full route (guard -> zod ->
      // provider fetch -> SSE passthrough) without a live key or cost. These
      // override any .env / .env.local values: dotenv never overwrites an
      // existing process env var. Every other spec mocks /api/chat at the
      // browser level, so they are unaffected.
      env: {
        ...process.env,
        OPENROUTER_API_KEY: 'e2e-test-key',
        OPENROUTER_BASE_URL: 'http://127.0.0.1:4010/v1',
      },
    },
    {
      command: 'node e2e/mock-llm-server.mjs',
      url: 'http://127.0.0.1:4010/__health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
