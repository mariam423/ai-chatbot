// Focused RAG smoke test against production.
// Uploads a doc, then asks a question that *only* the doc can answer, all
// in the same session (no New Chat in between).
import { chromium } from 'playwright'

const APP_URL = 'https://ai-chatbot-rose-ten.vercel.app'
const EMAIL = 'mariam+test@example.com'
const PASSWORD = 'TestPass-2026!'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 900 },
})
const page = await ctx.newPage()

page.on('pageerror', (e) => console.log('PAGEERR:', e.message))
page.on('response', async (r) => {
  const u = new URL(r.url())
  if (u.hostname.includes('vercel.app') && r.status() >= 400) {
    let body = ''
    try { body = (await r.text()).slice(0, 200) } catch {}
    console.log(`HTTP ${r.status()}: ${r.request().method()} ${u.pathname} — ${body}`)
  }
})

// 1. Login
await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', EMAIL)
await page.fill('input[type="password"]', PASSWORD)
await page.click('button[type="submit"]')
await page.waitForTimeout(5_000)

// 2. Open chat
await page.goto(`${APP_URL}/`, { waitUntil: 'networkidle' })
// Don't hit "New Chat" — we want to keep the same sessionId for upload
// and the question, otherwise the doc is attached to a different session
// than the one we ask in (which would skip RAG).
await page.waitForSelector('textarea', { timeout: 15_000 })

// 3. Upload a doc with a unique fact
const docInput = await page.$('input[accept*=".pdf"]')
if (!docInput) {
  console.log('NO doc input')
  process.exit(1)
}
const fs = await import('node:fs')
const unique = `QA-${Date.now()}`
const body =
  `FACT: the secret passphrase is "${unique}-banana".\n\n` +
  `This passphrase is only used for the QA smoke test on ${new Date().toISOString()}.\n\n` +
  `Additional filler: the capital of Atlantis is Coralhaven and it has three coral bridges.`
fs.writeFileSync(`/tmp/${unique}.txt`, body)

try {
  console.log('Uploading doc...')
  await docInput.setInputFiles(`/tmp/${unique}.txt`)
  await page.waitForFunction(
    (name) => (document.body.textContent ?? '').includes(name),
    unique,
    { timeout: 15_000 },
  )
  console.log('✅ doc chip appeared:', unique)

  // 4. Wait for upload to actually complete server-side (a brief delay is
  // needed because the chip shows on request, but DB write + embedding is
  // synchronous before the chip appears — still we give it 1s of headroom).
  await page.waitForTimeout(1_500)

  // 5. Ask for the unique passphrase — retry once on 429 (OpenRouter
  // free tier limits bursts aggressively).
  const composer = await page.$('textarea')
  await composer.fill(`What is the secret passphrase in the uploaded document? Reply with only the passphrase and nothing else.`)
  const send = await page.$('button[aria-label="Send"]')
  await send.click()

  console.log('Waiting for reply containing the unique passphrase...')
  const target = `${unique}-banana`
  let lastBody = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.waitForFunction(
        (t) => (document.body.textContent ?? '').includes(t),
        target,
        { timeout: 30_000 },
      )
      console.log(`✅ RAG retrieved unique fact: ${target}`)
      process.exit(0)
    } catch {
      const body = (await page.textContent('body')) ?? ''
      lastBody = body.slice(Math.max(0, body.length - 400))
      const got429 = body.includes('429') || (await page.locator('text=rate limit').count()) > 0
      if (got429 && attempt < 2) {
        console.log(`   attempt ${attempt + 1}: 429 rate limit — retrying in 25s`)
        // Use page.waitForTimeout (Playwright supports it; not a chained
        // shell sleep).
        await page.waitForTimeout(25_000)
        // Resend the same prompt
        const c2 = await page.$('textarea')
        if (c2) {
          await c2.fill(`What is the secret passphrase in the uploaded document? Reply with only the passphrase and nothing else.`)
          const s2 = await page.$('button[aria-label="Send"]')
          await s2?.click()
        }
        continue
      }
      break
    }
  }
  console.log('❌ RAG did not surface the uploaded fact')
  console.log('Last 400 chars of body:', lastBody)
  process.exit(1)
} finally {
  try { fs.unlinkSync(`/tmp/${unique}.txt`) } catch {}
}

await browser.close()
console.log('=== RAG smoke test PASSED ===')
