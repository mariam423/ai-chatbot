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

| Variable                                                           | Scope               | Notes                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                     | Production, Preview | **Use the Neon's _pooled_ connection string** (the one with `?pgbouncer=true&...`). Serverless functions open many short-lived connections — the pooler keeps the count under Neon's limit. |
| `OPENROUTER_API_KEY`                                               | Production, Preview | Primary LLM gateway.                                                                                                                                                                        |
| `AUTH_SECRET`                                                      | Production, Preview | Generate with `npx auth secret` or `openssl rand -base64 32`.                                                                                                                               |
| `AUTH_TRUST_HOST`                                                  | Production          | `true` — required for NextAuth to trust the Vercel proxy headers.                                                                                                                           |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`                            | Production          | Both required to enable the Google button.                                                                                                                                                  |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`                            | Production          | Both required to enable the GitHub button.                                                                                                                                                  |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_PRO` | Production          | Only if you're enabling the Pro tier.                                                                                                                                                       |
| `RESEND_API_KEY` / `RESEND_EMAIL_FROM`                             | Production          | Only if you're sending transactional email.                                                                                                                                                 |
| `ENCRYPTION_KEY`                                                   | Production          | **Generate once and keep stable** — rotating it invalidates existing ciphertext.                                                                                                            |
| `REDIS_URL`                                                        | Production, Preview | Optional. Without it, rate limits are per-process.                                                                                                                                          |
| `NEXT_PUBLIC_APP_URL`                                              | Production          | Set to your final production URL after the first deploy.                                                                                                                                    |

## 3. Redeploy

After saving the environment variables, go to **Deployments** → click the three-dot menu on the latest deployment → **Redeploy**. The new build will pick up the new variables.

## 4. After the first successful deploy

### Set the public app URL

Set `NEXT_PUBLIC_APP_URL` to your production URL (used by Stripe return URLs, OG tags, and absolute links in emails). Redeploy once more to apply.

### Configure OAuth callback URLs

Add the following callback URLs to your OAuth apps:

| Provider | Callback URL                                     |
| -------- | ------------------------------------------------ |
| Google   | `https://<your-domain>/api/auth/callback/google` |
| GitHub   | `https://<your-domain>/api/auth/callback/github` |

For Preview deployments, also add the wildcard pattern or each preview URL (e.g. `https://ai-chatbot-git-feature-branch.vercel.app/api/auth/callback/google`).

#### Step-by-step: register `https://ai-chatbot-rose-ten.vercel.app`

The single most common cause of `400: redirect_uri_mismatch` (Google) and
_"The redirect_uri is not associated with this application"_ (GitHub) is
that the live Vercel URL was never added to the OAuth app's allow-list.
The error message prints the exact URL Google/GitHub saw — copy that
verbatim.

