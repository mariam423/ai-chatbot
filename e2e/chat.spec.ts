import { expect, test, type Page, type Route } from '@playwright/test'
import { THREAD_STORAGE_KEY, THREAD_STORAGE_VERSION } from '../lib/storage'
import { mockStream, sseBody } from './helpers'

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

// The desktop sidebar lists every conversation's title and the header shows
// the active session's title as conversation metadata, so unqualified getByText
// could match a thread bubble, a sidebar entry, or the header. Scope thread
// assertions to the message list to keep them unambiguous.
const threadText = (page: Page, text: string | RegExp) =>
  page.getByTestId('message-list').getByText(text)

test('renders the chat shell with an empty state', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Chatbot' })).toBeVisible()
  await expect(page.getByText(/Ask me anything/)).toBeVisible()
  await expect(page.getByLabel('Message')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
})

test('hides the per-message captions when the user disabled them in settings', async ({ page }) => {
  // getUserPreferences runs as a server action on mount. Intercept its
  // response (Next flight encoding: `0:…\n1:{"ok":true,"data":{…}}`) and flip
  // showModelCaptions to false — the client path (chat-app reads the
  // preference → Chat gates the caption) is then exercised end to end.
  await page.route('**/*', async (route) => {
    const request = route.request()
    // Only touch the getUserPreferences server action. Its POST carries an
    // encrypted next-action header (the body doesn't name the function), so
    // identify it by its response: the flight-encoded data object with
    // displayName is unique to getUserPreferences.
    const isServerAction = request.method() === 'POST' && Boolean(request.headers()['next-action'])
    if (!isServerAction) {
      await route.continue()
      return
    }
    try {
      const response = await route.fetch()
      const raw = await response.text()
      const body = raw.includes('"displayName"')
        ? raw.replace('"showModelCaptions":true', '"showModelCaptions":false')
        : raw
      await route.fulfill({
        status: response.status(),
        contentType: 'text/x-component',
        body,
      })
    } catch {
      // The route's response can be disposed when the test tears down while
      // a server-action request is still in flight — the interception is
      // best-effort and the assertion below is what matters.
      await route.continue().catch(() => undefined)
    }
  })
  // Mock the reply with the route's X-Served-Model header so a caption WOULD
  // render if the preference were on.
  await page.route('**/api/chat', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'x-served-model': 'stealth/ox-alpha', 'x-served-model-overridden': 'true' },
      body: sseBody(['Hidden caption reply']),
    }),
  )

  await page.goto('/')
  await sendMessage(page, 'Toggle check')
  await expect(threadText(page, 'Hidden caption reply')).toBeVisible()

  await test.step('no caption renders for the stamped reply', async () => {
    await expect(page.getByTestId('served-model')).toHaveCount(0)
  })
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

test('shows the served model caption from the X-Served-Model header', async ({ page }) => {
  // Mock /api/chat with the route's X-Served-Model header so the client-side
  // "via <model>" caption can be asserted end to end.
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'x-served-model': 'stealth/ox-alpha' },
      body: sseBody(['Served by the fallback model.']),
    }),
  )

  await page.goto('/')
  await sendMessage(page, 'Hi there')

  await test.step('reply streams and the served-model caption appears', async () => {
    await expect(threadText(page, 'Served by the fallback model.')).toBeVisible()
    await expect(page.getByTestId('served-model')).toContainText('stealth/ox-alpha')
  })

  await test.step('no override flag → the caption stays neutral (no fallback tag)', async () => {
    // The mock doesn't set X-Served-Model-Overridden, so the caption must not
    // carry the amber warning state.
    await expect(page.getByTestId('served-model')).not.toHaveAttribute('data-overridden', 'true')
    await expect(page.getByTestId('served-model')).not.toContainText('fallback')
  })

  await test.step('each reply carries its own caption', async () => {
    await sendMessage(page, 'And again')
    // The mock replies with the same header, so the second reply stamps its
    // own caption too — one per assistant message, never duplicated.
    await expect(page.getByTestId('served-model')).toHaveCount(2)
  })
})

test('renders the served-model caption as an amber warning when the model was overridden', async ({
  page,
}) => {
  // Mock a fallback swap: the served model differs from the selection and the
  // route flags it via X-Served-Model-Overridden.
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'x-served-model': 'stealth/ox-alpha', 'x-served-model-overridden': 'true' },
      body: sseBody(['Served by the fallback.']),
    }),
  )

  await page.goto('/')
  await sendMessage(page, 'Hi there')

  await test.step('caption carries the amber warning state and fallback tag', async () => {
    await expect(threadText(page, 'Served by the fallback.')).toBeVisible()
    const caption = page.getByTestId('served-model')
    await expect(caption).toContainText('stealth/ox-alpha')
    await expect(caption).toHaveAttribute('data-overridden', 'true')
    await expect(caption).toContainText('fallback')
  })

  await test.step('the served model survives a reload (DB restore)', async () => {
    await page.reload()
    await expect(threadText(page, 'Served by the fallback.')).toBeVisible()
    // The model + override flag round-trip through the DB-backed restore.
    const caption = page.getByTestId('served-model')
    await expect(caption).toHaveCount(1)
    await expect(caption).toContainText('stealth/ox-alpha')
    await expect(caption).toHaveAttribute('data-overridden', 'true')
    await expect(caption).toContainText('fallback')
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

  await test.step('payload is the versioned { version, branches, active } shape', async () => {
    expect(payload).toEqual({
      version: THREAD_STORAGE_VERSION,
      branches: [
        [
          expect.objectContaining({ role: 'user', content: 'Check payload' }),
          expect.objectContaining({ role: 'assistant', content: 'Versioned reply' }),
        ],
      ],
      active: 0,
    })
  })

  await test.step('every message has an id, a valid role, and string content', async () => {
    const branches = (
      payload as {
        branches: Array<Array<{ id: string; role: string; content: string }>>
      }
    ).branches
    expect(branches.length).toBe(1)
    const messages = branches[0]!
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
