# Environment Variables

> **Never commit `.env.local`.** It's already covered by `.gitignore`. A complete `.env.example` is checked in with placeholder values for every supported option.

## Minimum to boot the app

```bash
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxxxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
OPENROUTER_API_KEY="sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
AUTH_SECRET="your-long-random-secret-here"
```

Everything else is optional — features that depend on a missing variable stay disabled silently rather than crashing the app.

## Quick reference

| Variable              | Required?   | Purpose                                                                                                                                                                    | How to obtain                                                   |
| --------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`        | ✅          | Postgres connection string. **Use the Neon's _pooled_ URL in production** (the one with `?pgbouncer=true&...`).                                                            | <https://console.neon.tech> → your project → Connection Details |
| `OPENROUTER_API_KEY`  | ✅          | Primary LLM gateway key.                                                                                                                                                   | <https://openrouter.ai/keys>                                    |
| `AUTH_SECRET`         | ✅          | NextAuth session signing.                                                                                                                                                  | `npx auth secret` or `openssl rand -base64 32`                  |
| `AUTH_TRUST_HOST`     | recommended | `true` when behind a proxy / Vercel. (The app now hardcodes `trustHost: true` in `lib/auth.ts`, so this is only needed if you also want to disable that behavior locally.) | —                                                               |
| `NEXT_PUBLIC_APP_URL` | recommended | Public app URL (Stripe return URLs, OG tags, email links).                                                                                                                 | Your deployment URL                                             |
| `ENCRYPTION_KEY`      | recommended | AES-256-GCM key for encrypted `UserPreference` rows. **Generate once, keep stable** — rotating it invalidates existing ciphertext.                                         | `openssl rand -base64 32`                                       |

## Database pooling (optional tuning)

`lib/db.ts` sizes its Postgres pool from these envs (`lib/db-config.ts`). With no overrides on a long-lived process (EC2/PM2/`next start`) the pool matches node-postgres defaults — zero change. On Vercel the per-instance max defaults to **1** (serverless instances are short-lived; Neon's pooler — the `?pgbouncer=true` URL — is what bounds total connections). Explicit values always win.

| Variable                              | Purpose                                                            | Default                        |
| ------------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| `DATABASE_POOL_MAX`                   | Max connections this process opens.                                | `10` (Node/PM2) · `1` (Vercel) |
| `DATABASE_POOL_MIN`                   | Warm connections kept open (clamped to `MAX`).                     | `0`                            |
| `DATABASE_POOL_IDLE_TIMEOUT_MS`       | Idle lifetime before the pool closes a connection.                 | `10000`                        |
| `DATABASE_POOL_CONNECTION_TIMEOUT_MS` | Max wait for a new connection before failing (`0` = wait forever). | `0`                            |

Invalid values (non-numeric, negative) fall back to the default instead of crashing. SSL is driven by the URL (`?sslmode=require` — Neon's default; `sslmode=verify-full` for stricter setups); no pool env affects it.

> **Startup warning:** if `VERCEL` is set and `DATABASE_URL` points at a Neon _direct_ URL (no `?pgbouncer=true`), the app logs a one-time `[db]` warning — switch to the pooled URL so concurrent function instances stay under Neon's direct-connection limit.

## Background worker (optional tuning)

The BullMQ worker (`npm run worker`, PM2 `pulse-ai-worker`) reads these envs at boot. Defaults match the pre-hardcoded values; garbage values (non-numeric, zero, negative) fall back to the defaults.

| Variable             | Purpose                                                     | Default |
| -------------------- | ----------------------------------------------------------- | ------- |
| `WORKER_CONCURRENCY` | How many jobs this worker processes in parallel.            | `5`     |
| `WORKER_LIMITER_MAX` | Max jobs per second across all workers (limiter `max`/1 s). | `30`    |

## OAuth / Auth.js

Both Auth.js-style names (`AUTH_*`) and the project's original names are accepted. The lookup order is `AUTH_<PROVIDER>_*` first, then the legacy alias.

| Variable             | Alias                  | Required?                   | Where to obtain                                                                                                                                                                                       |
| -------------------- | ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_GOOGLE_ID`     | `GOOGLE_CLIENT_ID`     | ⬜ for the button to appear | <https://console.cloud.google.com> → APIs & Services → Credentials → OAuth 2.0 Client IDs                                                                                                             |
| `AUTH_GOOGLE_SECRET` | `GOOGLE_CLIENT_SECRET` | ⬜                          | Same screen as above                                                                                                                                                                                  |
| `AUTH_GITHUB_ID`     | `GITHUB_ID`            | ⬜ for the button to appear | <https://github.com/settings/developers> → New OAuth App                                                                                                                                              |
| `AUTH_GITHUB_SECRET` | `GITHUB_SECRET`        | ⬜                          | Same screen as above                                                                                                                                                                                  |
| `AUTH_DISABLED`      | —                      | ⬜                          | Set to `true` to bypass all auth entirely (e2e tests, local dev before OAuth is configured).                                                                                                          |
| `DEV_OAUTH_MOCK`     | —                      | ⬜ (dev only)               | When `NODE_ENV !== 'production'` and this is not `'false'`, placeholder OAuth credentials are used so the Google / GitHub buttons appear locally without real OAuth apps. Never active in production. |

