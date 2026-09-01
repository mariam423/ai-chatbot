import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Edge-runtime proxy that gates every non-public route on a valid NextAuth
 * session. In Next.js 16 the file convention moved from `middleware.ts` to
 * `proxy.ts` and the exported function is now expected to be named `proxy`
 * (or be the default export).
 *
 * We use a dedicated NextAuth instance here instead of importing from
 * `lib/auth.ts` — that file pulls in Prisma + bcryptjs, which are Node-only
 * and break the Edge runtime. NextAuth's own cookie reader handles the
 * production `__Secure-` prefix and the development `next-auth.session-token`
 * cookie transparently, so we don't have to duplicate the logic.
 *
 * Set `AUTH_DISABLED=true` in .env to bypass auth entirely (useful for e2e
 * tests and local development before OAuth credentials are configured).
 */
const { auth: edgeAuth } = NextAuth({
  // Cookie name is derived from the request URL — same logic as `lib/auth.ts`
  // but without Prisma/bcryptjs so it stays Edge-compatible.
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: 'jwt' },
  providers: [],
})

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow NextAuth API routes, login page, and static assets through.
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/embed') ||
    pathname.startsWith('/embed') ||
    pathname === '/api/health' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  // Skip auth entirely when disabled (e2e tests, local dev).
  if (process.env.AUTH_DISABLED === 'true') {
    return NextResponse.next()
  }

  // `edgeAuth()` reads the JWT cookie and returns the decoded session, or
  // null when the cookie is missing / invalid. NextAuth v5 handles the
  // `__Secure-` prefix automatically based on the request protocol.
  const session = await edgeAuth()
  if (!session) {
    const loginUrl = new URL('/login', req.nextUrl.origin)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
