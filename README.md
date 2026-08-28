<div align="center">

# AI Chatbot

### A production-grade, streaming AI chatbot with branching conversations, document RAG, voice input, and a custom glassmorphism UI — built on Next.js 16 and deployed on Vercel.

<p align="center">
  <a href="https://github.com/mariam423/ai-chatbot/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/mariam423/ai-chatbot?style=for-the-badge&color=10b981" alt="License" />
  </a>
  <a href="https://github.com/mariam423/ai-chatbot/stargazers">
    <img src="https://img.shields.io/github/stars/mariam423/ai-chatbot?style=for-the-badge&color=fbbf24" alt="Stars" />
  </a>
  <a href="https://github.com/mariam423/ai-chatbot/issues">
    <img src="https://img.shields.io/github/issues/mariam423/ai-chatbot?style=for-the-badge" alt="Issues" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.3-black?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/Prisma-7.9-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma 7" />
  <img src="https://img.shields.io/badge/PostgreSQL-Neon-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL on Neon" />
  <img src="https://img.shields.io/badge/NextAuth-5.0-000?style=for-the-badge&logo=nextauth&logoColor=white" alt="NextAuth 5" />
  <img src="https://img.shields.io/badge/TailwindCSS-4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind 4" />
  <img src="https://img.shields.io/badge/Deployed-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
</p>

<br />

> _A real-world SaaS template that goes beyond the demo: production security headers (OWASP A05), streaming LLM responses, error-fallback model routing, encrypted user secrets, and a polished glassmorphic interface._

</div>

---

## 📸 Visual Demo

A short GIF speaks louder than a thousand words. To add one to your README:

1. Record a screen capture of the live app (Chrome DevTools → Settings → "Open DevTools" → More Tools → "Recorder" works well, or use [`loom.com`](https://www.loom.com) / [`obsidian.gg`](https://obsidian.gg)).
2. Export as a GIF or MP4. Aim for **under 10 MB** for fast loading on GitHub.
3. Drop the file at `public/demo.gif` (or a CDN-hosted URL).
4. Replace the placeholder below with:

```markdown
![AI Chatbot Demo](./public/demo.gif)
```

```markdown
<!-- Replace this block with your demo -->
<p align="center">
  <em>🎬 Drop your demo GIF at <code>public/demo.gif</code> and replace this section.</em>
</p>
```

---

## ✨ Key Features

| Feature | Description |
| --- | --- |
| 🎨 **Glassmorphism UI** | Layered translucent surfaces (`backdrop-blur` + custom CSS variables `--glass-bg`, `--glass-border`) with a Cyber Emerald & Obsidian Gold design system — Inter for body, Space Grotesk for headings. |
| 🔐 **Secure Authentication** | NextAuth v5 (Auth.js) with email/password (bcrypt-hashed) plus Google & GitHub OAuth. Account linking, password reset tokens, and email verification are first-class. |
| 🗄️ **Serverless Postgres on Neon** | Branching, branching, forking data backed by Neon. The `@prisma/adapter-pg` driver adapter means a single connection pool per process — works identically on Vercel Serverless and local dev. |
| 🤖 **Multi-Model AI Routing** | OpenRouter integration (200+ models behind one API key) with per-provider fallbacks for `404`/`402`/`429` errors. Vision inputs auto-route to vision-capable models. |
| 🌿 **Branching Conversations** | Fork any assistant reply, share a prefix across multiple branches, and persist them across sessions (composite key `sessionId + branchId + id`). |
| 📄 **Document RAG** | Upload PDFs / text, get them chunked + embedded (stored as serialized vectors), and retrieve them as context for the model. Citations are linked back inline. |
| 🛠️ **Skills & Custom Agents** | A pluggable skill system (weather, web search, diagrams via Kroki, Google Calendar scheduling) plus user-created custom agents with their own system prompts and tool selections. |
| 🎙️ **Voice & Speech** | Browser Web Speech API for in-app TTS, server-side `/api/transcribe` for browsers without it, and a `TTS_MODEL` adapter override for paid providers. |
| 🔒 **Security Headers** | Production-only CSP, HSTS, `frame-ancestors 'none'`, and the rest of the OWASP A05 set — verified by the e2e suite against a real production build. |
| 🧩 **Embeddable Widget** | Ship the chat in any external site via `app/embed-widget.js` (Streamable-HTTP iframe wrapper). |
| 💳 **Stripe Billing** | Pro tier unlocks unlimited daily LLM usage; webhooks sync the plan on `User.plan`. |

---

## 🧱 Tech Stack

### Core
- **[Next.js 16.3](https://nextjs.org)** (App Router, RSC, Server Actions)
- **[React 19](https://react.dev)** + TypeScript
- **[Tailwind CSS 4](https://tailwindcss.com)** + custom CSS variables
- **[Framer Motion 13](https://www.framer.com/motion/)** for transitions

### Data Layer
- **[PostgreSQL](https://www.postgresql.org)** hosted on **[Neon](https://neon.tech)**
- **[Prisma 7.9](https://www.prisma.io)** with the `@prisma/adapter-pg` driver adapter
- AES-256-GCM field encryption for sensitive `UserPreference` rows

### AI & Integrations
- **[OpenRouter](https://openrouter.ai)** as the primary LLM gateway
- **Optional providers:** Google Gemini (direct OpenAI-compatible endpoint), OpenAI, Groq, Together, Ollama
- **[NextAuth v5](https://authjs.dev)** for credentials + OAuth (Google, GitHub)
- **[Stripe](https://stripe.com)** for subscriptions
- **[Resend](https://resend.com)** or SendGrid for transactional email
- Optional: PostHog analytics, Redis (Upstash, ElastiCache) for shared rate limits

### Tooling
- ESLint 9, Prettier 3, TypeScript 6
- Vitest (unit + integration), Playwright (e2e, runs against the production build)
- GitHub Actions CI

---

## 🚀 Getting Started

### Prerequisites

- **Node.js ≥ 20** (Node 22 LTS recommended — Next 16 + Prisma 7 require modern Node)
- **npm** (or pnpm / yarn — `pnpm` is what the maintainer uses)
- A **Neon** account (free tier is enough): <https://neon.tech>
- An **OpenRouter** API key: <https://openrouter.ai/keys>
- A **Google** and/or **GitHub** OAuth app (only if you want social sign-in)

### 1. Clone the repository

```bash
git clone https://github.com/mariam423/ai-chatbot.git
cd ai-chatbot
```

### 2. Install dependencies

```bash
npm install
```

The `postinstall` hook runs `prisma generate` automatically.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in the required values. See the **[Environment Variables](#-environment-variables)** section below for the full reference.

### 4. Apply the database schema to Neon

```bash
npx prisma db push
```

> Use `npx prisma migrate dev --name init` instead if you prefer a migration history over `db push`. The schema lives at `prisma/schema.prisma` and is dialect-agnostic for the application layer.

### 5. Run the development server

```bash
npm run dev
```

The app is now live at **<http://localhost:3000>**.

You can sign up with email + password to start chatting, or click the Google / GitHub buttons (after you wire up OAuth credentials in step 3).

### Useful scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server with HMR |
| `npm run build` | Production build (runs the same code path Vercel will use) |
| `npm run start` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint + Prettier check + typecheck |
| `npm run format` | Auto-format with Prettier |
| `npm run test` | Vitest unit + integration tests |
| `npm run test:e2e` | Playwright e2e (boots the prod build, exercises real CSP) |
| `npm run check` | Typecheck + tests in one shot |

---

## 🔐 Environment Variables

> **Never commit `.env.local`.** It's already covered by `.gitignore`.

The minimum set you need to boot the app locally:

```bash
# --- Database (Neon Postgres) ---
# Get this from: https://console.neon.tech → your project → Connection Details
# Use the *pooled* connection string for Vercel deployments.
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxxxx.us-east-2.aws.neon.tech/neondb?sslmode=require"

# --- LLM provider: OpenRouter (https://openrouter.ai/keys) ---
OPENROUTER_API_KEY="sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# --- Authentication (NextAuth v5) ---
# Generate with: openssl rand -base64 32
AUTH_SECRET="your-long-random-secret-here"
```

A complete `.env.example` is checked into the repo with every supported option. Highlights:

| Variable | Required? | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Postgres connection string (Neon pooled URL in prod) |
| `OPENROUTER_API_KEY` | ✅ | Primary LLM gateway key |
| `AUTH_SECRET` | ✅ | NextAuth session signing |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | ⬜ | Optional direct-provider fallbacks |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ⬜ | Google OAuth |
| `GITHUB_ID` / `GITHUB_SECRET` | ⬜ | GitHub OAuth |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_PRO` | ⬜ | Billing (Pro tier) |
| `RESEND_API_KEY` / `RESEND_EMAIL_FROM` | ⬜ | Transactional email |
| `ENCRYPTION_KEY` | ⬜ | AES-256-GCM key for encrypted user secrets (generate once, keep stable) |
| `REDIS_URL` | ⬜ | Shared rate-limit store across serverless instances |
| `NEXT_PUBLIC_APP_URL` | ⬜ | Public app URL (Stripe return URLs, OG tags) |

> **Tip:** When you copy `.env.example` to `.env.local`, only the required keys need real values to boot. Optional features (billing, OAuth, email) stay disabled silently until you add them.

---

## ☁️ Deploying to Vercel

This project is optimized for a one-click deploy on Vercel.

### 1. Import the repository

1. Go to <https://vercel.com/new>.
2. Select **`mariam423/ai-chatbot`** from the GitHub import list.
3. Vercel will auto-detect it as a Next.js project — no framework preset changes needed.

### 2. Add environment variables

In **Project Settings → Environment Variables**, add every key from your `.env.local` (at minimum `DATABASE_URL`, `OPENROUTER_API_KEY`, `AUTH_SECRET`).

> ⚠️ **Use Neon's _pooled_ connection string** (the one with `?pgbouncer=true&...`) for the `DATABASE_URL` environment variable. Serverless functions open many short-lived connections — the pooler keeps the count under Neon's limit.

### 3. Deploy

Click **Deploy**. The first build will:

- Run `npm install` (the `postinstall` hook runs `prisma generate`)
- Run `next build`
- Generate a preview URL

### 4. After the first deploy

- Set `NEXT_PUBLIC_APP_URL` to your production URL (used by Stripe, OG tags, and email links).
- Configure OAuth callback URLs in your Google/GitHub apps:
  - Google: `https://YOUR-DOMAIN.vercel.app/api/auth/callback/google`
  - GitHub: `https://YOUR-DOMAIN.vercel.app/api/auth/callback/github`
- Configure the Stripe webhook to point at `https://YOUR-DOMAIN.vercel.app/api/webhooks/stripe` and copy the signing secret to `STRIPE_WEBHOOK_SECRET`.

That's it — every push to `main` redeploys automatically.

---

## 🧪 Testing

```bash
npm run check         # typecheck + vitest
npm run test:e2e      # full Playwright suite against the prod build
```

The e2e suite boots `next start` and exercises the real production CSP, so it's the highest-confidence test surface. New features should ship with at least one vitest unit test for the data layer and one Playwright spec for the user-visible flow.

---

## 📁 Project Structure

```
ai-chatbot/
├── app/                    # Next.js App Router (pages, layouts, server actions, /api routes)
│   ├── api/                # Route handlers: chat, upload, transcribe, speak, auth, stripe…
│   ├── dashboard/          # Analytics & session insights
│   ├── embed/              # Embeddable widget routes
│   ├── login/              # Auth UI
│   └── settings/           # User preferences, custom agents, API keys
├── components/             # Client components (chat shell, sidebar, message bubble…)
├── lib/                    # Shared server logic (db, llm-config, rag, billing, skills…)
├── prisma/                 # schema.prisma (Postgres dialect)
├── public/                 # Static assets (drop demo.gif here!)
├── tests/                  # Vitest specs
├── e2e/                    # Playwright specs
└── scripts/                # Operational scripts
```

---

## 🤝 Contributing

Issues and pull requests are welcome. For substantial changes, please open an issue first to discuss the design.

1. Fork the repo and create a feature branch (`git checkout -b feat/my-feature`)
2. Run `npm run check` and `npm run test:e2e` locally
3. Open a PR with a clear description of the change and any new env vars

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.

---

<div align="center">

**Built with care by <a href="https://github.com/mariam423">@mariam423</a>.**
If this project helped you, a ⭐ is the best way to say thanks.

</div>
