/**
 * SEO helpers — structured data and metadata building blocks.
 *
 * The JSON-LD here is static (rendered in the root layout head); pages that
 * need dynamic structured data (e.g. a session-specific title) can compose
 * their own <script type="application/ld+json"> from the same site data.
 */

const APP_NAME = process.env.APP_NAME ?? 'Pulse AI'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/** Structured data for the WebApplication — used by the root layout head. */
export const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: APP_NAME,
  url: APP_URL,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Any',
  description:
    'A streaming AI chatbot with branching conversations, skills, document RAG, and voice input — powered by Pulse AI.',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  author: {
    '@type': 'Organization',
    name: APP_NAME,
  },
}

/** Site-level facts shared by metadata builders. */
export const SITE = {
  name: APP_NAME,
  url: APP_URL,
  description:
    'A streaming AI chatbot with branching conversations, skills, document RAG, and voice input — powered by Pulse AI.',
} as const

/** Compose a page title honoring the layout's `%s` template. */
export function pageTitle(title: string): string {
  return `${title} · ${APP_NAME}`
}
