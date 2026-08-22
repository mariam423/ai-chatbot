import { expect, test } from '@playwright/test'
import { mockStream } from './helpers'

// Headless Chromium denies navigator.clipboard by default; grant access so the
// copy button's clipboard write (and read-back below) works.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">' +
  '<rect width="120" height="60" fill="#22d3ee"/>' +
  '<text x="8" y="38" font-family="sans-serif" font-size="16">Auth flow</text></svg>'
const DATA_URL = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`

test('renders a streamed SVG diagram with copy and download controls', async ({ page }) => {
  await mockStream(page, [`Here is the diagram:\n\n![diagram](${DATA_URL})`])

  await page.goto('/')
  await page.getByLabel('Message').fill('Draw our auth flow')
  await page.getByRole('button', { name: 'Send' }).click()

  const card = page.getByTestId('diagram-card')
  await test.step('the diagram card renders the SVG image', async () => {
    await expect(card).toBeVisible()
    await expect(card.locator('img')).toHaveAttribute('src', DATA_URL)
  })

  await test.step('copy puts the raw SVG markup on the clipboard', async () => {
    await page.bringToFront()
    await card.getByRole('button', { name: 'Copy SVG' }).click()
    // The exact SVG markup must land on the clipboard (the button's transient
    // "Copied" label animates out quickly, so assert the clipboard itself).
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(SVG)
  })

  await test.step('download saves the diagram as an .svg file', async () => {
    const downloadPromise = page.waitForEvent('download')
    await card.getByRole('button', { name: 'Download' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('diagram.svg')
  })
})

test('opens a full-screen pan/zoom viewer with working zoom and Escape close', async ({ page }) => {
  await mockStream(page, [`Here is the diagram:\n\n![diagram](${DATA_URL})`])

  await page.goto('/')
  await page.getByLabel('Message').fill('Inspect this diagram')
  await page.getByRole('button', { name: 'Send' }).click()

  const card = page.getByTestId('diagram-card')
  const view = card.getByRole('button', { name: 'View full screen' })
  await expect(view).toBeVisible()
  await view.click()

  const dialog = page.getByRole('dialog', { name: /Diagram viewer/ })
  await test.step('the viewer opens as a full-screen dialog at 100%', async () => {
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('100%')).toBeVisible()
  })

  await test.step('zoom in updates the readout; reset returns to 100%', async () => {
    await dialog.getByRole('button', { name: 'Zoom in' }).click()
    await expect(dialog.getByText('125%')).toBeVisible()
    await dialog.getByRole('button', { name: 'Reset zoom' }).click()
    await expect(dialog.getByText('100%')).toBeVisible()
  })

  await test.step('Escape closes the viewer and restores focus to the trigger', async () => {
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(view).toBeFocused()
  })
})

test('renders a non-SVG image inline without diagram controls', async ({ page }) => {
  await mockStream(page, ['![png](https://example.com/diagram.png)'])

  await page.goto('/')
  await page.getByLabel('Message').fill('Show me an image')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect(page.getByTestId('diagram-card')).toHaveCount(0)
  await expect(page.locator('main img[src="https://example.com/diagram.png"]')).toBeVisible()
})
