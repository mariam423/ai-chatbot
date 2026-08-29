<div align="center">

# AI Chatbot

### A production-grade, streaming AI chatbot — installable as a PWA, with branching conversations, document RAG, voice input, and multi-provider OAuth. Built on Next.js 16 and deployed on Vercel.

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/mariam423/ai-chatbot?style=for-the-badge&color=10b981" alt="License" /></a>
  <a href="https://github.com/mariam423/ai-chatbot/stargazers"><img src="https://img.shields.io/github/stars/mariam423/ai-chatbot?style=for-the-badge&color=fbbf24" alt="Stars" /></a>
  <a href="https://github.com/mariam423/ai-chatbot/issues"><img src="https://img.shields.io/github/issues/mariam423/ai-chatbot?style=for-the-badge" alt="Issues" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.3-black?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 6" />
  <img src="https://img.shields.io/badge/TailwindCSS-4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind 4" />
  <img src="https://img.shields.io/badge/Prisma-7.9-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma 7" />
  <img src="https://img.shields.io/badge/PostgreSQL-Neon-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL on Neon" />
  <img src="https://img.shields.io/badge/Auth.js-5-000?style=for-the-badge&logo=nextauth&logoColor=white" alt="Auth.js" />
  <img src="https://img.shields.io/badge/PWA-Installable-5A29E4?style=for-the-badge&logo=pwa&logoColor=white" alt="PWA" />
  <img src="https://img.shields.io/badge/Deployed-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
</p>

</div>

---

