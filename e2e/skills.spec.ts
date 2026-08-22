import { expect, test, type Page } from '@playwright/test'
import { sseBody } from './helpers'

const ALL_SKILLS = [
  'planning',
  'system-design',
  'frontend-ui-ux',
  'debugging',
  'testing',
  'ai-mcp',
  'docs',
  'general-utilities',
]

const skillsTrigger = (page: Page) => page.getByRole('button', { name: 'Toggle active skills' })

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

// Skill descriptions can substring-match short reply text (e.g. "lookups"
// contains "ok"), so scope thread assertions to <main> like chat.spec.ts.
const threadText = (page: Page, text: string) =>
  page.locator('main').getByText(text, { exact: true })

test('toggles skills per session and sends the override', async ({ page }) => {
  const bodies: Array<{ enabledSkills?: string[] }> = []
  await page.route('**/api/chat', (route) => {
    bodies.push(route.request().postDataJSON() as { enabledSkills?: string[] })
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody(['ok']),
    })
  })

  await page.goto('/')
  await skillsTrigger(page).click()
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(8)

  await test.step('toggling a skill off customizes the session', async () => {
    await page.getByRole('menuitemcheckbox', { name: /System Design/ }).click()
    await expect(skillsTrigger(page)).toContainText('7/8')
  })

  await test.step('sending a message carries the narrowed override', async () => {
    await sendMessage(page, 'Hello')
    await expect(threadText(page, 'ok')).toBeVisible()
    expect(bodies[0]!.enabledSkills).toEqual(ALL_SKILLS.filter((id) => id !== 'system-design'))
  })

  await test.step('Use all resets to the default catalog', async () => {
    await skillsTrigger(page).click()
    await page.getByRole('button', { name: 'Use all' }).click()
    await expect(skillsTrigger(page)).not.toContainText('/8')
    await sendMessage(page, 'Reset again')
    expect(bodies[1]!.enabledSkills).toBeUndefined()
  })
})

test('restores the per-session skill override after a reload', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody(['Saved']),
    }),
  )

  await page.goto('/')
  await skillsTrigger(page).click()
  await page.getByRole('menuitemcheckbox', { name: /Documentation/ }).click()
  await expect(skillsTrigger(page)).toContainText('7/8')
  await page.keyboard.press('Escape')
  await sendMessage(page, 'Remember my skills')
  await expect(threadText(page, 'Saved')).toBeVisible()

  await page.reload()
  await expect(skillsTrigger(page)).toContainText('7/8')
})
