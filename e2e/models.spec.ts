import { expect, test, type Page, type Route } from '@playwright/test'
import { sseBody } from './helpers'

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

/** Mock /api/chat, capture the request body, and stream a tagged reply. */
async function captureChatRequest(
  page: Page,
  captured: Array<Record<string, unknown>>,
): Promise<void> {
  await page.route('**/api/chat', (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    captured.push(body)
    void route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody(['ok']),
    })
  })
}

test('switching the header model persists locally and is sent with the next request', async ({
  page,
}) => {
  const captured: Array<Record<string, unknown>> = []
  await captureChatRequest(page, captured)

  await page.goto('/')
  const select = page.getByLabel('Select AI model')
  await expect(select).toHaveValue('provider-default')

  await test.step('selecting a model updates the dropdown and localStorage', async () => {
    await select.selectOption('qwen-3-6')
    await expect(select).toHaveValue('qwen-3-6')
    const stored = await page.evaluate(() => localStorage.getItem('chat.model'))
    expect(stored).toBe('qwen-3-6')
  })

  await test.step('the chat request carries the chosen model key', async () => {
    // NB: keep "model" out of the message text — the a11y drawer spec finds
    // the theme toggle via a /mode/ name regex, and session titles appear in
    // the drawer list, so a matching title would break that test.
    await sendMessage(page, 'Which AI am I using?')
    await expect(page.locator('main').getByText('ok')).toBeVisible()
    expect(captured.length).toBeGreaterThan(0)
    expect(captured.at(-1)!.model).toBe('qwen-3-6')
  })

  await test.step('the selection survives a reload', async () => {
    await page.reload()
    await expect(page.getByLabel('Select AI model')).toHaveValue('qwen-3-6')
  })
})

test('the model selector renders every available model option', async ({ page }) => {
  await page.goto('/')
  const select = page.getByLabel('Select AI model')
  await select.click()
  const options = await select.locator('option').allTextContents()
  expect(options).toContain('Provider default')
  expect(options).toContain('Qwen 3.6')
  expect(options).toContain('DeepSeek V4 Flash')
  expect(options).toContain('Kimi K3')
  expect(options).toContain('GPT-5.6')
})