> _A real-world SaaS template that goes beyond the demo: production security headers (OWASP A05), streaming LLM responses, error-fallback model routing, encrypted user secrets, an offline-capable PWA shell, and a polished glassmorphic interface._

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Authentication](#authentication)
- [PWA & Offline](#pwa--offline)
- [Next.js 16 & Proxy](#nextjs-16--proxy)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

A full-featured AI chatbot built on the Next.js 16 App Router, with everything needed to ship a real product — not just a demo.

**Core capabilities**

- **Multi-model LLM routing** via [OpenRouter](https://openrouter.ai) with per-provider fallbacks for `404` / `402` / `429` errors, plus optional direct integrations with OpenAI, Gemini, Groq, Together, and Ollama.
- **Branching conversations** — fork any assistant reply, share prefix across multiple branches, persist across sessions.
- **Document RAG** — upload PDFs / text, chunk + embed, retrieve with inline citations.
- **Voice input & speech** — browser Web Speech API plus a server-side `/api/transcribe` fallback.
- **Skills & custom agents** — pluggable skills (weather, web search, Kroki diagrams, Google Calendar) and user-defined custom agents.
- **Multi-provider auth** — email + password, Google OAuth, GitHub OAuth. Account linking on shared verified emails.
- **Progressive Web App** — installable on desktop and mobile, with an offline fallback page and a smart service worker.
- **Production security** — CSP, HSTS, `frame-ancestors 'none'`, and the rest of the OWASP A05 header set.
- **Stripe billing** — Pro tier with webhook-synced plan state.
- **Embeddable widget** — drop the chat into any external site via `app/embed-widget.js`.

---

## Tech Stack

### Core framework

| Layer | Technology | Notes |
| --- | --- | --- |
| Framework | **[Next.js 16.3](https://nextjs.org)** | App Router, RSC, Server Actions, and the new `proxy.ts` convention. |
| UI | **[React 19](https://react.dev)** + **TypeScript 6** | Server components by default; client components marked with `'use client'`. |
| Styling | **[Tailwind CSS 4](https://tailwindcss.com)** | Plus a token system of CSS variables (`--bg-deep`, `--accent`, `--gold`, …) for the Cyber Emerald & Obsidian Gold design system. |
| Animation | **[Framer Motion 13](https://www.framer.com/motion/)** | Page transitions, ambient glows, micro-interactions. |
| Fonts | **Inter** + **Space Grotesk** | Self-hosted at build time via `next/font`. |

### Data & backend

| Layer | Technology | Notes |
| --- | --- | --- |
| Database | **[PostgreSQL on Neon](https://neon.tech)** | Branching, serverless-friendly. |
| ORM | **[Prisma 7.9](https://www.prisma.io)** | With the `@prisma/adapter-pg` driver adapter for a single connection pool per process. |
| Encryption | **AES-256-GCM** | Field-level encryption for sensitive `UserPreference` rows. |
| Auth | **[Auth.js v5](https://authjs.dev)** | Credentials + Google + GitHub, JWT sessions. |
| Payments | **[Stripe](https://stripe.com)** | Webhooks sync `User.plan`. |
| Email | **[Resend](https://resend.com)** or SendGrid | Transactional email. |
| Rate limiting | **Redis** (optional) | Shared store across serverless instances. |

### PWA

- **Manifest** — `public/manifest.webmanifest` with maskable icons and a "New Chat" shortcut.
- **Service worker** — vanilla `public/sw/service-worker.js`. No extra dependencies. Cache-first for `/_next/static/*`, network-first for navigations, stale-while-revalidate elsewhere.
- **Offline fallback** — `app/offline/page.tsx`, served when no cached copy of a navigation exists.

### Tooling

- **ESLint 9**, **Prettier 3**, **TypeScript 6**
- **Vitest** for unit + integration tests
- **Playwright** for e2e (boots the production build, exercises the real CSP)
- **GitHub Actions** for CI

---

## Getting Started

### Prerequisites

- **Node.js ≥ 20** (Node 22 LTS recommended)
- **npm**, **pnpm**, or **yarn**
- A free **[Neon](https://neon.tech)** Postgres account
- An **[OpenRouter](https://openrouter.ai/keys)** API key
- _(Optional)_ Google and/or GitHub OAuth app credentials for social sign-in

### 1. Clone & install

```bash
git clone https://github.com/mariam423/ai-chatbot.git
cd ai-chatbot
npm install
```

The `postinstall` hook runs `prisma generate` automatically. The repo ships an `.npmrc` with `allow-scripts=true` so Prisma's native client and `unrs-resolver` postinstall steps run cleanly on Vercel.

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

The full reference lives in [`docs/environment-variables.md`](./docs/environment-variables.md). The minimum to boot the app:

```bash
# Database — get this from https://console.neon.tech → Connection Details
# Use the *pooled* connection string in production.
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxxxx.us-east-2.aws.neon.tech/neondb?sslmode=require"

# LLM gateway
OPENROUTER_API_KEY="sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# NextAuth session signing — generate with: openssl rand -base64 32
AUTH_SECRET="your-long-random-secret-here"
```

### 3. Apply the database schema

```bash
npx prisma db push
```

> Use `npx prisma migrate dev --name init` instead if you want a migration history. The schema lives at `prisma/schema.prisma`.

### 4. Run the dev server

```bash
npm run dev
```

The app is now live at **<http://localhost:3000>**. Sign up with email + password, or click the Google / GitHub buttons after you wire up OAuth credentials in step 2.

### Available scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server with HMR |
| `npm run build` | Production build (same code path Vercel uses) |
| `npm run start` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint + Prettier check + typecheck |
| `npm run format` | Auto-format with Prettier |
| `npm run test` | Vitest unit + integration tests |
| `npm run test:e2e` | Playwright e2e (boots the prod build, exercises real CSP) |
| `npm run check` | Typecheck + tests in one shot |

### Deploying to Vercel

A full step-by-step walkthrough is in [`docs/deployment-vercel.md`](./docs/deployment-vercel.md). The short version:

1. **Import** the repository at <https://vercel.com/new>. Vercel auto-detects it as a Next.js project.
2. **Add environment variables** in Project Settings (at minimum `DATABASE_URL`, `OPENROUTER_API_KEY`, `AUTH_SECRET`). See [`docs/environment-variables.md`](./docs/environment-variables.md) for the full list.
3. **Use Neon's _pooled_ connection string** for `DATABASE_URL` (the one with `?pgbouncer=true&...`). Serverless functions open many short-lived connections — the pooler keeps the count under Neon's limit.
4. **Click Deploy.** After the first successful build, set `NEXT_PUBLIC_APP_URL` to your production URL and configure the OAuth callback URLs (see [Authentication](#authentication) below).
5. **Every push to `main`** triggers a new production deployment automatically.

---

## Authentication

Authentication is handled by **Auth.js v5 (NextAuth)** and exposed through the App Router catch-all route at `app/api/auth/[...nextauth]/route.ts`. The full configuration lives in [`lib/auth.ts`](./lib/auth.ts).

### Supported providers

| Provider | Mode | When it's active |
| --- | --- | --- |
| **Email + Password** | `Credentials` | Always available. Passwords are bcrypt-hashed and stored in the `users` table. |
| **Google OAuth** | `Google` | Active when both `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` (or the `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` aliases) are set. |
| **GitHub OAuth** | `GitHub` | Active when both `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` (or the `GITHUB_ID` / `GITHUB_SECRET` aliases) are set. |

The login page ([`app/login/page.tsx`](./app/login/page.tsx)) fetches enabled providers from `/api/auth/providers` and renders only the buttons that are actually registered, so missing env vars simply hide the buttons — the app boots cleanly either way.

> **Dev convenience:** In `NODE_ENV !== 'production'`, setting `DEV_OAUTH_MOCK` (default `true` in dev) injects placeholder OAuth credentials so the Google / GitHub buttons appear locally even before you've registered real OAuth apps. This is **never** active in production.

### Required environment variables

| Variable | Required? | Purpose | How to obtain |
| --- | --- | --- | --- |
| `AUTH_SECRET` | ✅ | NextAuth session signing. | `npx auth secret` or `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | recommended | `true` when behind a proxy / Vercel. | — |
| `AUTH_GOOGLE_ID` _or_ `GOOGLE_CLIENT_ID` | ⬜ for the button | Google OAuth client ID. | [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials |
| `AUTH_GOOGLE_SECRET` _or_ `GOOGLE_CLIENT_SECRET` | ⬜ for the button | Google OAuth client secret. | Same screen as above. |
| `AUTH_GITHUB_ID` _or_ `GITHUB_ID` | ⬜ for the button | GitHub OAuth client ID. | [GitHub Developer Settings](https://github.com/settings/developers) → New OAuth App |
| `AUTH_GITHUB_SECRET` _or_ `GITHUB_SECRET` | ⬜ for the button | GitHub OAuth client secret. | Same screen as above. |
| `AUTH_DISABLED` | ⬜ | `true` bypasses all auth (e2e tests, local dev before OAuth is configured). | — |

Both naming conventions are accepted — the lookup is `AUTH_<PROVIDER>_*` first, then the legacy alias.

### OAuth callback URLs

When you register your OAuth apps, point them at:

- **Google:** `https://<your-domain>/api/auth/callback/google`
- **GitHub:** `https://<your-domain>/api/auth/callback/github`

For local development, also add `http://localhost:3000/api/auth/callback/<provider>`.

### Verifying which providers are active in production

On cold start in production, the auth module logs a single diagnostic line to the Vercel function logs:

```
[auth] oauth providers active: { google: true, github: false } — set AUTH_GOOGLE_ID/SECRET and AUTH_GITHUB_ID/SECRET to enable.
```

If a button is missing on the live login page, check this line first — it tells you exactly which provider didn't register and why.

### Account linking

When a user signs in with Google or GitHub using a verified email that already exists in the `users` table, the OAuth identity is linked to that existing account rather than creating a duplicate. Account-first lookup (by `provider` + `providerAccountId`) prevents the same OAuth identity from being relinked to a different email later.

---

## PWA & Offline

The app is a fully installable Progressive Web App. Once installed, it launches in a standalone window (no browser chrome), uses the Cyber Emerald theme color (`#059669`) for the status bar, and exposes a "New Chat" shortcut in the OS app menu.

### Installing the app

| Platform | How to install |
| --- | --- |
| **Chrome / Edge (desktop)** | Click the **install icon** in the address bar, or open the browser menu and choose "Install AI Chatbot". |
| **Android (Chrome)** | Tap the browser menu → "Install app" (or "Add to Home screen"). The app appears in the launcher with the emerald icon. |
| **iOS / iPadOS (Safari)** | Tap **Share → Add to Home Screen**. iOS doesn't surface the install icon, but the manifest and Apple-specific meta tags make the home-screen experience work. |
| **ChromeOS** | The install icon appears in the address bar; the app installs like a native app. |

PWA install requires **HTTPS** — Vercel provides this automatically. Localhost also works for testing in Chrome with DevTools overrides.

### What's included

| File | Purpose |
| --- | --- |
| [`public/manifest.webmanifest`](./public/manifest.webmanifest) | PWA manifest — name, icons, theme color, display mode, shortcuts. |
| [`public/sw/service-worker.js`](./public/sw/service-worker.js) | Vanilla service worker. Smart caching strategy (see below). |
| [`app/offline/page.tsx`](./app/offline/page.tsx) | Static offline fallback page, served when no cached copy of a navigation exists. |
| [`app/sw-init.tsx`](./app/sw-init.tsx) | Client component that registers the SW on `load` with a `serviceWorker in navigator` guard. Renders nothing. |
| `public/icons/icon-192x192.png` | PWA icon (192×192, maskable). |
| `public/icons/icon-512x512.png` | PWA icon (512×512, maskable). |
| `app/layout.tsx` | Injects the manifest `<link>`, `theme-color` meta, Apple-specific tags, and the SW registrar. |

### Offline capabilities

The service worker caches the app shell on install, so the login page and any previously-visited routes load even with no network. Concretely:

- **First visit (online):** the SW installs, precaches `/offline` and `/manifest.webmanifest`, and activates without affecting page load.
- **Subsequent visits (offline):** cached navigations and `/_next/static/*` assets still load. The chat itself requires the network (LLM requests are never cached).
- **Never visited (offline):** if the user goes straight to a URL they've never loaded while offline, the SW serves `/offline` with a clear "you're offline" message.

### Caching strategy

| Request type | Strategy | Why |
| --- | --- | --- |
| `/_next/static/*` | **Cache-first** | Hashed assets are immutable; network only on first visit. |
| Navigations (`request.mode === 'navigate'`) | **Network-first**, fall back to cache, then `/offline` | Always show fresh content when online; degrade gracefully when not. |
| Other same-origin GETs | **Stale-while-revalidate** | Show cached copy instantly, refresh from network in the background. |
| `/api/*` | **Bypassed** | NextAuth, streaming LLM responses, and Stripe webhooks are never cached. |
| Cross-origin requests | **Bypassed** | LLM image replies, analytics beacons, and other third-party traffic go straight to the network. |

Cache names are versioned (`static-v1.0.0`, `runtime-v1.0.0`) and pruned on `activate`, so every deploy evicts stale caches automatically.

### Verifying the install

1. Deploy to Vercel (PWA install requires HTTPS).
2. Open the production URL in Chrome / Edge → look for the **install icon** in the address bar.
3. Open DevTools → **Application → Manifest** to confirm the manifest is detected.
4. Open DevTools → **Application → Service Workers** to confirm `/sw/service-worker.js` is **activated and running**.

If the install icon doesn't appear, the most common causes are a missing manifest, a failed SW registration, or missing icons — all three are checkable from the DevTools panels above.

---

## Next.js 16 & Proxy

This project runs on **Next.js 16.3**, which deprecates the `middleware.ts` file convention in favor of **`proxy.ts`**. The migration is already complete in this repo.

### What changed

- `middleware.ts` at the project root was renamed to `proxy.ts` (using `git mv` to preserve history).
- The exported function was renamed from `middleware` to `proxy` to match Next.js 16's expected export name. (A default export also works.) The `config.matcher` is unchanged.
- The proxy still reads the NextAuth session cookie directly (rather than calling `auth()`) to stay on the Edge runtime and avoid loading Prisma + bcryptjs, which are Node-only.

### Adding new proxy rules

Edit [`proxy.ts`](./proxy.ts) — do **not** create a new `middleware.ts` file, as Next.js 16 logs a deprecation warning and may remove support in a future release.

```ts
// proxy.ts — current matcher
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
```

### Security headers

Production-only security headers (CSP, HSTS, `frame-ancestors 'none'`, the OWASP A05 set) are configured in [`next.config.ts`](./next.config.ts) under `async headers()`. The e2e suite boots `next start` and verifies these against the real production CSP, so the test surface exercises the deployed guardrails, not a watered-down dev configuration.

---

## Testing

```bash
npm run check         # typecheck + vitest
npm run test:e2e      # full Playwright suite against the prod build
```

The e2e suite runs against the production build to exercise the real CSP, real security headers, and the real PWA install surface. New features should ship with at least one Vitest unit test for the data layer and one Playwright spec for the user-visible flow.

---

## Project Structure

```
ai-chatbot/
├── app/                          # Next.js App Router
│   ├── api/                      # Route handlers: chat, upload, transcribe, speak, auth, stripe…
│   ├── dashboard/                # Analytics & session insights
│   ├── embed/                    # Embeddable widget routes
│   ├── login/                    # Auth UI
│   ├── offline/                  # PWA offline fallback page
│   ├── settings/                 # User preferences, custom agents, API keys
│   ├── layout.tsx                # Root layout (PWA meta tags, SW registrar, theme bootstrap)
│   └── sw-init.tsx               # Client component that registers the PWA service worker
├── components/                   # Client components (chat shell, sidebar, message bubble…)
├── lib/                          # Shared server logic (db, auth, llm-config, rag, billing, skills…)
├── prisma/                       # schema.prisma (Postgres dialect)
├── public/
│   ├── icons/                    # PWA icons (192×192, 512×512)
│   ├── manifest.webmanifest      # PWA manifest
│   └── sw/                       # PWA service worker
├── tests/                        # Vitest specs
├── e2e/                          # Playwright specs
├── proxy.ts                      # Next.js 16 routing proxy (formerly middleware.ts)
├── next.config.ts                # Next config + production security headers
├── docs/
│   ├── environment-variables.md  # Full env var reference, including aliases
│   └── deployment-vercel.md      # Vercel deployment walkthrough
└── scripts/                      # Operational scripts
```

---

## Contributing

Issues and pull requests are welcome. For substantial changes, please open an issue first to discuss the design.

1. Fork the repo and create a feature branch (`git checkout -b feat/my-feature`)
2. Run `npm run check` and `npm run test:e2e` locally
3. Open a PR with a clear description of the change and any new env vars

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.

---

<div align="center">

**Built with care by <a href="https://github.com/mariam423">@mariam423</a>.**
If this project helped you, a ⭐ is the best way to say thanks.

</div>
