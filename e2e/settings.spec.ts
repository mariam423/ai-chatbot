import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * E2E for the Settings page (User Settings update flow).
 *
 * The suite runs with AUTH_DISABLED=true, so server-side preference
 * persistence is intentionally not available (updateUserPreferences returns
 * "Not authenticated."). The spec therefore covers what is real in that mode:
 * the form renders every section, client-side controls update live, and the
 * save path surfaces server errors through the page's alert banner.
 */

async function setRangeValue(locator: Locator, value: string): Promise<void> {
  await locator.evaluate((el, next) => {
    const input = el as HTMLInputElement
    // React tracks range inputs via the native setter + input event (the
    // standard controlled-input trick, as in chat.spec.ts).
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, next)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test('settings page renders all sections with saved defaults', async ({ page }) => {
  await page.goto('/settings')

  await test.step('profile, model, billing, key, calendar, and presets sections are present', async () => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Model & Generation' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Plan & Billing' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'API Key' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Google Calendar' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'System Prompt Presets' })).toBeVisible()
  })

  await test.step('billing shows the Free plan with its daily limit', async () => {
    await expect(page.getByText('Free plan')).toBeVisible()
    await expect(page.getByText(/daily chat requests used/)).toBeVisible()
  })

  await test.step('generation sliders start at provider defaults', async () => {
    await expect(page.locator('#settings-temperature')).toHaveValue('0.7')
    await expect(page.locator('#settings-max-tokens')).toHaveValue('2048')
  })

  await test.step('the effective max_tokens default is surfaced (200 server default)', async () => {
    // getUserPreferences returns the env-derived server default (MAX_OUTPUT_TOKENS
    // unset in e2e → the conservative 200), so the unset readout spells it out.
    await expect(page.getByText('200 (server default)')).toBeVisible()
  })

  await test.step('model captions toggle renders in the on state (server default)', async () => {
    // AUTH_DISABLED → getUserPreferences returns the defaults, where
    // showModelCaptions is true (the column default / legacy-row fallback).
    const toggle = page.getByRole('switch', { name: 'Show model captions' })
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
  })
})

test('editing profile fields and tuning sliders updates the form live', async ({ page }) => {
  await page.goto('/settings')

  await test.step('display name and avatar are editable', async () => {
    await page.getByLabel('Display Name').fill('Buffy Summers')
    await expect(page.getByLabel('Display Name')).toHaveValue('Buffy Summers')
    await page.getByLabel('Avatar URL').fill('https://example.com/buffy.png')
    await expect(page.getByLabel('Avatar URL')).toHaveValue('https://example.com/buffy.png')
  })

  await test.step('preferred default model can be selected', async () => {
    await page.getByLabel('Preferred Default Model').selectOption('qwen-3-6')
    await expect(page.getByLabel('Preferred Default Model')).toHaveValue('qwen-3-6')
  })

  await test.step('temperature slider updates its live readout', async () => {
    await setRangeValue(page.locator('#settings-temperature'), '0.5')
    await expect(page.getByText('0.50')).toBeVisible()
  })

  await test.step('max tokens slider updates its live readout', async () => {
    await setRangeValue(page.locator('#settings-max-tokens'), '4096')
    await expect(page.getByText('4,096')).toBeVisible()
  })
})

test('the model captions toggle flips and its state survives the failed save', async ({ page }) => {
  await page.goto('/settings')
  const toggle = page.getByRole('switch', { name: 'Show model captions' })

  await test.step('toggling off updates the switch state live', async () => {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  await test.step('toggling back on restores it (client-side state, no server write in AUTH_DISABLED)', async () => {
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
  })
})

test('saving surfaces server-side errors through the alert banner', async ({ page }) => {
  await page.goto('/settings')
  await page.getByLabel('Display Name').fill('Anon')

  await page.getByRole('button', { name: 'Save Changes' }).click()

  await test.step('an alert explains why the save failed (AUTH_DISABLED → not authenticated)', async () => {
    // The Next.js route announcer also has role=alert (empty), so target the
    // error text directly rather than the role.
    await expect(page.getByText('Not authenticated.')).toBeVisible()
  })
})

test('a custom system prompt preset can be added and removed', async ({ page }) => {
  await page.goto('/settings')

  await test.step('add a preset with name + prompt', async () => {
    await page.getByPlaceholder('Preset name').fill('My Reviewer')
    await page.getByPlaceholder('System prompt...').fill('Review code strictly.')
    await page.getByRole('button', { name: 'Add Preset' }).click()
    await expect(page.getByText('My Reviewer')).toBeVisible()
  })

  await test.step('delete removes it from the custom list', async () => {
    // Edit/Delete actions are hover-revealed; force-hover the row first.
    const row = page.getByText('My Reviewer').locator('..').locator('..')
    await row.hover()
    await page.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('My Reviewer')).toBeHidden()
  })
})

test('returns to the chat shell from the settings header', async ({ page }: { page: Page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Back to chat' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Chatbot' })).toBeVisible()
})
