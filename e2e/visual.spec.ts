import { expect, test, type Page } from '@playwright/test'
import { mockStream } from './helpers'

/**
 * Helper: force the theme to a specific mode and navigate to the app.
 * Uses the same mechanism the sidebar toggle uses — flipping the .dark
 * class on <html> and persisting to localStorage.
 */
async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.goto('/')
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
    localStorage.setItem('chat.theme', t)
  }, theme)
  // Let the View Transitions API settle (if supported) and CSS variables
  // propagate before taking the snapshot.
  await page.waitForTimeout(50)
}

/**
 * Navigate to a full-bleed page (error boundary / 404) with the given theme
 * applied. These pages render outside the app shell, so the theme is set by
 * flipping the .dark class directly rather than via the app's toggle.
 */
async function setThemeAt(page: Page, path: string, theme: 'light' | 'dark') {
  await page.goto(path)
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForTimeout(50)
}

/* ─── Dark mode (default) ─── */

test.describe('visual regression — dark mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('empty state renders consistently', async ({ page }) => {
    await setTheme(page, 'dark')
    await expect(page.locator('main')).toHaveScreenshot('chat-empty-dark.png', {
      maxDiffPixelRatio: 0.02,
      // The header's conversation metadata (title + served model) is
      // session-dependent — mask it like the drawer's session list so the
      // baseline stays deterministic.
      mask: [page.getByTestId('conversation-meta')],
    })
  })

  test('thread with user and assistant messages renders consistently', async ({ page }) => {
    await mockStream(page, ['Hello from the assistant!'])
    await setTheme(page, 'dark')
    await page.getByLabel('Message').fill('Hi there')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText('Hello from the assistant!')).toBeVisible()

    await expect(page.locator('main')).toHaveScreenshot('chat-thread-dark.png', {
      maxDiffPixelRatio: 0.02,
      mask: [page.getByTestId('conversation-meta')],
    })
  })

  test('open mobile drawer renders consistently', async ({ page, isMobile }) => {
    test.skip(!isMobile)

    await setTheme(page, 'dark')
    await page.getByRole('button', { name: 'Open conversation list' }).click()
    await expect(page.getByRole('dialog', { name: 'Conversations' })).toBeVisible()

    const dialog = page.getByRole('dialog', { name: 'Conversations' })
    await expect(page).toHaveScreenshot('drawer-open-dark.png', {
      maxDiffPixelRatio: 0.02,
      mask: [dialog.locator('ul')],
    })
  })

  test('404 page renders consistently', async ({ page }) => {
    await setThemeAt(page, '/this-page-does-not-exist', 'dark')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(page).toHaveScreenshot('not-found-dark.png', { maxDiffPixelRatio: 0.02 })
  })

  test('error boundary renders consistently', async ({ page }) => {
    await setThemeAt(page, '/error-demo', 'dark')
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
    await expect(page).toHaveScreenshot('error-boundary-dark.png', { maxDiffPixelRatio: 0.02 })
  })
})

/* ─── Light mode ─── */

test.describe('visual regression — light mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('empty state renders consistently', async ({ page }) => {
    await setTheme(page, 'light')
    await expect(page.locator('main')).toHaveScreenshot('chat-empty-light.png', {
      maxDiffPixelRatio: 0.02,
      mask: [page.getByTestId('conversation-meta')],
    })
  })

  test('thread with user and assistant messages renders consistently', async ({ page }) => {
    await mockStream(page, ['Hello from the assistant!'])
    await setTheme(page, 'light')
    await page.getByLabel('Message').fill('Hi there')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText('Hello from the assistant!')).toBeVisible()

    await expect(page.locator('main')).toHaveScreenshot('chat-thread-light.png', {
      maxDiffPixelRatio: 0.02,
      mask: [page.getByTestId('conversation-meta')],
    })
  })

  test('open mobile drawer renders consistently', async ({ page, isMobile }) => {
    test.skip(!isMobile)

    await setTheme(page, 'light')
    await page.getByRole('button', { name: 'Open conversation list' }).click()
    await expect(page.getByRole('dialog', { name: 'Conversations' })).toBeVisible()

    const dialog = page.getByRole('dialog', { name: 'Conversations' })
    await expect(page).toHaveScreenshot('drawer-open-light.png', {
      maxDiffPixelRatio: 0.02,
      mask: [dialog.locator('ul')],
    })
  })

  test('404 page renders consistently', async ({ page }) => {
    await setThemeAt(page, '/this-page-does-not-exist', 'light')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(page).toHaveScreenshot('not-found-light.png', { maxDiffPixelRatio: 0.02 })
  })

  test('error boundary renders consistently', async ({ page }) => {
    await setThemeAt(page, '/error-demo', 'light')
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
    await expect(page).toHaveScreenshot('error-boundary-light.png', { maxDiffPixelRatio: 0.02 })
  })
})
