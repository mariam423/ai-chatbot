import { expect, test } from '@playwright/test'
import { mockStream, sseBody } from './helpers'

// Headless Chromium denies navigator.clipboard by default; grant the
// permissions so the copy button can flip to its "Code copied" state.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

async function sendMessage(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.getByLabel('Message').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

test('sidebar lists the conversation and New Chat resets the thread', async ({
  page,
  isMobile,
}) => {
  // The sidebar is desktop-only (hidden below md).
  test.skip(isMobile)

  await mockStream(page, ['Sidebar reply'])

  await page.goto('/')
  await sendMessage(page, 'Sidebar question')

  await expect(page.locator('main').getByText('Sidebar reply')).toBeVisible()

  await test.step('the new conversation appears in the sidebar', async () => {
    const sidebar = page.getByRole('complementary', { name: 'Conversations' })
    await expect(sidebar).toContainText('Sidebar question')
  })

  await test.step('New Chat resets to the empty state', async () => {
    await page.getByRole('button', { name: 'New Chat' }).click()
    await expect(page.getByText(/Ask me anything/)).toBeVisible()
  })
})

test('toggles dark mode and persists it across reloads', async ({ page, isMobile }) => {
  test.skip(isMobile)

  await page.goto('/')
  const html = page.locator('html')

  await expect(html).not.toHaveClass(/dark/)

  await test.step('toggle on', async () => {
    await page.getByRole('button', { name: 'Switch to dark mode' }).click()
    await expect(html).toHaveClass(/dark/)
  })

  await test.step('persists across a reload', async () => {
    await page.reload()
    await expect(html).toHaveClass(/dark/)
  })

  await test.step('toggle off', async () => {
    await page.getByRole('button', { name: 'Switch to light mode' }).click()
    await expect(html).not.toHaveClass(/dark/)
  })
})

test('regenerates the last assistant reply', async ({ page }) => {
  let calls = 0
  await page.route('**/api/chat', (route) => {
    calls += 1
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody([`reply ${calls}`]),
    })
  })

  await page.goto('/')
  await sendMessage(page, 'Regenerate me')
  await expect(page.locator('main').getByText('reply 1')).toBeVisible()

  await page.getByRole('button', { name: 'Regenerate response' }).click()
  await expect(page.locator('main').getByText('reply 2')).toBeVisible()
  await expect(page.locator('main').getByText('reply 1')).toBeHidden()
})

test('mobile drawer lists sessions and switches threads', async ({ page, isMobile }) => {
  test.skip(!isMobile)

  await mockStream(page, ['Drawer reply'])

  await page.goto('/')
  await sendMessage(page, 'Drawer question')
  await expect(page.locator('main').getByText('Drawer reply')).toBeVisible()

  const trigger = page.getByRole('button', { name: 'Open conversation list' })
  const dialog = page.getByRole('dialog', { name: 'Conversations' })

  await test.step('opening the drawer shows the conversation list', async () => {
    await trigger.click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeFocused()
    await expect(dialog).toContainText('Drawer question')
  })

  await test.step('New Chat resets the thread and closes the drawer', async () => {
    await dialog.getByRole('button', { name: 'New Chat' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('main').getByText(/Ask me anything/)).toBeVisible()
  })

  await test.step('selecting a conversation switches the thread and closes the drawer', async () => {
    await trigger.click()
    // The DB is shared across e2e runs, so several sessions may share a
    // title; the list is newest-first, so .first() is this run's session.
    await dialog
      .getByRole('button', { name: /Drawer question/ })
      .first()
      .click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('main').getByText('Drawer reply')).toBeVisible()
  })

  await test.step('Escape closes the drawer', async () => {
    await trigger.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})

test('renames and deletes a session from the sidebar', async ({ page, isMobile }) => {
  test.skip(isMobile)

  await mockStream(page, ['Rename reply'])
  await page.goto('/')
  await sendMessage(page, 'Rename me')
  await expect(page.locator('main').getByText('Rename reply')).toBeVisible()

  const sidebar = page.getByRole('complementary', { name: 'Conversations' })
  // Unique title so the shared DB (sessions accumulate across runs) can't collide.
  const renamedTitle = `Renamed ${Date.now()}`

  await test.step('rename via the row menu', async () => {
    // The DB save is fire-and-forget, so wait for THIS run's session to
    // appear: the active row is always this run's session (earlier same-titled
    // sessions from previous runs accumulate, so title-based .first() could
    // target the wrong row before the list refreshes).
    await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1)
    await sidebar
      .locator('[aria-current="page"]')
      .locator('xpath=..')
      .getByRole('button', { name: /More actions for/ })
      .click()
    await sidebar.getByRole('button', { name: 'Rename', exact: true }).click()
    await sidebar.getByRole('textbox', { name: 'Session title' }).fill(renamedTitle)
    await page.keyboard.press('Enter')
    // Exact text: the row's title span (the ⋯ button's accessible name also
    // contains the title, so a role/name match would be ambiguous).
    await expect(sidebar.getByText(renamedTitle, { exact: true })).toBeVisible()
    // The renamed session stays active.
    await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1)
  })

  await test.step('delete the session with the two-step confirm', async () => {
    await sidebar.getByRole('button', { name: `More actions for ${renamedTitle}` }).click()
    await sidebar.getByRole('button', { name: 'Delete', exact: true }).click()
    await sidebar.getByRole('button', { name: 'Confirm delete' }).click()
    await expect(sidebar.getByRole('button', { name: new RegExp(renamedTitle) })).toHaveCount(0)
    // Deleting the ACTIVE session resets the thread.
    await expect(page.locator('main').getByText(/Ask me anything/)).toBeVisible()
  })
})

