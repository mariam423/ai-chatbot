import { expect, test, type Page } from '@playwright/test'

/**
 * The ONLY spec (besides proxy-stream) that drives a real LLM call through the
 * actual /api/chat route: it exercises the 404 error-fallback retry end to end
 * with the browser UI as the client.
 *
 * Wiring (playwright.config.ts):
 *  - the app server's env sets MODEL_DEEPSEEK_V4_FLASH=deepseek/deepseek-v4-flash-dead,
 *    so the "DeepSeek V4 Flash" selector resolves to a genuinely dead slug;
 *  - the mock LLM server's env sets MOCK_404_SLUG to that same slug, so it
 *    404s exactly that model while streaming every other one.
 *
 * Flow: the browser selects DeepSeek V4 Flash and sends a message. The real
 * route posts the dead slug to the mock → 404 → the per-provider fallback
 * retry fires with the free `stealth/ox-alpha` (the OpenRouter default backup)
 * → the mock streams the reply. The response's X-Served-Model /
 * X-Served-Model-Overridden headers drive the amber "fallback" caption in the
 * thread, and the mock's /__requests log proves the two-call sequence.
 *
 * The page context pins its own x-forwarded-for so the request rides an
 * isolated rate-limit bucket — rate-limit.spec exhausts the shared anonymous
 * bucket (`chat:ip:unknown`) by design, and this spec must stay deterministic
 * regardless of parallel ordering.
 */
const MOCK_ORIGIN = 'http://127.0.0.1:4010'
const DEAD_SLUG = 'deepseek/deepseek-v4-flash-dead'
const FALLBACK_SLUG = 'stealth/ox-alpha'
const ISOLATED_IP = '203.0.113.70'

const threadText = (page: Page, text: string | RegExp) =>
  page.getByTestId('message-list').getByText(text)

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('real route retries a 404 with the fallback model and the UI shows the amber caption', async ({
  context,
  page,
  request,
}) => {
  // Isolate the rate-limit bucket (see header note above).
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': ISOLATED_IP })

  // Confirm the mock is wired for the 404 before spending the run: a reused
  // dev server (no env overrides) would send the dead slug to the real
  // provider instead, so the whole flow would be moot. If it IS wired, any
  // non-200 is a real regression and must fail, never skip.
  const health = (await (await request.get(`${MOCK_ORIGIN}/__health`)).json()) as { ok?: boolean }
  const mockWired = health?.ok === true
  // The mock's request log is shared across the suite and prior runs — reset
  // it so this spec asserts exactly the requests it triggers (parallel specs
  // may post other chats while this one runs).
  await request.post(`${MOCK_ORIGIN}/__reset`)

  await page.goto('/')

  await test.step('select the model that resolves to the dead slug', async () => {
    await page.getByLabel('Select AI model').selectOption('deepseek-v4-flash')
    await expect(page.getByLabel('Select AI model')).toHaveValue('deepseek-v4-flash')
  })

  await test.step('send through the REAL route (no browser mock)', async () => {
    await sendMessage(page, 'Tell me a story about the deep sea')
  })

  await test.step('the reply streams and the amber caption names the served model', async () => {
    // Wait for the streamed reply first — this blocks until the route has
    // done the dead-slug 404 and the fallback retry, so the mock's request
    // log is guaranteed complete when the next step reads it.
    await expect(threadText(page, /Retried with the fallback/)).toBeVisible()
    const caption = page.getByTestId('served-model')
    await expect(caption).toContainText(FALLBACK_SLUG)
    await expect(caption).toHaveAttribute('data-overridden', 'true')
    await expect(caption).toContainText('fallback')
  })

  await test.step('the mock 404s the dead slug, then streams the fallback', async () => {
    const all = (await (await request.get(`${MOCK_ORIGIN}/__requests`)).json()) as Array<{
      model?: string
    }>
    const models = (all ?? []).map((entry) => entry.model)
    if (!mockWired) {
      // The route can't have hit the mock at all — the fallback chain never
      // ran. Skip rather than fail (the webhook/proxy specs use the same
      // graceful pattern for reused dev servers).
      test.skip(true, 'mock LLM is not wired for the 404 (reused server without env overrides)')
      return
    }
    // Exactly two upstream calls: the dead selection first, then the backup.
    expect(models).toEqual([DEAD_SLUG, FALLBACK_SLUG])
  })

  await test.step('the served model and override flag persist to the DB (reload)', async () => {
    await page.reload()
    await expect(threadText(page, /Retried with the fallback/)).toBeVisible()
    const caption = page.getByTestId('served-model')
    await expect(caption).toHaveCount(1)
    await expect(caption).toContainText(FALLBACK_SLUG)
    await expect(caption).toHaveAttribute('data-overridden', 'true')
    await expect(caption).toContainText('fallback')
  })
})
