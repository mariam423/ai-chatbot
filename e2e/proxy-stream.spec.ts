import { expect, test } from '@playwright/test'
import { getMaxOutputTokens } from '../lib/llm-config'
import { deltaText, extractSSEEvents, SSE_DONE } from '../lib/sse'

/**
 * The ONLY spec that streams a full chat through the REAL /api/chat proxy
 * (rate-limit.spec also hits the real route, but only with `{}` bodies that
 * 400 at validation — no provider call). Every other spec mocks /api/chat at
 * the browser level. This one proves the server-side contract end to end:
 *
 *   browser/Node -> guard (CSRF/session/rate) -> zod -> provider fetch
 *     -> mock LLM server (e2e/mock-llm-server.mjs) -> SSE passthrough
 *
 * playwright.config.ts points the app at the mock via
 * OPENROUTER_BASE_URL=http://127.0.0.1:4010/v1 + a dummy key, so no live API
 * key or cost is involved. The mock records every chat-completions request
 * body and exposes it at /__last-request, letting the test assert exactly
 * what the server sent the provider (that `max_tokens` lands on the wire).
 *
 * The reply is ~30,500 chars (~7,600 tokens) with a mid marker past the
 * 4096-token default cap and a tail marker at the end — so "the full stream
 * comes back" means both markers survive the real proxy verbatim (the client
 * render/export side of this is pinned by e2e/long-reply-export.spec.ts).
 */

const MOCK_ORIGIN = 'http://127.0.0.1:4010'

// The rate-limit spec exhausts the shared anonymous chat bucket
// (chat:ip:127.0.0.1) by design. This spec uses its own TEST-NET-3 IP via the
// x-forwarded-for header the server already trusts, so its bucket is isolated
// and the test stays deterministic regardless of parallel ordering.
const ISOLATED_IP = '203.0.113.50'

const MARKER_MID = 'MID_MARKER_PAST_THE_DEFAULT_4096_TOKEN_CAP'
const MARKER_TAIL = 'TAIL_MARKER_FINAL_SENTENCE_END'

/** ~4 chars per token heuristic for the 4096-token default boundary. */
const DEFAULT_CAP_CHARS = 4096 * 4

/** Reconstruct the streamed text from a buffered SSE body. */
function decodeSse(body: string): string {
  let text = ''
  let remaining = body
  for (;;) {
    const { events, remaining: rest } = extractSSEEvents(remaining)
    if (events.length === 0) break
    remaining = rest
    for (const event of events) {
      if (event === SSE_DONE) continue
      text += deltaText(event)
    }
  }
  return text
}

test('real /api/chat proxy sends max_tokens and streams the full long reply back', async ({
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'server-side contract — a single project run is enough')

  // Keep the prompt free of tool-intent / structured-output keywords
  // (diagram, chart, weather, schedule, search, …) so the route takes the
  // plain single streaming call instead of the agent loop.
  const prompt = `Proxy round-trip ${Date.now()} — tell me a long story about the open sea.`
  const expectedMaxTokens = getMaxOutputTokens()

  const response = await request.post('/api/chat', {
    headers: { 'x-forwarded-for': ISOLATED_IP },
    data: {
      messages: [{ role: 'user', content: prompt }],
    },
  })
  const last = (await (await request.get(`${MOCK_ORIGIN}/__last-request`)).json()) as {
    body?: {
      model?: string
      stream?: boolean
      max_tokens?: number
      messages?: Array<{ role: string; content: string }>
      tools?: unknown
      response_format?: unknown
    }
  }
  // Graceful skip (same pattern as the webhook spec) for the dev-only case of
  // a reused server on :3000 that is not wired to the mock (no env overrides
  // applied): the request would have gone to the real provider, which is slow
  // and costly. If the mock DID record this request, a non-200 is a real
  // regression and must fail, never skip.
  const reachedMock =
    typeof last?.body?.messages !== 'undefined' && JSON.stringify(last.body).includes(prompt)
  if (response.status() !== 200 && !reachedMock) {
    test.skip(
      true,
      'app server is not wired to the mock LLM (OPENROUTER_BASE_URL) — likely a reused dev server',
    )
    return
  }
  expect(response.status()).toBe(200)

  await test.step('the full stream comes back through the proxy, past the 4096-token default', async () => {
    const body = await response.text()
    // The stream must have terminated properly…
    expect(body).toContain('data: [DONE]')

    const text = decodeSse(body)
    // …and every byte of the long reply must have survived: the mid marker
    // sits past the token cap and the tail marker at the very end. Any
    // truncation at the proxy (e.g. a max_tokens hard-stop or a capped
    // upstream read) would drop one or both.
    expect(text.indexOf(MARKER_MID)).toBeGreaterThan(DEFAULT_CAP_CHARS)
    expect(text.indexOf(MARKER_TAIL)).toBeGreaterThan(text.indexOf(MARKER_MID))
    expect(text.length).toBeGreaterThan(25_000)
  })

  await test.step('the server sent the conservative max_tokens to the provider', async () => {
    // A 200 response means the mock recorded the request (guarded above), so
    // the body is present — assert it to be explicit, then narrow for TS.
    expect(last.body).toBeDefined()
    const body = last.body!

    // The core cost-control contract: an explicit cap is always on the wire,
    // so OpenRouter pre-authorizes a small amount instead of its 65,536
    // default (the cause of 402 Insufficient Balance on low-credit keys).
    expect(body.max_tokens).toBe(expectedMaxTokens)
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.stream).toBe(true)
    expect(body.model?.length ?? 0).toBeGreaterThan(0)

    // Plain streaming path: exactly system + user, no tools / structured
    // response format — proving this was the single non-agent call.
    expect(body.messages?.map((message) => message.role)).toEqual(['system', 'user'])
    expect(body.messages?.at(-1)?.content).toContain(prompt)
    expect(body.tools).toBeUndefined()
    expect(body.response_format).toBeUndefined()
  })
})
