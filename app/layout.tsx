import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import SessionProvider from '@/components/session-provider'
import { JSON_LD } from '@/lib/seo'
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

const APP_NAME = process.env.APP_NAME ?? 'Chatbot'
const APP_DESCRIPTION =
  'A streaming AI chatbot with branching conversations, skills, document RAG, and voice input — built with Next.js.'

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
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
      </head>
      <body className={`${inter.variable} ${spaceGrotesk.variable}`}>
        <SessionProvider>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          {children}
        </SessionProvider>
      </body>
    </html>
  )
}