test('renames a session from the mobile drawer', async ({ page, isMobile }) => {
  test.skip(!isMobile)

  await mockStream(page, ['Drawer rename reply'])
  await page.goto('/')
  await sendMessage(page, 'Drawer rename')
  await expect(page.locator('main').getByText('Drawer rename reply')).toBeVisible()

  const dialog = page.getByRole('dialog', { name: 'Conversations' })
  const renamedTitle = `Renamed ${Date.now()}`

  await page.getByRole('button', { name: 'Open conversation list' }).click()
  await expect(dialog).toBeVisible()

  // Anchor on the active row (this run's session) so the fire-and-forget save
  // landing late can't make a title-based .first() hit an older session.
  await expect(dialog.locator('[aria-current="page"]')).toHaveCount(1)
  await dialog
    .locator('[aria-current="page"]')
    .locator('xpath=..')
    .getByRole('button', { name: /More actions for/ })
    .click()
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Session title' }).fill(renamedTitle)
  await page.keyboard.press('Enter')
  await expect(dialog.getByText(renamedTitle, { exact: true })).toBeVisible()
})

test('searches conversations and resets on clear', async ({ page, isMobile }) => {
  test.skip(isMobile)

  const uniqueTitle = `Search me ${Date.now()}`
  await mockStream(page, ['Search reply'])
  await page.goto('/')
  await sendMessage(page, uniqueTitle)
  await expect(page.locator('main').getByText('Search reply')).toBeVisible()

  const sidebar = page.getByRole('complementary', { name: 'Conversations' })
  const searchInput = sidebar.getByRole('searchbox', { name: 'Search conversations' })

  await test.step('typing a unique term filters to exactly that session', async () => {
    await searchInput.fill(uniqueTitle)
    await expect(sidebar.getByText(uniqueTitle, { exact: true })).toBeVisible()
    // Unique title → exactly one match (no Show-more li for a 1-result page).
    await expect(sidebar.locator('li')).toHaveCount(1)
  })

  await test.step('search is case-insensitive', async () => {
    await searchInput.fill(uniqueTitle.toLowerCase())
    await expect(sidebar.getByText(uniqueTitle, { exact: true })).toBeVisible()
    await expect(sidebar.locator('li')).toHaveCount(1)
  })

  await test.step('a search with no matches shows the no-results state', async () => {
    await searchInput.fill('zzz-no-such-session')
    await expect(sidebar.getByText('No conversations found.')).toBeVisible()
    await expect(sidebar.getByText(uniqueTitle, { exact: true })).toBeHidden()
    await expect(sidebar.locator('li')).toHaveCount(0)
  })

  await test.step('clearing the search restores the list', async () => {
    await searchInput.fill('')
    await expect(sidebar.getByText(uniqueTitle, { exact: true })).toBeVisible()
  })
})

test('loads older sessions with Show more', async ({ page, isMobile }) => {
  test.skip(isMobile)

  await page.goto('/')
  const sidebar = page.getByRole('complementary', { name: 'Conversations' })
  const showMore = sidebar.getByRole('button', { name: 'Show more' })
  // The session list loads asynchronously; count() doesn't auto-wait, so wait
  // for the first row to render (proof listChatSessions resolved) before
  // deciding whether there is anything to paginate.
  const listLoaded = await sidebar
    .locator('li')
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
  if (!listLoaded || (await showMore.count()) === 0) {
    // Fresh DB (e.g. a new clone): fewer than a page of sessions exist.
    test.skip(true, 'fewer than 20 sessions exist — nothing to paginate')
    return
  }

  // First page = 20 sessions + the Show-more row itself.
  await expect(sidebar.locator('li')).toHaveCount(21)
  const before = 21
  await showMore.click()
  await expect.poll(() => sidebar.locator('li').count()).toBeGreaterThan(before)
})

test('renders markdown code blocks with a language badge and copy button', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseBody(['Here is code:\n```js\nconst x = 1;\n```']),
    }),
  )

  await page.goto('/')
  await sendMessage(page, 'Show code')

  await expect(page.locator('main').getByText('Here is code:')).toBeVisible()
  await expect(page.getByText('js')).toBeVisible()
  const copy = page.getByRole('button', { name: 'Copy code' })
  await expect(copy).toBeVisible()
  await copy.click()
  await expect(page.getByRole('button', { name: 'Code copied' })).toBeVisible()
})
