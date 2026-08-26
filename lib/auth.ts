import NextAuth from 'next-auth'
import type { Account as AuthAccount } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'

import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/db'
import { checkLoginRateLimit, clientIp } from '@/lib/security'
import { logSecurityEvent } from '@/lib/audit'
import { DEFAULT_USER_ROLE, normalizeUserRole, type UserRole } from '@/lib/roles'
import bcrypt from 'bcryptjs'
import { sendWelcomeEmail } from '@/lib/email'

/**
 * Provider credentials support both the app's documented names and Auth.js
 * names. Local development can opt into placeholder credentials so the
 * provider discovery endpoint exposes the buttons before real OAuth apps are
 * registered. These values are never enabled in production.
 */
const useDevelopmentOAuthMocks =
  process.env.NODE_ENV !== 'production' && process.env.DEV_OAUTH_MOCK !== 'false'
const googleClientId =
  process.env.GOOGLE_CLIENT_ID ||
  process.env.AUTH_GOOGLE_ID ||
  (useDevelopmentOAuthMocks ? 'mock-google-client-id' : undefined)
const googleClientSecret =
  process.env.GOOGLE_CLIENT_SECRET ||
  process.env.AUTH_GOOGLE_SECRET ||
  (useDevelopmentOAuthMocks ? 'mock-google-client-secret' : undefined)
const githubClientId =
  process.env.GITHUB_ID ||
  process.env.AUTH_GITHUB_ID ||
  (useDevelopmentOAuthMocks ? 'mock-github-client-id' : undefined)
const githubClientSecret =
  process.env.GITHUB_SECRET ||
  process.env.AUTH_GITHUB_SECRET ||
  (useDevelopmentOAuthMocks ? 'mock-github-client-secret' : undefined)

type AppPlan = 'free' | 'pro'
export type AppRole = UserRole

export { normalizeUserRole }

function normalizePlan(value: string | null | undefined): AppPlan {
  return value === 'pro' ? 'pro' : 'free'
}

const socialProviders = [
  ...(googleClientId && googleClientSecret
    ? [Google({ clientId: googleClientId, clientSecret: googleClientSecret })]
    : []),
  ...(githubClientId && githubClientSecret
    ? [GitHub({ clientId: githubClientId, clientSecret: githubClientSecret })]
    : []),
]

/**
 * Persist an OAuth identity in the application's Prisma tables.
 *
 * Auth.js's credentials provider requires JWT sessions, so this app keeps JWT
 * sessions while explicitly persisting OAuth users/accounts. Account-first
 * lookup prevents an OAuth identity from being relinked to a different email;
 * email lookup then lets a verified social email join an existing credentials
 * account instead of creating a duplicate user.
 */
async function persistOAuthIdentity(
  user: {
    id?: string
    name?: string | null
    email?: string | null
    image?: string | null
  },
  account: AuthAccount,
): Promise<{ id: string; role: AppRole; plan: AppPlan } | null> {
  if (!['google', 'github'].includes(account.provider) || !account.providerAccountId) {
    return null
  }
  const email = user.email?.trim().toLowerCase()
  if (!email) return null

  const linkedAccount = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      },
    },
    select: { userId: true },
  })
  const existingUser = linkedAccount
    ? await prisma.user.findUnique({ where: { id: linkedAccount.userId } })
    : await prisma.user.findUnique({ where: { email } })

  const profileData = {
    ...(user.name?.trim() ? { name: user.name.trim() } : {}),
    ...(user.image ? { image: user.image } : {}),
    emailVerified: existingUser?.emailVerified ?? new Date(),
  }
  const dbUser = existingUser
    ? await prisma.user.update({ where: { id: existingUser.id }, data: profileData })
    : await prisma.user.create({
        data: {
          email,
          ...profileData,
          // Explicit for readability; the database default also protects
          // callers that create users outside this auth module.
          role: DEFAULT_USER_ROLE,
          plan: 'free',
        },
      })

  if (!existingUser) void sendWelcomeEmail(email, user.name)

  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      },
    },
    create: {
      id: randomUUID(),
      userId: dbUser.id,
      type: account.type,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      refresh_token: account.refresh_token ?? null,
      access_token: account.access_token ?? null,
      expires_at: account.expires_at ?? null,
      token_type: account.token_type ?? null,
      scope: account.scope ?? null,
      id_token: account.id_token ?? null,
      session_state: (account as AuthAccount & { session_state?: string }).session_state ?? null,
    },
    update: {
      userId: dbUser.id,
      type: account.type,
      refresh_token: account.refresh_token ?? null,
      access_token: account.access_token ?? null,
      expires_at: account.expires_at ?? null,
      token_type: account.token_type ?? null,
      scope: account.scope ?? null,
      id_token: account.id_token ?? null,
      session_state: (account as AuthAccount & { session_state?: string }).session_state ?? null,
    },
  })

  return {
    id: dbUser.id,
    role: normalizeUserRole(dbUser.role),
    plan: normalizePlan(dbUser.plan),
  }
}

