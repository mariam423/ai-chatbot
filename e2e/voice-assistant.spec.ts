import { expect, test } from '@playwright/test'
import { sseBody } from './helpers'

test('reads an assistant response with the browser speech fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>
    class FakeUtterance {
      text: string
      onend: (() => void) | null = null
      onerror: (() => void) | null = null

      constructor(text: string) {
        this.text = text
      }
    }
    const speechSynthesis = {
      cancel: () => undefined,
      speak: (utterance: FakeUtterance) => {
        win.__lastSpeechUtterance = utterance
      },
    }
    win.SpeechSynthesisUtterance = FakeUtterance
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: speechSynthesis,
    })
  })
  await page.route('**/api/speak', (route) => route.fulfill({ status: 503, body: '{}' }))
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody(['This can be spoken aloud.']),
    }),
  )

  await page.goto('/')
  await page.getByLabel('Message').fill('Read this')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('This can be spoken aloud.')).toBeVisible()

  const speak = page.getByRole('button', { name: 'Read response aloud' })
  await speak.click()
  await expect(page.getByRole('button', { name: 'Stop speaking' })).toBeVisible()

  await page.evaluate(() => {
    const utterance = (window as unknown as { __lastSpeechUtterance?: { onend?: () => void } })
      .__lastSpeechUtterance
    utterance?.onend?.()
  })
  await expect(page.getByRole('button', { name: 'Read response aloud' })).toBeVisible()
})
