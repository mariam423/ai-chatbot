import { expect, test } from '@playwright/test'

test('login page renders Google and GitHub OAuth buttons', async ({ page }) => {
  await page.route('**/api/auth/providers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        credentials: { id: 'credentials', name: 'Email', type: 'credentials' },
        google: { id: 'google', name: 'Google', type: 'oauth' },
        github: { id: 'github', name: 'GitHub', type: 'oauth' },
      }),
    })
  })

  await page.goto('/login')

  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible()
})
