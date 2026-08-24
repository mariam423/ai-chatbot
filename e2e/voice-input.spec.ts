import { expect, test, type Route } from '@playwright/test'

/**
 * E2E for the composer mic's MediaRecorder fallback (browsers without the Web
 * Speech API). Headless Chromium has no SpeechRecognition, but to make the
 * engine deterministic we explicitly delete it and stub MediaRecorder +
 * getUserMedia so the component selects the 'record' engine, records a fake
 * clip, POSTs it to /api/transcribe (mocked), and inserts the transcript.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>
    // Force the fallback engine: no Web Speech API.
    delete win.SpeechRecognition
    delete win.webkitSpeechRecognition

    // Minimal MediaRecorder stub: captures a fake blob then fires onstop.
    class FakeMediaRecorder {
      static isTypeSupported(): boolean {
        return true
      }
      mimeType = 'audio/webm;codecs=opus'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onerror: (() => void) | null = null
      onstop: (() => void) | null = null
      start(): void {}
      stop(): void {
        this.ondataavailable?.({ data: new Blob(['fake-audio-bytes'], { type: this.mimeType }) })
        this.onstop?.()
      }
    }
    win.MediaRecorder = FakeMediaRecorder

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => {} }] }),
      },
    })
  })
})

test('records a clip and inserts the transcribed text into the composer', async ({ page }) => {
  await page.route('**/api/transcribe', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transcript: 'Hello from voice input' }),
    }),
  )

  await page.goto('/')

  const mic = page.getByRole('button', { name: 'Voice input' })
  await expect(mic).toBeVisible()

  await test.step('clicking the mic starts recording', async () => {
    await mic.click()
    await expect(page.getByRole('button', { name: 'Stop voice input' })).toBeVisible()
  })

  await test.step('stopping transcribes and fills the composer', async () => {
    await page.getByRole('button', { name: 'Stop voice input' }).click()
    await expect(page.getByLabel('Message')).toHaveValue('Hello from voice input')
    // The mic returns to its idle state.
    await expect(page.getByRole('button', { name: 'Voice input' })).toBeVisible()
  })
})

test('surfaces a transient error pill when transcription fails', async ({ page }) => {
  await page.route('**/api/transcribe', (route: Route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'boom' }),
    }),
  )

  await page.goto('/')
  await page.getByRole('button', { name: 'Voice input' }).click()
  await page.getByRole('button', { name: 'Stop voice input' }).click()

  await test.step('the error pill appears and the composer stays empty', async () => {
    await expect(page.getByRole('status')).toHaveText('Voice transcription failed.')
    await expect(page.getByLabel('Message')).toHaveValue('')
  })
})

test('renders nothing when no voice engine is available', async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>
    delete win.SpeechRecognition
    delete win.webkitSpeechRecognition
    delete win.MediaRecorder
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Voice input' })).toHaveCount(0)
})