**Google Cloud Console** (https://console.cloud.google.com/apis/credentials):

1. Open the OAuth 2.0 Client ID used in production.
2. Under **Authorized redirect URIs**, click **Add URI** and paste **both**:
   - `https://ai-chatbot-rose-ten.vercel.app/api/auth/callback/google`
   - `https://ai-chatbot-rose-ten.vercel.app/api/auth/callback/google` (no trailing slash, exact match)
3. Also add the bare apex and `www` if you use a custom domain later.
4. Click **Save** — Google warns the change can take up to 5 minutes to
   propagate. Hard-refresh the login page (Ctrl+Shift+R) before retrying.
5. If the project is on a different Vercel alias (e.g.
   `ai-chatbot-<hash>-<user>.vercel.app` from a fresh deploy), repeat the
   step for **every** alias you use — the redirect URI is a literal string
   match, not a hostname pattern.

**GitHub** (https://github.com/settings/developers → your OAuth App):

1. Click the OAuth App used in production.
2. Set **Authorization callback URL** to
   `https://ai-chatbot-rose-ten.vercel.app/api/auth/callback/github`.
   GitHub's field is **single-valued** — for preview branches, add a
   separate OAuth App per preview environment, or use the per-deploy
   alias and update the field before each PR review.
3. Click **Update**.

#### The mock-credentials gotcha

If your Vercel env still contains the placeholder values from
`.env.example` (`GOOGLE_CLIENT_ID=mock-google-client-id`,
`GITHUB_ID=mock-github-client-id`), Vercel forwards those to Google/GitHub
on every login attempt and the providers reject them with the same
`redirect_uri_mismatch` / "not associated" error. The local
`DEV_OAUTH_MOCK=true` switch is **dev-only**; it is not what protects
production. To fix:

1. Vercel → Project → Settings → Environment Variables (Production scope):
   - `DEV_OAUTH_MOCK` → `false` (or delete it; `false` is the safe default)
   - `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` → real Google OAuth client
   - `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` → real GitHub OAuth client
2. Redeploy (env-var changes need a new deploy to take effect).
3. Verify with **Verify which providers are active** below — you should
   see `google: true, github: true`.

#### Quick diagnostic for `400: redirect_uri_mismatch`

The Google error page echoes the exact URI it received. Run the app, copy
the printed `redirect_uri=` value, and search for it in your Google Cloud
Console → Authorized redirect URIs list. If the value ends with `/` or
uses `http://` instead of `https://`, the mismatch is on the
scheme/trailing-slash, not the hostname.

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

| Symptom                                                                 | Likely cause                                                                                                                                                                                                   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build fails on `prisma generate`                                        | `DATABASE_URL` is missing or unreachable.                                                                                                                                                                      | Confirm the variable is set for the **Production** scope and the connection string works from your local machine with `npx prisma db push`.                                                                                                                                                                                                                                                                                                                                                                   |
| OAuth buttons missing on the login page                                 | The corresponding `AUTH_<PROVIDER>_*` (or legacy alias) variables are not set.                                                                                                                                 | Check the Vercel function logs for the `[auth] oauth providers active: ...` line.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| OAuth callback returns 404                                              | The callback URL in the OAuth app doesn't match your deployment URL.                                                                                                                                           | Update the callback URL in Google / GitHub to match exactly, including the scheme and path.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Google: `400: redirect_uri_mismatch`                                    | The Vercel URL isn't in **Authorized redirect URIs** in the Google Cloud Console OAuth client, **or** Vercel is still forwarding the placeholder `GOOGLE_CLIENT_ID=mock-google-client-id` from `.env.example`. | See **Step-by-step: register `https://ai-chatbot-rose-ten.vercel.app`** above — paste the exact URI Google prints in the error into the allow-list, and replace the mock client id/secret in Vercel env with the real ones. The error page echoes the exact `redirect_uri=` value Google received, so use that for comparison.                                                                                                                                                                                |
| GitHub: "The redirect_uri is not associated with this application"      | The Vercel URL isn't set as the **Authorization callback URL** on the GitHub OAuth App, **or** Vercel is forwarding the placeholder `GITHUB_ID=mock-github-client-id`.                                         | See **Step-by-step: register `https://ai-chatbot-rose-ten.vercel.app`** above. GitHub's field is single-valued — for preview branches, create a separate OAuth App per preview URL.                                                                                                                                                                                                                                                                                                                           |
| "Application error: a server-side exception has occurred" on first load | A required env var is missing in the **Preview** scope but present in **Production**.                                                                                                                          | Check the function logs for the specific error and add the variable to the relevant scope.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| PWA install icon doesn't appear                                         | The service worker failed to register.                                                                                                                                                                         | Check DevTools → Application → Service Workers for an error message. The most common cause is serving the site over HTTP instead of HTTPS (Vercel always serves HTTPS, so this should not happen in production).                                                                                                                                                                                                                                                                                              |
| "Could not create the account" on signup                                | One of: (a) `AUTH_DISABLED=true` is still set, (b) `DATABASE_URL` is the unpooled Neon connection, (c) `prisma db push` was never run on the production DB.                                                    | (a) Remove `AUTH_DISABLED` or set it to `false` in Vercel — the variable bypasses **all** auth, so signup is silently disabled. (b) Use the connection string with `?pgbouncer=true&connect_timeout=10` from Neon → Connection Details → Pooled. (c) Run `npx prisma db push` once locally with the production `DATABASE_URL` to apply all migrations. The user still sees a generic error in the UI for security; the actual Prisma reason is logged to Vercel → Logs under `[registerUser] failed for ...`. |
| "Invalid email or password" on signin (just after a successful signup)  | The signin ran against a different database than the signup — usually a swapped `DATABASE_URL` between environments, or a stale `dev.db` SQLite file accidentally committed.                                   | Compare the Vercel `DATABASE_URL` against the one in your local `.env.local`. They must point at the same Neon database. After fixing, redeploy.                                                                                                                                                                                                                                                                                                                                                              |
| Function logs show `Can't reach database server` or Neon timeouts       | Serverless cold starts + the unpooled direct connection exhaust the per-connection limit.                                                                                                                      | Switch `DATABASE_URL` to Neon's **pooled** string (it has `?pgbouncer=true`). Vercel functions open many short-lived connections — the pooler keeps the count under Neon's plan limit.                                                                                                                                                                                                                                                                                                                        |
