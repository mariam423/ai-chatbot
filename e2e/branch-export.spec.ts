import { expect, test, type Download, type Page } from '@playwright/test'
import { sseBody } from './helpers'

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

const threadText = (page: Page, text: string | RegExp) =>
  page.getByTestId('message-list').getByText(text)

/**
 * Mock /api/chat to echo the last user message, so a regeneration (edit fork)
 * produces a distinct reply we can assert.
 */
async function mockEcho(page: Page): Promise<void> {
  await page.route('**/api/chat', async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as {
      messages?: Array<{ role: string; content: string }>
    }
    const lastUser =
      [...(body.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? ''
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      // The route's real X-Served-Model header — every reply is stamped with
      // the model that served it, and the exports must carry it.
      headers: { 'x-served-model': 'stealth/ox-alpha', 'x-served-model-overridden': 'true' },
      body: sseBody([`echo: ${lastUser}`]),
    })
  })
}

/** Read a downloaded file's contents (Playwright gives a stream, not text). */
async function readDownload(download: Download): Promise<string> {
  const stream = await download.createReadStream()
  if (!stream) return ''
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

test('editing a past prompt forks a branch and lets the user toggle versions', async ({ page }) => {
  await mockEcho(page)
  await page.goto('/')
  await sendMessage(page, 'alpha')
  await expect(threadText(page, 'echo: alpha')).toBeVisible()

  // The edit button is on the user bubble (opacity-0 until hover, still clickable).
  await page.getByRole('button', { name: 'Edit prompt' }).click()
  await page.getByLabel('Edit prompt text').fill('beta')
  await page.getByRole('button', { name: 'Save edit' }).click()

  await test.step('a regenerated reply appears on the new branch', async () => {
    await expect(threadText(page, 'echo: beta')).toBeVisible()
  })

  await test.step('the branch switcher now shows two versions and V2 is active', async () => {
    await expect(page.getByLabel('Show version 1')).toBeVisible()
    await expect(page.getByLabel('Show version 2')).toHaveAttribute('aria-pressed', 'true')
  })

  await test.step('toggling back to V1 restores the original thread (context preserved)', async () => {
    await page.getByLabel('Show version 1').click()
    await expect(threadText(page, 'echo: alpha')).toBeVisible()
    await expect(threadText(page, 'echo: beta')).toBeHidden()
  })

  await test.step('toggling forward to V2 shows the edited thread again', async () => {
    await page.getByLabel('Show version 2').click()
    await expect(threadText(page, 'echo: beta')).toBeVisible()
  })
})

test('exports the chat as Markdown and JSON downloads', async ({ page }) => {
  await mockEcho(page)
  await page.goto('/')

  await test.step('export is disabled with an empty thread', async () => {
    await expect(page.getByRole('button', { name: 'Export chat' })).toBeDisabled()
  })

  await sendMessage(page, 'export me')
  await expect(threadText(page, 'echo: export me')).toBeVisible()

  const exportButton = page.getByRole('button', { name: 'Export chat' })
  await expect(exportButton).toBeEnabled()

  await test.step('Markdown download fires with a .md file carrying the served model', async () => {
    const downloadPromise = page.waitForEvent('download')
    await exportButton.click()
    await page.getByRole('menuitem', { name: 'Markdown (.md)' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.md$/)
    const md = await readDownload(download)
    // The assistant reply's model stamp (with the amber-warning fallback tag)
    // rides into the transcript under its heading.
    expect(md).toContain('*via stealth/ox-alpha (fallback)*')
    expect(md).toContain('echo: export me')
  })

  await test.step('JSON download fires with a .json file carrying the served model', async () => {
    const downloadPromise = page.waitForEvent('download')
    await exportButton.click()
    await page.getByRole('menuitem', { name: 'JSON (.json)' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.json$/)
    const parsed = JSON.parse(await readDownload(download)) as {
      messages: Array<{ role: string; content: string; model?: string; modelOverridden?: boolean }>
    }
    const assistant = parsed.messages.find((m) => m.role === 'assistant')
    expect(assistant?.model).toBe('stealth/ox-alpha')
    expect(assistant?.modelOverridden).toBe(true)
  })
})

test('export menu offers all three formats and PDF renders the transcript', async ({ page }) => {
  await mockEcho(page)
  await page.goto('/')
  await sendMessage(page, 'make me a pdf')
  await expect(threadText(page, 'echo: make me a pdf')).toBeVisible()

  const exportButton = page.getByRole('button', { name: 'Export chat' })
  await exportButton.click()

  await test.step('menu lists Markdown, JSON, and PDF (print)', async () => {
    await expect(page.getByRole('menuitem', { name: 'Markdown (.md)' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'JSON (.json)' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'PDF (print)' })).toBeVisible()
  })

  await test.step('PDF writes the styled transcript into the hidden print iframe', async () => {
    await page.getByRole('menuitem', { name: 'PDF (print)' }).click()
    const frame = page.frameLocator('iframe[title="Export preview"]')
    await expect(frame.locator('h1')).toHaveText('make me a pdf')
    await expect(frame.locator('section.turn')).toHaveCount(2)
    await expect(frame.locator('section.turn').first()).toContainText('You')
    await expect(frame.locator('section.turn').nth(1)).toContainText('echo: make me a pdf')
  })
})
