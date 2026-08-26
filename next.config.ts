import type { NextConfig } from 'next'

/**
 * Security headers (OWASP A05). The strict set — CSP + HSTS — applies only to
 * production builds: Next dev needs `unsafe-eval` for HMR and the app runs on
 * plain http locally, so a production-only policy keeps both working while
 * still shipping the full guardrail on deployed builds (e2e runs the prod
 * build, so the suite exercises the real CSP).
 *
 * CSP notes:
 *  - `script-src 'self' 'unsafe-inline'`: the app embeds inline scripts
 *    (theme bootstrapping + Next's RSC flight payload), so inline scripts
 *    must be allowed. The policy still blocks remote scripts, eval, data:
 *    scripts, and object embeds — the meaningful injection surface.
 *  - `style-src 'unsafe-inline'`: Framer Motion and inline style props set
 *    style attributes at runtime.
 *  - `img-src https:`: LLM replies may embed external images.
 *  - `frame-src 'self'`: the chat-export print preview uses a srcdoc iframe.
 *  - `frame-ancestors 'none'` + `X-Frame-Options: DENY` together stop the
 *    app being framed (clickjacking).
 */
const PROD_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob: data:",
  "frame-src 'self'",
].join('; ')

const isProduction = process.env.NODE_ENV === 'production'

const nextConfig: NextConfig = {
  // Long-lived caching for immutable static assets (images, fonts, icons).
  // Hashed Next.js chunks under /_next/static are already immutable in
  // production builds; this extends the same treatment to the app's own
  // static image/font files so repeat visits hit the browser cache.
  async headers() {
    return [
      {
        source: '/:path*.(svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|eot)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/((?!embed(?:/|$)).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isProduction
            ? [
                { key: 'Content-Security-Policy', value: PROD_CSP },
                // HSTS is only honored by browsers over https, so it's safe
                // to send unconditionally in production.
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
      {
        source: '/embed/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; frame-ancestors *; object-src 'none'; base-uri 'none'",
          },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
