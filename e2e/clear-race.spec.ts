import { expect, test } from '@playwright/test'
import { sseBody } from './helpers'

/**
 * Regression test for the slow-save race: sending the FIRST message fires
 * `persistToDb` with `sessionId` still null, and if the user clicks New Chat
 * before that save resolves, the thread must clear immediately AND stay clear
 * once the save lands — a stale `onSessionChange(sid)` publish (or a restore
 * effect keyed on a sessionId that never changed) must not resurrect it.
 *
 * The delay is injected on the server action itself: `saveChatMessages` is the
 * Next.js action POST whose payload contains `"branches"` (getChatSession and
 * listChatSessions have different shapes), so only the slow path is throttled.
 */
test('New Chat during a slow first save still clears the thread', async ({ page, isMobile }) => {
  const SAVE_DELAY = 2500

  // Delay saveChatMessages by SAVE_DELAY ms; every other request passes through.
  await page.route('**/*', async (route) => {
    const request = route.request()
    const isSaveAction =
      request.method() === 'POST' &&
      Boolean(request.headers()['next-action']) &&
      (request.postData() ?? '').includes('"branches"')
    if (isSaveAction) {
      await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY))
    }
    await route.continue()
  })

  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody(['Reply that must not survive New Chat.']),
    }),
  )

  // Unique title: the shared e2e DB accumulates sessions across runs, and a
  // title containing "message" would collide with `getByLabel('Message')`
  // (case-insensitive substring match) in other specs' strict-mode locators.
  const sessionTitle = `Slow save ${Date.now()}`

  await page.goto('/')
  await page.getByLabel('Message').fill(sessionTitle)
  await page.getByRole('button', { name: 'Send' }).click()

  // Streamed reply is on screen; saveChatMessages is still in flight.
  await expect(
    page.locator('main').getByText('Reply that must not survive New Chat.'),
  ).toBeVisible()

  // New Chat while the first save is unresolved (sessionId is still null).
  const newChat = isMobile
    ? page.getByRole('button', { name: 'Start a new chat' })
    : page.getByRole('button', { name: 'New Chat' })
  await newChat.click()

  // The thread clears immediately — no waiting on the delayed save.
  await expect(page.getByText(/Ask me anything/)).toBeVisible()
  await expect(page.locator('main').getByText('Reply that must not survive New Chat.')).toHaveCount(
    0,
  )

  // Wait past the delayed save resolving; the stale publish must NOT bring the
  // cleared conversation back onto the screen.
  await page.waitForTimeout(SAVE_DELAY + 750)
  await expect(page.getByText(/Ask me anything/)).toBeVisible()
  await expect(page.locator('main').getByText('Reply that must not survive New Chat.')).toHaveCount(
    0,
  )
})
