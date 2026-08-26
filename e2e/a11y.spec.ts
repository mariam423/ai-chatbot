import { expect, test, type Locator, type Page } from '@playwright/test'
import { mockStream } from './helpers'

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

/**
 * Assert a keyboard-focused element shows a visible focus indicator
 * (WCAG 2.4.7). The app styles `:focus-visible { outline: 2px solid
 * currentColor }` and `:focus { outline: none }`, so a REAL Tab press is
 * required for :focus-visible to match — locator.focus() would not.
 */
async function expectVisibleFocusRing(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused()
  const hasRing = await locator.evaluate((el) => {
    const style = getComputedStyle(el)
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
  })
  expect(hasRing, 'expected a visible focus ring on the focused element').toBe(true)
}

test.describe('accessibility', () => {
  test('desktop sidebar is keyboard navigable with visible focus rings', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile)

    await mockStream(page, ['A11y reply'])
    await page.goto('/')
    await sendMessage(page, 'A11y question')
    await expect(page.getByTestId('message-list').getByText('A11y reply')).toBeVisible()

    const sidebar = page.getByRole('complementary', { name: 'Conversations' })
    const skipLink = page.getByRole('link', { name: 'Skip to content' })
    const newChat = sidebar.getByRole('button', { name: 'New Chat' })
    const searchInput = sidebar.getByRole('searchbox', { name: 'Search conversations' })
    // Newest-first order (listChatSessions), so the first entry is the
    // session just created — and it is the active one. The sidebar now has
    // a collapse toggle button at the top, so use a specific selector.
    const firstSession = sidebar.getByRole('button', { name: /A11y question/ }).first()
    await expect(firstSession).toContainText('A11y question')
    await expect(firstSession).toHaveAttribute('aria-current', 'page')

    // The DB save is fire-and-forget; wait until the session shows up in the
    // sidebar (proof listChatSessions saw it) before reloading, or the reload
    // cancels the in-flight save.
    await expect(sidebar.getByRole('button', { name: /A11y question/ }).first()).toBeVisible()

    // Reload so the keyboard walk starts from a fresh document — after any
    // interaction, Chromium absorbs the first Tab press into <body>. The
    // active session must survive the reload.
    await page.reload()
    await expect(page.getByTestId('message-list').getByText('A11y question')).toBeVisible()
    await expect(firstSession).toHaveAttribute('aria-current', 'page')

    const collapseToggle = sidebar.getByRole('button', { name: 'Collapse sidebar' })
    const taskButtons = ['Inbox', 'Build workspace', 'Launch checklist'].map((name) =>
      sidebar.getByRole('button', { name, exact: true }),
    )
    const createTask = sidebar.getByRole('button', { name: 'Create task' })
    // The Archive toggle sits between the search box and the session list in
    // DOM/tab order, after the new workspace task controls.
    const archiveToggle = sidebar.getByRole('button', { name: 'Archive' })

    await test.step('Tab walks through workspace tasks, chat controls, and the first session', async () => {
      await page.keyboard.press('Tab')
      await expectVisibleFocusRing(skipLink)
      await page.keyboard.press('Tab')
      await expectVisibleFocusRing(collapseToggle)
      await page.keyboard.press('Tab')
      await expectVisibleFocusRing(createTask)
      for (const taskButton of taskButtons) {
        await page.keyboard.press('Tab')
        await expectVisibleFocusRing(taskButton)
      }
      await page.keyboard.press('Tab')
      await expectVisibleFocusRing(newChat)
      await page.keyboard.press('Tab')
      await expectVisibleFocusRing(searchInput)
      await page.keyboard.press('Tab')
      await expectVisibleFocusRing(archiveToggle)
      await page.keyboard.press('Tab')
      await expectVisibleFocusRing(firstSession)
    })

    await test.step('Shift+Tab walks back through the workspace controls', async () => {
      await page.keyboard.press('Shift+Tab')
      await expect(archiveToggle).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(searchInput).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(newChat).toBeFocused()
      for (const taskButton of [...taskButtons].reverse()) {
        await page.keyboard.press('Shift+Tab')
        await expect(taskButton).toBeFocused()
      }
      await page.keyboard.press('Shift+Tab')
      await expect(createTask).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(collapseToggle).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(skipLink).toBeFocused()
    })
  })

  test('the active session carries aria-current and it moves on switch', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile)

    await mockStream(page, ['A11y reply'])
    await page.goto('/')
    await sendMessage(page, 'A11y question')
    await expect(page.getByTestId('message-list').getByText('A11y reply')).toBeVisible()

    const sidebar = page.getByRole('complementary', { name: 'Conversations' })
    const activeMarkers = sidebar.locator('[aria-current="page"]')

    await test.step('exactly one session is marked active', async () => {
      await expect(activeMarkers).toHaveCount(1)
      await expect(sidebar.getByRole('button', { name: /A11y question/ }).first()).toHaveAttribute(
        'aria-current',
        'page',
      )
    })

    await test.step('New Chat clears the active marker', async () => {
      await sidebar.getByRole('button', { name: 'New Chat' }).click()
      await expect(activeMarkers).toHaveCount(0)
    })

    await test.step('selecting a session re-marks it active', async () => {
      await sidebar
        .getByRole('button', { name: /A11y question/ })
        .first()
        .click()
      await expect(activeMarkers).toHaveCount(1)
      await expect(sidebar.getByRole('button', { name: /A11y question/ }).first()).toHaveAttribute(
        'aria-current',
        'page',
      )
    })
  })

  test('mobile drawer traps focus and returns it to the trigger on close', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile)

    await page.goto('/')
    const trigger = page.getByRole('button', { name: 'Open conversation list' })
    await trigger.click()

    const dialog = page.getByRole('dialog', { name: 'Conversations' })
    await expect(dialog).toBeFocused()

    const close = dialog.getByRole('button', { name: 'Close conversation list' })
    const theme = dialog.getByRole('button', { name: /mode/ })

    await test.step('Shift+Tab from the first focusable wraps to the last', async () => {
      await close.focus()
      await page.keyboard.press('Shift+Tab')
      await expect(theme).toBeFocused()
    })

    await test.step('Tab from the last focusable wraps to the first', async () => {
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()
    })

    await test.step('Escape closes and focus returns to the trigger', async () => {
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(trigger).toBeFocused()
    })
  })
})
