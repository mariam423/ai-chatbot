import type { Page } from '@playwright/test'

/** Build an OpenAI-compatible SSE body that streams the given text chunks. */
export function sseBody(chunks: string[]): string {
  const events = chunks.map(
    (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
  )
  return events.join('') + 'data: [DONE]\n\n'
}

/** Mock /api/chat with a streamed reply so no API key or real LLM is needed. */
export async function mockStream(page: Page, chunks: string[]): Promise<void> {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody(chunks),
    }),
  )
}
