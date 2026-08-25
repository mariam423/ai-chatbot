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
        // Dead slug for the fallback-retry spec: "DeepSeek V4 Flash" resolves
        // to this via its MODEL_* override, the mock 404s it (MOCK_404_SLUG
        // below), and the route retries with the free fallback — which the
        // mock streams. Only that option is affected; every other model
        // resolves normally and the existing specs stay untouched.
        MODEL_DEEPSEEK_V4_FLASH: 'deepseek/deepseek-v4-flash-dead',
      },
    },
    {
      command: 'node e2e/mock-llm-server.mjs',
      url: 'http://127.0.0.1:4010/__health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      // The mock 404s exactly the slug the app server's DeepSeek override
      // resolves to, so e2e/fallback-retry.spec.ts can drive a real dead-model
      // 404 through the full route. Unset on reused servers — the spec skips
      // gracefully when the mock isn't wired this way.
      env: { ...process.env, MOCK_404_SLUG: 'deepseek/deepseek-v4-flash-dead' },
    },
  ],
})
