import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  sendSubscriptionActivatedEmail,
  sendSubscriptionCancelledEmail,
  sendTransactionalEmail,
  sendWelcomeEmail,
} from '../lib/email'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('transactional email delivery', () => {
  it('sends through Resend when RESEND_API_KEY is configured', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('RESEND_EMAIL_FROM', 'notify@example.com')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendWelcomeEmail('user@example.com', 'Ada')

    expect(result).toEqual({ ok: true, provider: 'resend' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer re_test' }),
      }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      from: string
      to: string[]
      subject: string
      html: string
    }
    expect(body).toMatchObject({
      from: 'notify@example.com',
      to: ['user@example.com'],
      subject: 'Welcome to Chatbot',
    })
    expect(body.html).toContain('Welcome, Ada!')
  })

  it('uses SendGrid when Resend is not configured', async () => {
    vi.stubEnv('SENDGRID_API_KEY', 'sg_test')
    vi.stubEnv('SENDGRID_EMAIL_FROM', 'notify@example.com')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendSubscriptionActivatedEmail('user@example.com')

    expect(result).toEqual({ ok: true, provider: 'sendgrid' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.sendgrid.com/v3/mail/send')
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      from: { email: string }
      personalizations: Array<{ to: Array<{ email: string }> }>
      subject: string
    }
    expect(body).toMatchObject({
      from: { email: 'notify@example.com' },
      personalizations: [{ to: [{ email: 'user@example.com' }] }],
      subject: 'Your Pro subscription is active',
    })
  })

  it('logs a short console fallback locally when no provider is configured', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const result = await sendSubscriptionCancelledEmail('user@example.com')

    expect(result).toEqual({ ok: true, provider: 'console' })
    expect(info).toHaveBeenCalledWith(
      '[email:console]',
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Your Chatbot subscription was cancelled',
      }),
    )
  })

  it('does not throw when a configured provider fails', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await sendTransactionalEmail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
      text: 'Test',
    })

    expect(result).toEqual({ ok: true, provider: 'console' })
    expect(warn).toHaveBeenCalled()
  })

  it('rejects malformed recipients without making a network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendTransactionalEmail({
      to: 'not-an-email',
      subject: 'Test',
      html: '<p>Test</p>',
    })

    expect(result).toEqual({ ok: false, provider: 'disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
