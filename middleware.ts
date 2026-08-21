import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Lightweight middleware that checks for a NextAuth session token.
 *
 * We intentionally avoid importing `auth()` from `lib/auth.ts` here because
 * that module pulls in Prisma + bcryptjs, which are Node-only and break the
 * Edge runtime. Instead we read the JWT cookie directly — it's a standard
 * `next-auth.session-token` (or `__Secure-next-auth.session-token` in prod)
 * cookie whose presence means the user is signed in.
 *
 * Set AUTH_DISABLED=true in .env to bypass auth entirely (useful for e2e tests
 * and local development before OAuth credentials are configured).
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow NextAuth API routes, login page, and static assets through.
  if (
    pathname.startsWith('/api/auth') ||
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

  // Check for the NextAuth session cookie. In development the cookie name
  // is `next-auth.session-token`; in production it is prefixed with `__Secure-`.
  const token =
    req.cookies.get('next-auth.session-token')?.value ??
    req.cookies.get('__Secure-next-auth.session-token')?.value

  if (!token) {
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
