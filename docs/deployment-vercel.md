# Deploying to Vercel

This project is optimized for a one-click deploy on Vercel. The build path is identical to `npm run build` — no framework preset changes are required.

## 1. Import the repository

1. Go to <https://vercel.com/new>.
2. Select **`mariam423/ai-chatbot`** from the GitHub import list.
3. Vercel auto-detects it as a Next.js project. No preset changes needed.
4. Click **Deploy** to trigger a first build (it will fail on missing env vars — that's expected, proceed to step 2).

## 2. Add environment variables

In **Project Settings → Environment Variables**, add the keys from your `.env.local`. The full reference is in [`environment-variables.md`](./environment-variables.md).

**Scope matters.** Vercel lets you set variables per environment (Production, Preview, Development). Make sure each variable is enabled for at least **Production** — Preview-only variables will be invisible to the production deployment.

| Variable | Scope | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Production, Preview | **Use the Neon's _pooled_ connection string** (the one with `?pgbouncer=true&...`). Serverless functions open many short-lived connections — the pooler keeps the count under Neon's limit. |
| `OPENROUTER_API_KEY` | Production, Preview | Primary LLM gateway. |
| `AUTH_SECRET` | Production, Preview | Generate with `npx auth secret` or `openssl rand -base64 32`. |
| `AUTH_TRUST_HOST` | Production | `true` — required for NextAuth to trust the Vercel proxy headers. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Production | Both required to enable the Google button. |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | Production | Both required to enable the GitHub button. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_PRO` | Production | Only if you're enabling the Pro tier. |
| `RESEND_API_KEY` / `RESEND_EMAIL_FROM` | Production | Only if you're sending transactional email. |
| `ENCRYPTION_KEY` | Production | **Generate once and keep stable** — rotating it invalidates existing ciphertext. |
| `REDIS_URL` | Production, Preview | Optional. Without it, rate limits are per-process. |
| `NEXT_PUBLIC_APP_URL` | Production | Set to your final production URL after the first deploy. |

## 3. Redeploy

After saving the environment variables, go to **Deployments** → click the three-dot menu on the latest deployment → **Redeploy**. The new build will pick up the new variables.

## 4. After the first successful deploy

### Set the public app URL

Set `NEXT_PUBLIC_APP_URL` to your production URL (used by Stripe return URLs, OG tags, and absolute links in emails). Redeploy once more to apply.

### Configure OAuth callback URLs

Add the following callback URLs to your OAuth apps:

| Provider | Callback URL |
| --- | --- |
| Google | `https://<your-domain>/api/auth/callback/google` |
| GitHub | `https://<your-domain>/api/auth/callback/github` |

For Preview deployments, also add the wildcard pattern or each preview URL (e.g. `https://ai-chatbot-git-feature-branch.vercel.app/api/auth/callback/google`).

### Verify which providers are active

Open **Vercel → Project → Logs**, filter for `[auth]`, and look for:

```
[auth] oauth providers active: { google: true, github: true } — set AUTH_GOOGLE_ID/SECRET and AUTH_GITHUB_ID/SECRET to enable.
```

If a provider shows `false` here, that button will be missing on the login page. Recheck the env var names — remember both the `AUTH_*` and the legacy `GOOGLE_CLIENT_*` / `GITHUB_*` names are accepted.

### Configure the Stripe webhook

If you're enabling billing:

1. In the Stripe dashboard, create a webhook endpoint at `https://<your-domain>/api/webhooks/stripe`.
2. Subscribe to the events your billing logic needs (typically `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`).
3. Copy the signing secret to `STRIPE_WEBHOOK_SECRET` in Vercel.

## 5. Verify the PWA install prompt

PWA install requires HTTPS, which Vercel provides automatically.

1. Open the production URL in Chrome or Edge.
2. Look for the **install icon** in the address bar (a small monitor with a down arrow).
3. On Android Chrome, the install prompt also appears in the browser's overflow menu.
4. On iOS Safari, use **Share → Add to Home Screen** (iOS does not surface the install icon, but the manifest and Apple-specific meta tags make the add-to-home-screen experience work).

If the install icon does not appear, open DevTools → **Application → Manifest** and check for errors. Common causes:

- **Manifest not detected** — check the `<link rel="manifest">` is in the HTML. It is injected by `app/layout.tsx` automatically.
- **Service worker not registered** — check DevTools → **Application → Service Workers**. It should show `/sw/service-worker.js` with status "activated and running".
- **Icons missing** — confirm `/icons/icon-192x192.png` and `/icons/icon-512x512.png` are reachable. They are served from `public/icons/`.

## 6. Continuous deployment

Every push to `main` triggers a new production deployment. Pull requests get their own preview deployments with their own preview URLs (useful for testing OAuth flows with callback URLs scoped to the preview domain).

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Build fails on `prisma generate` | `DATABASE_URL` is missing or unreachable. | Confirm the variable is set for the **Production** scope and the connection string works from your local machine with `npx prisma db push`. |
| OAuth buttons missing on the login page | The corresponding `AUTH_<PROVIDER>_*` (or legacy alias) variables are not set. | Check the Vercel function logs for the `[auth] oauth providers active: ...` line. |
| OAuth callback returns 404 | The callback URL in the OAuth app doesn't match your deployment URL. | Update the callback URL in Google / GitHub to match exactly, including the scheme and path. |
| "Application error: a server-side exception has occurred" on first load | A required env var is missing in the **Preview** scope but present in **Production**. | Check the function logs for the specific error and add the variable to the relevant scope. |
| PWA install icon doesn't appear | The service worker failed to register. | Check DevTools → Application → Service Workers for an error message. The most common cause is serving the site over HTTP instead of HTTPS (Vercel always serves HTTPS, so this should not happen in production). |
