'use server'

import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'

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
      return { ok: false, error: 'An account with this email already exists.' }
    }

    const passwordHash = await bcrypt.hash(password, 12)
    await prisma.user.create({
      data: { name, email: normalisedEmail, passwordHash },
    })

    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not create account. Please try again.' }
  }
}
