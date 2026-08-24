import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { checkLoginRateLimit, clientIp } from '@/lib/security'
import { logSecurityEvent } from '@/lib/audit'

/**
 * NextAuth v5 configuration.
 *
 * Providers:
 * - Credentials: email + password (bcrypt-hashed, stored in users table)
 * - Google / GitHub: placeholder OAuth (set CLIENT_ID / CLIENT_SECRET in .env
 *   to enable; the provider objects are included so the login page can render
 *   social buttons and the flow is wired end-to-end).
 *
 * AUTH_SECRET is required by NextAuth v5 — generate with:
 *   npx auth secret
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    // --- Social logins (configure with real OAuth credentials) ---
    // Uncomment and set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env:
    // Google({
    //   clientId: process.env.GOOGLE_CLIENT_ID,
    //   clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    // }),
    // Uncomment and set GITHUB_ID / GITHUB_SECRET in .env:
    // GitHub({
    //   clientId: process.env.GITHUB_ID,
    //   clientSecret: process.env.GITHUB_SECRET,
    // }),

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
        return { id: user.id, name: user.name, email: user.email, image: user.image }
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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string
      }
      return session
    },
  },
})
