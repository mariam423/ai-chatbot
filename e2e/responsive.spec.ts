import { expect, test } from '@playwright/test'
import { mockStream } from './helpers'

test.describe('responsive layout (FR-10)', () => {
  test('fits a 360px viewport without horizontal overflow, including long unbroken tokens', async ({
    page,
  }) => {
    await mockStream(page, ['Supercalifragilisticexpialidocious'.repeat(20)])

    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/')

    await test.step('empty state fits without horizontal overflow', async () => {
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
      expect(overflows).toBe(false)
    })

    await test.step('a long reply wraps instead of overflowing', async () => {
      await page.getByLabel('Message').fill('Tell me everything')
      await page.getByRole('button', { name: 'Send' }).click()
      await expect(page.getByText(/Supercalifragilisticexpialidocious/)).toBeVisible()

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
      expect(overflows).toBe(false)
    })

    await test.step('input and send remain usable on the narrow viewport', async () => {
      await expect(page.getByLabel('Message')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
    })
  })
})