/**
 * NextAuth v5 configuration.
 *
 * Providers:
 * - Credentials: email + password (bcrypt-hashed, stored in users table)
 * - Google and GitHub: enabled when their OAuth credentials are configured;
 *   local development may use `DEV_OAUTH_MOCK=true` (the default outside
 *   production) to make the buttons discoverable; the login page discovers
 *   enabled providers from /api/auth/providers.
 *
 * AUTH_SECRET is required by NextAuth v5 — generate with:
 *   npx auth secret
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    ...socialProviders,

    // --- Email + password ---
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null

        const email = String(credentials.email).toLowerCase().trim()
        const password = String(credentials.password)

        // Abuse brake: per-IP flood cap + per-account guessing cap, checked
        // before bcrypt (the expensive step). A throttled attempt returns
        // null — the same generic failure as a wrong password, so nothing
        // leaks about which limit tripped.
        const allowed = await checkLoginRateLimit(clientIp(request), email)
        if (!allowed) return null

        const user = await prisma.user.findUnique({ where: { email } })
        if (!user?.passwordHash) {
          logSecurityEvent('auth_failed', { email, ip: clientIp(request), reason: 'no_account' })
          return null
        }

        const valid = await bcrypt.compare(password, user.passwordHash)
        if (!valid) {
          logSecurityEvent('auth_failed', { email, ip: clientIp(request), reason: 'bad_password' })
          return null
        }

        logSecurityEvent('auth_succeeded', { userId: user.id, email }, 'info')
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: normalizeUserRole(user.role),
          plan: normalizePlan(user.plan),
        }
      },
    }),
  ],

  // Cookie policy (OWASP A02): @auth/core's defaults are already the secure
  // set — httpOnly, sameSite=lax, and `secure` + the `__Secure-`/`__Host-`
  // name prefixes derived from the request protocol (https → secure cookies;
  // see @auth/core `useSecureCookies`). We intentionally don't override them:
  // a hardcoded `secure` flag would break behind proxies and in local dev,
  // where the dynamic protocol-based default is correct. HTTPS itself is
  // enforced by the HSTS header shipped in next.config.ts (production only).
  session: { strategy: 'jwt' },

  pages: {
    signIn: '/login',
  },

  callbacks: {
    async signIn({ user, account }) {
      if (!account || account.provider === 'credentials') return true
      try {
        const persisted = await persistOAuthIdentity(user, account)
        if (!persisted) return false
        // Auth.js uses this object to seed the initial JWT. Replace the
        // provider profile id with our stable Prisma user id and include the
        // current billing claims in the first session response.
        user.id = persisted.id
        user.role = persisted.role
        user.plan = persisted.plan
        return true
      } catch {
        return false
      }
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.plan = user.plan
      } else if (token.id) {
        // Keep role/plan current after a Stripe webhook changes the account;
        // users should not need to sign out and back in to see the new plan.
        try {
          const current = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { role: true, plan: true },
          })
          if (current) {
            token.role = normalizeUserRole(current.role)
            token.plan = normalizePlan(current.plan)
          }
        } catch {
          // Preserve the signed JWT if the database is briefly unavailable.
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string
        session.user.role = token.role as UserRole | undefined
        session.user.plan = token.plan as 'free' | 'pro' | undefined
      }
      return session
    },
  },
})
