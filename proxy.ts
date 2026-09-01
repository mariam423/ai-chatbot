import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Edge-runtime proxy that gates every non-public route on a valid NextAuth
 * session token cookie. In Next.js 16 the file convention moved from
 * `middleware.ts` to `proxy.ts` and the exported function is now expected to
 * be named `proxy` (or be the default export).
 *
 * We intentionally avoid importing `auth()` from `lib/auth.ts` here because
 * that module pulls in Prisma + bcryptjs, which are Node-only and break the
 * Edge runtime. We also do not use `NextAuth({...}).auth()` instantiated
 * inline: that helper reads from `next/headers` (Node) and silently returns
 * null in the Edge runtime, so it can't gate routes. A manual cookie lookup
 * is the only thing that works in this runtime.
 *
 * Cookie name history — `@auth/core` v0.34 used `next-auth.session-token`;
 * v0.40+ renamed it to `authjs.session-token` (and `__Secure-authjs.session-token`
 * for the production HTTPS variant). The two names are kept below so an
 * upgrade or downgrade of @auth/core doesn't immediately break the gate.
 * Verified against `node_modules/@auth/core/lib/utils/cookie.js` and the live
 * `Set-Cookie` header from `https://ai-chatbot-rose-ten.vercel.app/api/auth/csrf`.
 *
 * Set `AUTH_DISABLED=true` in .env to bypass auth entirely (useful for e2e
 * tests and local development before OAuth credentials are configured).
 */
export function proxy(req: NextRequest) {
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

  // Session token cookie. Prefer the production `__Secure-` variant — Vercel
  // sets cookies with `Secure` on HTTPS, so the dev plain `authjs.session-token`
  // would never appear. Falling back to it covers local dev and any future
  // flip of `useSecureCookies`.
  const token =
    req.cookies.get('__Secure-authjs.session-token')?.value ??
    req.cookies.get('authjs.session-token')?.value ??
    // Legacy names from @auth/core < 0.40 / next-auth v4. Kept as a last
    // resort so an in-place downgrade of @auth/core doesn't immediately
    // lock everyone out. These can be removed once the @auth/core version
    // is pinned.
    req.cookies.get('__Secure-next-auth.session-token')?.value ??
    req.cookies.get('next-auth.session-token')?.value

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
