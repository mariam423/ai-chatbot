/**
 * Server-only transactional email delivery.
 *
 * Provider selection is intentionally dependency-free: Resend is preferred
 * when RESEND_API_KEY is configured, then SendGrid. Local development uses a
 * bounded console fallback when neither provider is configured. Email failures
 * are best-effort and never allowed to break authentication or billing.
 */

export interface TransactionalEmail {
  to: string
  subject: string
  html: string
  text?: string
}

export type EmailProvider = 'resend' | 'sendgrid' | 'console' | 'disabled'

export interface EmailDeliveryResult {
  ok: boolean
  provider: EmailProvider
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || process.env.RESEND_EMAIL_FROM || 'onboarding@resend.dev'
}

function isValidRecipient(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function consoleFallback(email: TransactionalEmail): EmailDeliveryResult {
  if (process.env.NODE_ENV === 'production') return { ok: false, provider: 'disabled' }
  // Never print the complete body or secrets to logs.
  console.info('[email:console]', {
    to: email.to,
    subject: email.subject,
    text: (email.text ?? '').slice(0, 240),
  })
  return { ok: true, provider: 'console' }
}

async function sendWithResend(email: TransactionalEmail): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`Resend returned ${response.status}`)
}

async function sendWithSendGrid(email: TransactionalEmail): Promise<void> {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: email.to }] }],
      from: { email: process.env.SENDGRID_EMAIL_FROM || fromAddress() },
      subject: email.subject,
      content: [
        { type: 'text/plain', value: email.text ?? '' },
        { type: 'text/html', value: email.html },
      ],
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error(`SendGrid returned ${response.status}`)
}

/** Send one transactional message without throwing into the calling flow. */
export async function sendTransactionalEmail(
  email: TransactionalEmail,
): Promise<EmailDeliveryResult> {
  if (!isValidRecipient(email.to)) return { ok: false, provider: 'disabled' }

  const provider: EmailProvider = process.env.RESEND_API_KEY
    ? 'resend'
    : process.env.SENDGRID_API_KEY
      ? 'sendgrid'
      : process.env.NODE_ENV === 'production'
        ? 'disabled'
        : 'console'

  try {
    if (provider === 'resend') await sendWithResend(email)
    else if (provider === 'sendgrid') await sendWithSendGrid(email)
    else return provider === 'console' ? consoleFallback(email) : { ok: false, provider }
    return { ok: true, provider }
  } catch (error) {
    // Provider outages are not auth/billing outages. Keep the fallback local so
    // production never silently logs customer email content.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[email] provider delivery failed; using console fallback', error)
      return consoleFallback(email)
    }
    return { ok: false, provider }
  }
}

function lifecycleEmail(
  to: string,
  subject: string,
  heading: string,
  body: string,
): TransactionalEmail {
  const safeHeading = escapeHtml(heading)
  const safeBody = escapeHtml(body)
  return {
    to,
    subject,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#17231c"><h1>${safeHeading}</h1><p>${safeBody}</p></body></html>`,
    text: `${heading}\n\n${body}`,
  }
}

export function sendWelcomeEmail(to: string, name?: string | null): Promise<EmailDeliveryResult> {
  const greeting = name?.trim() ? `Welcome, ${name.trim()}!` : 'Welcome!'
  return sendTransactionalEmail(
    lifecycleEmail(
      to,
      'Welcome to Chatbot',
      greeting,
      'Your account is ready. Start a conversation whenever you are ready.',
    ),
  )
}

export function sendSubscriptionActivatedEmail(to: string): Promise<EmailDeliveryResult> {
  return sendTransactionalEmail(
    lifecycleEmail(
      to,
      'Your Pro subscription is active',
      'Pro is now active',
      'Your subscription has been activated and your Pro features are available.',
    ),
  )
}

export function sendSubscriptionCancelledEmail(to: string): Promise<EmailDeliveryResult> {
  return sendTransactionalEmail(
    lifecycleEmail(
      to,
      'Your Chatbot subscription was cancelled',
      'Subscription cancelled',
      'Your subscription has ended. Your account remains available on the Free tier.',
    ),
  )
}
