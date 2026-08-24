import { createHmac } from 'node:crypto'
import { expect, test, type APIResponse } from '@playwright/test'

/**
 * Route-level webhook guard tests — the only specs that hit the real
 * /api/webhooks/stripe endpoint. They verify the flood brake: a burst of
 * requests past the 600/min cap gets 429 + Retry-After, while a single
 * properly-signed event is still acknowledged — the guard is a brake, not a
 * block.
 *
 * Both tests share the server-side `stripe-webhook` bucket, so they run in
 * declaration order within this file: the valid-signature test first (fresh
 * bucket), then the flood (it only asserts 429s, so it is order-independent).
 *
 * The valid-signature test requires STRIPE_WEBHOOK_SECRET on the server and
 * signs with the same secret the CI workflow writes to .env
 * (`whsec_e2e_testing`). When the secret is unset the route answers 501 and
 * the test reports a skip instead of failing; when the server uses a
 * different secret the signature check fails with 401, which stays a hard
 * failure (in CI that would be a real regression).
 */

const SECRET = 'whsec_e2e_testing'

function signedWebhook(payload: object): { body: string; header: string } {
  const body = JSON.stringify(payload)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex')
  return { body, header: `t=${timestamp},v1=${signature}` }
}

test('a single validly-signed webhook is still processed', async ({ request, isMobile }) => {
  test.skip(isMobile, 'server-side contract — a single project run is enough')

  // `invoice.paid` is an unhandled event type: the route acknowledges it with
  // 200 without touching the database, so the test needs no seeded user.
  const { body, header } = signedWebhook({ type: 'invoice.paid', data: { object: {} } })
  const response = await request.post('/api/webhooks/stripe', {
    data: body,
    headers: { 'stripe-signature': header },
  })

  if (response.status() === 501) {
    test.skip(true, 'STRIPE_WEBHOOK_SECRET is not configured on this server')
    return
  }

  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ received: true })
})

test('a flood of webhook requests trips the rate cap with 429 + Retry-After', async ({
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'server-side contract — a single project run is enough')

  // The guard runs before signature verification, so any body exercises the
  // bucket. The cap is a literal 600/min; 650 attempts covers it with
  // headroom for a pre-warmed bucket (the valid-signature test above).
  const send = () => request.post('/api/webhooks/stripe', { data: {} })

  let limited: APIResponse | undefined
  for (let attempt = 0; attempt < 650; attempt += 1) {
    const response = await send()
    if (response.status() === 429) {
      limited = response
      break
    }
  }

  expect(limited, 'the webhook rate cap should trip within 650 attempts').toBeDefined()
  const response = limited!

  await test.step('the 429 carries a Retry-After header for the remaining window', async () => {
    const retryAfter = Number(response.headers()['retry-after'])
    expect(Number.isInteger(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })

  await test.step('the body explains the limit in the standard shape', async () => {
    const responseBody = (await response.json()) as { error?: string }
    expect(responseBody.error).toMatch(/too many requests/i)
  })
})
