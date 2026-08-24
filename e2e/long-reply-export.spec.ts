import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { sseBody } from './helpers'

/**
 * The chat route always sends an explicit conservative `max_tokens` (4096 by
 * default — see lib/llm-config.ts) so OpenRouter pre-authorizes a small
 * amount instead of its 65,536 default, which 402s low-credit keys. This spec
 * pins the CLIENT-side contract around that change: a streamed reply much
 * longer than the default cap must be preserved end-to-end — SSE parse →
 * streaming accumulator → Markdown render → Markdown/JSON export →
 * localStorage persistence — with no truncation at any layer. If anything
 * starts capping content at ~4096 tokens (~16,384 chars), the mid-reply and
 * tail markers below will be missing from the exported file.
 */

const MARKER_MID = 'MID_MARKER_PAST_THE_DEFAULT_4096_TOKEN_CAP'
const MARKER_TAIL = 'TAIL_MARKER_FINAL_SENTENCE_END'

/** ~4 chars per token heuristic for the 4096-token default boundary. */
const DEFAULT_CAP_CHARS = 4096 * 4

const filler = (n: number, tag: string): string =>
  Array.from(
    { length: n },
    (_, i) =>
      `${tag} paragraph ${i}: the quick brown fox jumps over the lazy dog while the stream keeps flowing far past the token budget of the conservative default.`,
  ).join('\n\n')

/**
 * A reply of ~30,500 chars (~7,600 tokens — well beyond the 4096 default):
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

const threadText = (page: Page, text: string | RegExp) => page.locator('main').getByText(text)

async function exportedMarkdown(page: Page): Promise<string> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export chat' }).click()
  await page.getByRole('menuitem', { name: 'Markdown (.md)' }).click()
  const download = await downloadPromise
  const filePath = await download.path()
  return readFileSync(filePath!, 'utf8')
}

test('exports a reply longer than the 4096-token default without truncation', async ({ page }) => {
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

  await test.step('Markdown export preserves the content beyond the 4096-token cap', async () => {
    const md = await exportedMarkdown(page)
    // The mid marker must appear past the token cap, and the tail marker at
    // the very end — any truncation at ~4096 tokens would drop both.
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
