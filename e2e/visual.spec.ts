import { expect, test } from '@playwright/test'
import { mockStream } from './helpers'

test.describe('visual regression', () => {
  test.beforeEach(async ({ page }) => {
    // Force prefers-reduced-motion so Framer Motion entrance animations and
    // the typing dots are static in snapshots (deterministic baselines).
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('empty state renders consistently', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('main')).toHaveScreenshot('chat-empty.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('thread with user and assistant messages renders consistently', async ({ page }) => {
    await mockStream(page, ['Hello from the assistant!'])
    await page.goto('/')
    await page.getByLabel('Message').fill('Hi there')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText('Hello from the assistant!')).toBeVisible()

    await expect(page.locator('main')).toHaveScreenshot('chat-thread.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('open mobile drawer renders consistently', async ({ page, isMobile }) => {
    // The drawer only exists below md — snapshot on the mobile project only.
    test.skip(!isMobile)

    await page.goto('/')
    await page.getByRole('button', { name: 'Open conversation list' }).click()
    await expect(page.getByRole('dialog', { name: 'Conversations' })).toBeVisible()

    // The session list content depends on the shared test DB (non-deterministic
    // across runs), so mask it — the baseline covers the stable drawer shell:
    // dimmed backdrop, panel, header, search box, and theme toggle.
    const dialog = page.getByRole('dialog', { name: 'Conversations' })
    await expect(page).toHaveScreenshot('drawer-open.png', {
      maxDiffPixelRatio: 0.02,
      mask: [dialog.locator('ul')],
    })
  })
})
