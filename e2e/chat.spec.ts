import { expect, test, type Page, type Route } from '@playwright/test'
import { THREAD_STORAGE_KEY, THREAD_STORAGE_VERSION } from '../lib/storage'
import { mockStream, sseBody } from './helpers'

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

// The desktop sidebar lists every conversation's title, so unqualified
// getByText could match both a thread bubble and a sidebar entry. Scope
// thread assertions to <main> to keep them unambiguous.
const threadText = (page: Page, text: string | RegExp) => page.locator('main').getByText(text)

test('renders the chat shell with an empty state', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Chatbot' })).toBeVisible()
  await expect(page.getByText(/Ask me anything/)).toBeVisible()
  await expect(page.getByLabel('Message')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
})

test('sends a message and streams the assistant reply', async ({ page }) => {
  await mockStream(page, ['Hello', ' ', 'world!'])

  await page.goto('/')
  await sendMessage(page, 'Hi there')

  await test.step('user bubble appears immediately', async () => {
    await expect(threadText(page, 'Hi there')).toBeVisible()
  })

  await test.step('assistant reply is streamed and rendered', async () => {
    await expect(threadText(page, 'Hello world!')).toBeVisible()
  })
})

test('shows a typing indicator while waiting and stops an in-flight request', async ({ page }) => {
  // Delay the mocked response so the pre-first-token state is observable.
  await page.route('**/api/chat', async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody(['partial reply']),
    })
  })

  await page.goto('/')
  await sendMessage(page, 'Tell me a story')

  await test.step('typing indicator and Stop button appear', async () => {
    await expect(page.getByLabel('Assistant is typing')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  })

  await test.step('stopping clears the indicator without an error', async () => {
    await page.getByRole('button', { name: 'Stop' }).click()
    await expect(page.getByLabel('Assistant is typing')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden()
    await expect(page.getByTestId('chat-error')).toBeHidden()
  })
})

test('surfaces an inline error with retry and recovers', async ({ page }) => {
  let calls = 0
  await page.route('**/api/chat', (route) => {
    calls += 1
    if (calls === 1) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'LLM API error (500).' }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody(['Recovered!']),
    })
  })

  await page.goto('/')
  await sendMessage(page, 'Will this work?')

  await test.step('an alert appears and the message is preserved', async () => {
    await expect(page.getByTestId('chat-error')).toContainText('LLM API error')
    await expect(threadText(page, 'Will this work?')).toBeVisible()
  })

  await test.step('retry succeeds against a healthy upstream', async () => {
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Recovered!')).toBeVisible()
  })
})

test('persists the conversation across a reload (FR-9)', async ({ page }) => {
  await mockStream(page, ['Stored reply'])

  await page.goto('/')
  await sendMessage(page, 'Remember me')
  await expect(page.getByText('Stored reply')).toBeVisible()

  await page.reload()

  await test.step('thread is restored from localStorage', async () => {
    await expect(threadText(page, 'Remember me')).toBeVisible()
    await expect(threadText(page, 'Stored reply')).toBeVisible()
    await expect(threadText(page, /Ask me anything/)).toBeHidden()
  })
})

test('persists the versioned storage payload (FR-9)', async ({ page }) => {
  await mockStream(page, ['Versioned reply'])

  await page.goto('/')
  await sendMessage(page, 'Check payload')
  await expect(threadText(page, 'Versioned reply')).toBeVisible()

  const payload = await page.evaluate((key: string) => {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  }, THREAD_STORAGE_KEY)

  await test.step('payload is the versioned { version, messages } shape', async () => {
    expect(payload).toEqual({
      version: THREAD_STORAGE_VERSION,
      messages: [
        expect.objectContaining({ role: 'user', content: 'Check payload' }),
        expect.objectContaining({ role: 'assistant', content: 'Versioned reply' }),
      ],
    })
  })

  await test.step('every message has an id, a valid role, and string content', async () => {
    const messages = (payload as { messages: Array<{ id: string; role: string; content: string }> })
      .messages
    expect(messages.length).toBe(2)
    for (const message of messages) {
      expect(message.id.length).toBeGreaterThan(0)
      expect(['user', 'assistant']).toContain(message.role)
      expect(typeof message.content).toBe('string')
    }
  })
})

test('clears the conversation and wipes localStorage', async ({ page }) => {
  await mockStream(page, ['Goodbye'])

  await page.goto('/')
  await sendMessage(page, 'Forget me')
  await expect(threadText(page, 'Goodbye')).toBeVisible()

  const clear = page.getByRole('button', { name: 'Clear' })
  await expect(clear).toBeEnabled()
  await clear.click()

  await test.step('thread resets to the empty state', async () => {
    await expect(threadText(page, /Ask me anything/)).toBeVisible()
    await expect(threadText(page, 'Forget me')).toBeHidden()
    await expect(clear).toBeDisabled()
  })

  await test.step('persisted thread is wiped', async () => {
    const raw = await page.evaluate(() => window.localStorage.getItem('chat.messages'))
    expect(raw).not.toContain('Forget me')
  })

  await test.step('a reload stays empty', async () => {
    await page.reload()
    await expect(threadText(page, /Ask me anything/)).toBeVisible()
  })
})

test('keeps Send disabled when input exceeds the max length (4000 chars)', async ({ page }) => {
  await page.goto('/')
  const input = page.getByLabel('Message')
  const send = page.getByRole('button', { name: 'Send' })

  await test.step('exactly 4000 characters is valid', async () => {
    await input.fill('a'.repeat(4000))
    await expect(send).toBeEnabled()
  })

  await test.step('state beyond 4000 keeps Send disabled (guard beyond the HTML clamp)', async () => {
    // The textarea maxLength clamps typing/paste to 4000, so to exercise the
    // isValidMessageInput guard we inject 4001 chars into React state via the
    // native value setter + input event (the standard controlled-input trick).
    await page.evaluate(() => {
      const textarea = document.querySelector('textarea#chat-input') as HTMLTextAreaElement
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, 'b'.repeat(4001))
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(send).toBeDisabled()
  })
})

test('does not send empty or whitespace-only input', async ({ page }) => {
  let requests = 0
  await page.route('**/api/chat', (route) => {
    requests += 1
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody(['x']),
    })
  })

  await page.goto('/')
  const send = page.getByRole('button', { name: 'Send' })
  await expect(send).toBeDisabled()

  await page.getByLabel('Message').fill('   ')
  await expect(send).toBeDisabled()
  await page.getByLabel('Message').press('Enter')

  await expect(send).toBeDisabled()
  expect(requests).toBe(0)
})
