import type { NextConfig } from 'next'

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
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