> **Production diagnostic:** on cold start in production, the auth module logs `[auth] oauth providers active: { google: true|false, github: true|false }` so you can see at a glance which providers registered.

## Optional providers (LLM fallbacks)

| Variable           | Purpose                                                       |
| ------------------ | ------------------------------------------------------------- |
| `OPENAI_API_KEY`   | Direct OpenAI fallback (also used for Whisper transcription). |
| `GEMINI_API_KEY`   | Direct Google Gemini fallback (OpenAI-compatible endpoint).   |
| `GROQ_API_KEY`     | Groq fallback.                                                |
| `TOGETHER_API_KEY` | Together AI fallback.                                         |
| `OLLAMA_BASE_URL`  | Local Ollama instance (e.g. `http://localhost:11434`).        |

## Document RAG (pgvector)

| Variable                    | Purpose                                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RAG_VECTOR_MODE`           | Default `hash` (zero-dependency in-memory cosine scoring). Set to `pgvector` to use DB-side cosine search — requires the opt-in `prisma/vector-column.sql` migration. Falling back automatically when the column is missing or the query errors. |
| `RAG_VECTOR_MIN_SIMILARITY` | Minimum cosine similarity (0–1) for a chunk to be returned by the pgvector path (default `0.75`). Ignored in `hash` mode.                                                                                                                        |

To enable DB-side vector search: apply `prisma/vector-column.sql` once (`psql "$DATABASE_URL" -f prisma/vector-column.sql`), then set `RAG_VECTOR_MODE=pgvector`.

## Billing

| Variable                   | Purpose                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`        | Stripe API key (use a restricted key with read+write on customers/subscriptions). |
| `STRIPE_WEBHOOK_SECRET`    | Signing secret from the Stripe dashboard for the webhook endpoint.                |
| `STRIPE_PRICE_PRO`         | Price ID of the Pro tier.                                                         |
| `STRIPE_PORTAL_RETURN_URL` | Where to send users after they leave the billing portal.                          |

## Email

| Variable            | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `RESEND_API_KEY`    | Resend API key (recommended provider).                              |
| `RESEND_EMAIL_FROM` | Verified sender address (e.g. `Pulse AI <noreply@yourdomain.com>`). |
| `SENDGRID_API_KEY`  | Alternative provider if you don't use Resend.                       |

## Storage, rate-limiting, analytics

| Variable                       | Purpose                                                                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL`                    | Central Redis for the distributed cache (`lib/cache.ts`), the tier rate limiter, and the BullMQ task queue. Without it each consumer degrades gracefully: in-memory rate limits, no-op cache, synchronous job fallback. |
| `FREE_PLAN_DAILY_LIMIT`        | Free-tier daily LLM request cap (default `20`). Pro is unlimited.                                                                                                                                                       |
| `FREE_PLAN_BURST_PER_MINUTE`   | Free-tier per-minute burst cap (default `20`, mirroring the daily cap). Pro is `120`/min.                                                                                                                               |
| `POSTHOG_KEY` / `POSTHOG_HOST` | Self-hosted PostHog for analytics (optional).                                                                                                                                                                           |

## App configuration

| Variable              | Purpose                                                                                                                         | Default                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `APP_NAME`            | Display name used in the manifest, layout, and emails.                                                                          | `Pulse AI`              |
| `AUTH_DISABLED`       | When `true`, the proxy allows every request through (no auth). Useful for e2e and for running locally before OAuth is wired up. | unset                   |
| `NEXT_PUBLIC_APP_URL` | Public app URL — required for Stripe return URLs, OG tags, and absolute links in emails.                                        | `http://localhost:3000` |

## Verifying your configuration

After filling in `.env.local`:

```bash
npm run dev      # boots and prints any missing required vars in the terminal
```

In production, check the **Vercel function logs** for the `[auth] oauth providers active: ...` line and any other boot-time diagnostics.
