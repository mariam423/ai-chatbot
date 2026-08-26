'use server'

import { createHash, randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { checkAuthRateLimit, clientIpFromHeaders } from '@/lib/security'
import { DEFAULT_USER_ROLE } from '@/lib/roles'

const RegisterSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().email('Invalid email address').max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
})

export async function registerUser(input: {
  name: string
  email: string
  password: string
}): Promise<{ ok: true } | { ok: false; error: string; issues?: Array<{ message: string }> }> {
  // Abuse brake: registration is unauthenticated and pays for a cost-12
  // bcrypt hash + a DB row, so cap it per IP before any work.
  const throttled = await checkAuthRateLimit('register', clientIpFromHeaders(await headers()))
  if (!throttled.ok) return throttled

  const parsed = RegisterSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid input.',
      issues: parsed.error.issues.map((i) => ({ message: i.message })),
    }
  }

  const { name, email, password } = parsed.data
  const normalisedEmail = email.toLowerCase()

  try {
    const existing = await prisma.user.findUnique({ where: { email: normalisedEmail } })
    if (existing) {
      // Generic message (OWASP A07): never reveal whether an email is already
      // registered — that would turn signup into an account-enumeration oracle.
      return {
        ok: false,
        error:
          'Could not create the account. Check your details, or sign in if you already have an account.',
      }
    }

    const passwordHash = await bcrypt.hash(password, 12)
    await prisma.user.create({
      data: { name, email: normalisedEmail, passwordHash, role: DEFAULT_USER_ROLE, plan: 'free' },
    })

    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not create account. Please try again.' }
  }
}
const RequestResetSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(255),
})

const ResetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
})

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Request a password reset link. Always returns ok (beyond validation) so the
 * endpoint can't be used to probe which emails have accounts. The token is
 * stored hashed (SHA-256); only the raw value rides in the reset link.
 *
 * No email provider is configured yet, so the link is logged server-side.
 * Swap the `console.info` for a real send call when SMTP/Resend is added.
 */
export async function requestPasswordReset(input: {
  email: string
}): Promise<{ ok: true } | { ok: false; error: string; issues?: Array<{ message: string }> }> {
  // Abuse brake: each call writes a token row (and will eventually send an
  // email), so cap per IP. Keyed by IP only — an email-keyed limit would let
  // an attacker burn a victim's reset quota.
  const throttled = await checkAuthRateLimit('reset-request', clientIpFromHeaders(await headers()))
  if (!throttled.ok) return throttled

  const parsed = RequestResetSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid input.',
      issues: parsed.error.issues.map((i) => ({ message: i.message })),
    }
  }

  const normalisedEmail = parsed.data.email.toLowerCase()
  try {
    const user = await prisma.user.findUnique({ where: { email: normalisedEmail } })
    if (user?.passwordHash !== undefined && user.passwordHash !== null) {
      const rawToken = randomUUID() + '.' + randomUUID()
      const tokenHash = createHash('sha256').update(rawToken).digest('hex')
      await prisma.passwordResetToken.create({
        data: {
          tokenHash,
          userId: user.id,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      })
      console.info(
        `[password-reset] link for ${normalisedEmail}: /reset-password?token=${rawToken}`,
      )
    }
    return { ok: true }
  } catch {
    // Don't leak internals — the caller sees the same neutral success either way.
    return { ok: true }
  }
}

/**
 * Complete a password reset: consume a single-use, unexpired token and set the
 * new password. Deleting the token row also invalidates every older token for
 * that user (one active reset at a time is enough).
 */
export async function resetPassword(input: {
  token: string
  password: string
}): Promise<{ ok: true } | { ok: false; error: string; issues?: Array<{ message: string }> }> {
  // Abuse brake: token-consumption surface, capped per IP.
  const throttled = await checkAuthRateLimit('reset-complete', clientIpFromHeaders(await headers()))
  if (!throttled.ok) return throttled

  const parsed = ResetPasswordSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid input.',
      issues: parsed.error.issues.map((i) => ({ message: i.message })),
    }
  }

  const { token, password } = parsed.data
  const tokenHash = createHash('sha256').update(token).digest('hex')

  try {
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } })
    if (!record || record.expiresAt < new Date() || record.usedAt !== null) {
      return {
        ok: false,
        error: 'This reset link is invalid or has expired. Please request a new one.',
      }
    }

    const passwordHash = await bcrypt.hash(password, 12)
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.passwordResetToken.deleteMany({
        where: { userId: record.userId, id: { not: record.id } },
      }),
    ])

    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not reset password. Please try again.' }
  }
}
