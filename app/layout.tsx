import type { Metadata } from 'next'
import SessionProvider from '@/components/session-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'Chatbot',
  description: 'A simple streaming chatbot built with Next.js and an LLM API',
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
      </head>
      <body>
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
