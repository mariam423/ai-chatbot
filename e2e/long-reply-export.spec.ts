import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { sseBody } from './helpers'

/**
 * The chat route never lets a reply be cut short server-side: every provider
 * request carries the small 200-token conservative max_tokens cap (see
 * lib/llm-config.ts resolveMaxTokens) — but the client must render and export
 * the FULL streamed reply no matter what the provider caps. This spec pins
 * that CLIENT-side contract: a streamed reply much longer than the default
 * cap must be preserved end-to-end — SSE parse → streaming accumulator →
 * Markdown render → Markdown/JSON export → localStorage persistence — with no
 * truncation at any layer. If anything starts capping content at ~200 tokens
 * (~800 chars), the mid-reply and tail markers below will be missing from the
 * exported file.
 */

const MARKER_MID = 'MID_MARKER_PAST_THE_DEFAULT_200_TOKEN_CAP'
const MARKER_TAIL = 'TAIL_MARKER_FINAL_SENTENCE_END'

/** ~4 chars per token heuristic for the 200-token default boundary. */
const DEFAULT_CAP_CHARS = 200 * 4

const filler = (n: number, tag: string): string =>
  Array.from(
    { length: n },
    (_, i) =>
      `${tag} paragraph ${i}: the quick brown fox jumps over the lazy dog while the stream keeps flowing far past the token budget of the conservative default.`,
  ).join('\n\n')

/**
 * A reply of ~30,500 chars (~7,600 tokens — well beyond the 200 default):
 * the first filler block alone (~18,300 chars) crosses the default cap, so
 * MARKER_MID sits past the boundary and MARKER_TAIL at the very end.
 */
function longReply(): string {
  return [
    'Here is a deliberately very long answer.',
    filler(150, 'Opening'),
    MARKER_MID,
    filler(100, 'Middle'),
    MARKER_TAIL,
  ].join('\n\n')
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

const threadText = (page: Page, text: string | RegExp) =>
  page.getByTestId('message-list').getByText(text)

async function exportedMarkdown(page: Page): Promise<string> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export chat' }).click()
  await page.getByRole('menuitem', { name: 'Markdown (.md)' }).click()
  const download = await downloadPromise
  const filePath = await download.path()
  return readFileSync(filePath!, 'utf8')
}

test('exports a reply longer than the 200-token default without truncation', async ({ page }) => {
  const reply = longReply()
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody([reply.slice(0, 12_000), reply.slice(12_000)]),
    }),
  )
  await page.goto('/')
  // Unique title so the session this test creates never collides with the
  // sidebar items other specs assert against (same convention as sidebar.spec).
  const prompt = `Export long reply ${Date.now()}`
  await sendMessage(page, prompt)
  await expect(threadText(page, MARKER_TAIL)).toBeVisible()

  await test.step('the whole reply renders in the thread, not just the head', async () => {
    await expect(threadText(page, MARKER_MID)).toBeVisible()
  })

  await test.step('Markdown export preserves the content beyond the 200-token cap', async () => {
    const md = await exportedMarkdown(page)
    // The mid marker must appear past the token cap, and the tail marker at
    // the very end — any truncation at ~200 tokens would drop both.
    expect(md.indexOf(MARKER_MID)).toBeGreaterThan(DEFAULT_CAP_CHARS)
    expect(md.indexOf(MARKER_TAIL)).toBeGreaterThan(md.indexOf(MARKER_MID))
    expect(md).toContain(prompt)
    expect(md.length).toBeGreaterThan(25_000)
  })

  await test.step('JSON export carries the full content too', async () => {
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export chat' }).click()
    await page.getByRole('menuitem', { name: 'JSON (.json)' }).click()
    const download = await downloadPromise
    const filePath = await download.path()
    expect(readFileSync(filePath!, 'utf8')).toContain(MARKER_TAIL)
  })

  await test.step('the full reply survives a reload (persistence round-trip)', async () => {
    await page.reload()
    await expect(threadText(page, MARKER_TAIL)).toBeVisible()
    const md = await exportedMarkdown(page)
    expect(md.indexOf(MARKER_MID)).toBeGreaterThan(DEFAULT_CAP_CHARS)
    expect(md.indexOf(MARKER_TAIL)).toBeGreaterThan(md.indexOf(MARKER_MID))
  })
})
