import type { Metadata, Viewport } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import SessionProvider from '@/components/session-provider'
import { JSON_LD } from '@/lib/seo'
import { ServiceWorkerRegistrar } from './sw-init'
import './globals.css'

// Premium typography (Cyber Emerald & Obsidian Gold design system): Inter for
// UI/body text, Space Grotesk for headings. Self-hosted at build time via
// next/font — no runtime network dependency.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const APP_NAME = process.env.APP_NAME ?? 'Pulse AI'
const APP_DESCRIPTION =
  'A streaming AI chatbot with branching conversations, skills, document RAG, and voice input — powered by Pulse AI.'
const THEME_COLOR = '#059669' // matches --accent in globals.css (Cyber Emerald)

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  // PWA manifest — served from /public. Next.js will resolve the icon URLs
  // relative to metadataBase so they're absolute in the generated <head>.
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    title: APP_NAME,
    description: APP_DESCRIPTION,
    siteName: APP_NAME,
  },
  twitter: {
    card: 'summary',
    title: APP_NAME,
    description: APP_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
}

// `viewport` is exported separately from `metadata` in Next.js 13+.
// Theme color and viewport-fit live here so iOS/Android pick them up.
export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
}

// Applied before first paint to avoid a light-mode flash for dark-mode users.
const THEME_SCRIPT = `(function () {
  try {
    var stored = localStorage.getItem('chat.theme');
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {/* PWA: explicit manifest link as a belt-and-braces fallback — the
            `metadata.manifest` field above already injects this for App
            Router pages, but some crawlers prefer a literal <link>. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content={THEME_COLOR} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={APP_NAME} />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192x192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icons/icon-512x512.png" />
      </head>
      <body className={`${inter.variable} ${spaceGrotesk.variable}`}>
        <SessionProvider>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          {children}
          <ServiceWorkerRegistrar />
        </SessionProvider>
      </body>
    </html>
  )
}
