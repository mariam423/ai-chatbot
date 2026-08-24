import { expect, test, type APIResponse } from '@playwright/test'

/**
 * Rate-cap contract test — the ONLY spec in the suite that hits the real
 * /api/chat endpoint (every other spec mocks it). It verifies the server-side
 * guard: once the chat bucket is exhausted, requests return 429 with a
 * Retry-After header.
 *
 * The suite runs with AUTH_DISABLED=true (see .env.example), so the session
 * guard yields no user id and the bucket falls back to the client IP — the
 * same guardRoute code path a signed-in user's `chat:user:<id>` bucket takes,
 * and the identical 429 contract. Per-user bucket isolation is covered by
 * unit tests (tests/security.test.ts).
 *
 * The loop sends `{}` bodies: the body fails zod validation (400) before any
 * provider work, so no real LLM request is ever made even when a key is
 * configured — only the guard + validation run per attempt.
 */
test('rate-caps /api/chat with 429 + Retry-After once the limit is hit', async ({
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'server-side contract — a single project run is enough')

  const send = () => request.post('/api/chat', { data: {} })

  // Keep trying until the limiter trips. The configured cap is
  // CHAT_RATE_LIMIT (default 120/min); 600 attempts covers generous overrides.
  let limited: APIResponse | undefined
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await send()
    if (response.status() === 429) {
      limited = response
      break
    }
  }

  expect(limited, 'the chat rate cap should trip within 600 attempts').toBeDefined()
  const response = limited!

  await test.step('the 429 carries a Retry-After header for the remaining window', async () => {
    const retryAfter = Number(response.headers()['retry-after'])
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })

  await test.step('the body explains the limit in the standard shape', async () => {
    const body = (await response.json()) as { error?: string }
    expect(body.error).toMatch(/too many requests/i)
  })
})
