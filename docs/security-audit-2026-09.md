# Hybrid Security Audit — Pulse AI

- **Audited by:** automated hybrid audit (SAST + DAST)
- **Date:** 2026-09-05
- **Local target:** `D:\ai-chatbot` (next commit `43efbec`)
- **Live target:** `https://ai-chatbot-rose-ten.vercel.app/`
- **Scope:** authentication/authorization, token handling, API routes, webhooks, secrets management, rate limiting, SSRF, data-at-rest, dependency hygiene

## Summary

| #   | Severity     | Finding                                                                                                 | CWE               | CVSS | Status                                                                          |
| --- | ------------ | ------------------------------------------------------------------------------------------------------- | ----------------- | ---- | ------------------------------------------------------------------------------- |
| 1   | **Critical** | Live production Postgres credential committed to git history                                            | CWE-798 / CWE-522 | 9.1  | **Open — rotate + purge**                                                       |
| 2   | **High**     | Stripe webhook blocked by session-gated proxy — billing broken in prod                                  | CWE-284           | 7.5  | **Fixed** (proxy allowlist + regression test)                                   |
| 3   | **Medium**   | Raw password-reset token written to server logs; reset emails never delivered                           | CWE-532           | 5.3  | **Fixed** (email actually sent; token logged only outside production)           |
| 4   | **Medium**   | Embed widget: bearer token public by design + `Access-Control-Allow-Origin: *` → LLM cost-abuse surface | CWE-770           | 5.3  | **Hardened** (fragment token, 24h TTL, origin binding, daily budget, ACAO echo) |
| 5   | **Low**      | Public `/api/health` discloses database reachability                                                    | CWE-200           | 3.7  | **Fixed** (secret-gated readiness)                                              |
| 6   | **Info**     | `Access-Control-Allow-Origin: *` on `/login` HTML page                                                  | CWE-942           | n/a  | **Vercel platform behavior** (see Finding 6)                                    |

---

## Finding 1 — CRITICAL: Live production Postgres credential in git history

- **CVSS 9.1** (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N) — CWE-798 (use of hard-coded credentials), CWE-522
- **Affected:** git repository history (all clones), Neon Postgres database

### Description

A real production `DATABASE_URL` containing the plaintext Neon Postgres password was committed to `main` history in `.env.local.save.1` (commit `329beae`, "fix: update local setup and configurations"). The file was later deleted (commit `ba8e5a4`, "security: remove local environment backup files"), but **deleting a file does not remove it from git history** — the credential remains recoverable by anyone with repository access, and is detectable by secret scanners (gitleaks / trufflehog / GitHub secret scanning).

Committed value (recoverable):

```
postgresql://neondb_owner:npg_****************@ep-solitary-forest-aejbndix-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

The Neon pooled endpoint is **live** — the host resolves and completes a TLS handshake (confirmed during audit). The leaked role `neondb_owner` is the schema-owner role for the `neondb` database: the full read/write surface for **all users, sessions, chat messages, embedded tokens, and encrypted preference fields** (Google service-account keys, user LLM keys).

### Steps to reproduce

```powershell
# 1. Recover the credential from git history (any clone, no server access needed)
git show 329beae:.env.local.save.1

# 2. Confirm the endpoint is live
curl.exe -k -o NUL -w "%{http_code} %{time_appconnect}s" https://ep-solitary-forest-aejbndix-pooler.c-2.us-east-2.aws.neon.tech/
```

An attacker who retrieves the string can authenticate to the database with a Postgres client over the internet. They gain: full read of all rows in `User`, `ChatMessage`, `ChatSession`, `UserPreference`, `CustomAgent`, `PasswordResetToken`, `PasswordResetToken.tokenHash` (offline brute-force of the reset token hash), `StripeCustomer`/subscription state — plus write access to exfiltrate, tamper with, or destroy data. The leaked database is the production data store backing the deployment audited here.

### Remediation (do all three)

1. **Rotate immediately.** Regenerate the Neon database password (and recreate the role/key). The leaked one is compromised regardless of history cleanup.
   1. Also consider rotating `OPENROUTER_API_KEY` / `AUTH_SECRET` / `ENCRYPTION_KEY` if they were ever present in a committed env file (verify with the scanner below — none were found in this audit's full-history scan).
2. **Purge history.** Rewrite the repo history to remove the blob: `git filter-repo --invert-paths --path .env.local.save --path .env.local.save.1`, then force-push and have every collaborator re-clone. (BFG Repo-Cleaner is an alternative.) Because GitHub can cache blobs in forks and this is a shared repo, treating the secret as burned and rotating is the authoritative fix; history rewrite reduces the scanning blast radius.
3. **Prevent recurrence.**
   - Enable **GitHub push protection / secret scanning** on the repo.
   - Add a pre-commit hook or CI gate running `gitleaks` (cheap, portable): `gitleaks detect --source . --report-format sarif`.
   - `.gitignore` already ignores `.env`, `.env.local`, `.env.local.save*`, `/env.` — verify renewal on any machine that created these backups.

---

## Finding 2 — HIGH: Stripe webhook blocked by session-gated proxy (billing broken in production)

- **CVSS 7.5** (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H) — CWE-284 (improper access control)
- **Affected:** `POST /api/webhooks/stripe` (live), `proxy.ts` allowlist, `ROUTE_GUARDS['stripe-webhook']`

### Description

`proxy.ts` gates every non-allowlisted route on a valid NextAuth session cookie. `/api/auth` is allowlisted, but **`/api/webhooks/stripe` is not**. Stripe's server-to-server webhook deliveries never carry a browser session cookie, so **every legitimate webhook is 307-redirected to `/login` before the route's signature verification ever runs**.

Confirmed live:

```powershell
curl.exe -s -i -X POST https://ai-chatbot-rose-ten.vercel.app/api/webhooks/stripe -d '{}'
# HTTP/1.1 307 Temporary Redirect  →  location: /login?callbackUrl=%2Fapi%2Fwebhooks%2Fstripe
```

Consequences in production:

- `checkout.session.completed` never fires → **Pro upgrades accepted on Stripe but never activated**.
- `customer.subscription.deleted` never fires → **cancelled users stay on Pro / role not downgraded**.
- The route's own defense-in-depth (`ROUTE_GUARDS['stripe-webhook']`: signature verification, per-IP flood brake, rate limit, `logSecurityEvent` on signature failure) is dead code.

The route and signature logic are sound (Zod payload validation, 5-min skew-tolerant `verifyStripeWebhookSignature`, 501 when unconfigured, `received: true` for acknowledged, audit trail for unresolved users) — they are simply unreachable behind the proxy gate.

### Steps to reproduce

```powershell
# Any POST/OPTIONS, with or without a signature, gets redirected before validation
curl.exe -s -i -X POST https://ai-chatbot-rose-ten.vercel.app/api/webhooks/stripe -H "Content-Type: application/json" --data '{}'
curl.exe -s -i -X OPTIONS https://ai-chatbot-rose-ten.vercel.app/api/webhooks/stripe -H "Access-Control-Request-Method: POST"
```

### Remediation

Add the exact webhook path to the proxy allowlist (it is not under `/api/auth`, `/api/embed`, or any other allowlisted prefix). The webhook's _real_ authentication — Stripe signature verification — stays where it is:

```ts
// proxy.ts — add to the allowlist block (after the /api/auth line):
if (
  pathname.startsWith('/api/auth') ||
  pathname === '/api/webhooks/stripe' ||   // <- signature-verified, never cookie-based
  pathname.startsWith('/api/embed') ||
  ...
```

No session check should apply to this path; the Stripe signature + the existing per-IP flood brake (`ROUTE_GUARDS['stripe-webhook']`) are the auth. Add a regression test in `tests/webhook-stripe.test.ts` asserting the route is reachable without a session cookie.

### Status — Fixed

- `proxy.ts` now allowlists `pathname === '/api/webhooks/stripe'` (with a comment explaining the webhook's real auth).
- New regression test `tests/proxy.test.ts` asserts the webhook path passes the proxy without a session cookie (plus the remaining gate/unauthenticated-307/session-cookie paths).

---

## Finding 3 — MEDIUM: Raw password-reset token written to server logs; reset emails never sent

- **CVSS 5.3** (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N, but chains to account takeover given log access) — CWE-532 (sensitive info in logs)
- **Affected:** `app/actions/auth.ts:128` (`requestPasswordReset`)

### Description

`requestPasswordReset` writes the **full, working reset link** to server logs on every request:

```ts
const rawToken = randomUUID() + '.' + randomUUID()          // line 119
const tokenHash = createHash('sha256').update(rawToken)...  // stored hashed (good)
...
console.info(
  `[password-reset] link for ${normalisedEmail}: /reset-password?token=${rawToken}`,
)                                                           // line 128–130 — raw token to logs
```

Two problems:

1. **Token leakage.** On Vercel, `console.info` lands in function logs (local log streams, hosting console, any log-ingestion pipeline). Anyone with read access to those logs can consume the token and reset the victim's password (account takeover). It is not gated on `NODE_ENV` — unlike the console email fallback in `lib/email.ts`, which correctly refuses to run in production.
2. **Functional break.** The comment claims "No email provider is configured yet," but `lib/email.ts` supports Resend and SendGrid. Because this path only logs the link, **legitimate users never receive a password-reset email in production** — password recovery is silently broken.

### Steps to reproduce

Trigger a reset, then inspect server logs (Vercel dashboard → Function Logs → the invocation):

```powershell
# server action — any registered email
# log output: [password-reset] link for <email>: /reset-password?token=<full raw token>
```

The raw token can then be used to reset the account:

```
GET /reset-password?token=<raw token>
```

### Remediation

Route the reset through the real email provider and never log resolving material:

```ts
// app/actions/auth.ts — replace the console.info block (lines 128–130):
if (process.env.NODE_ENV !== 'production') {
  console.info(`[password-reset] link for ${normalisedEmail} (dev only)`)
}
await sendTransactionalEmail({
  to: user.email,
  subject: 'Reset your Pulse AI password',
  html: `<a href="${resetBaseUrl}/reset-password?token=${encodeURIComponent(rawToken)}">Reset password</a>`,
  text: `Reset your password: ${resetBaseUrl}/reset-password?token=${rawToken}`,
})
```

(Where `resetBaseUrl` is computed from `process.env.APP_URL` / `VERCEL_URL`.) Add an audit event for `password_reset_requested` / `password_reset_completed`; keep the IP-level rate limit (`checkAuthRateLimit('reset-request', …)`) which is already correct.

### Status — Fixed

- `lib/email.ts` adds `sendPasswordResetEmail(to, resetUrl)` (escapeHtml-safe link, Resend/SendGrid/console chain).
- `app/actions/auth.ts`: `requestPasswordReset` now **sends the email via the provider** (best-effort `void … .catch(() => undefined)`), logs the raw link only when `NODE_ENV !== 'production'`, and derives the reset base URL from `NEXT_PUBLIC_APP_URL` → `AUTH_URL`/`NEXTAUTH_URL` → `VERCEL_URL` → `http://localhost:3000`.

---

## Finding 4 — MEDIUM: Embed widget bearer token is public by design; CORS `*`; LLM cost-abuse surface

- **CVSS 5.3** (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L + resource consumption) — CWE-770 (allocation of resources without limits)
- **Affected:** `app/embed/[agentId]/page.tsx`, `app/api/embed/chat/route.ts`, `components/embed-chat.tsx`, `app/embed-widget.js/route.ts`, `lib/embed.ts`

### Description

The embed feature requires a bearer token (HMAC-SHA256, TTL 30 days) that the publisher **pastes into their public page source**:

```html
<script data-agent-id="…" data-token="…" src="https://…/embed-widget.js"></script>
```

This is inherent to unframed widget embeds, but the current defaults amplify the risk:

1. The token's origin binding defaults to `'*'` (`data-origin="${origin || '*'}"`), so a token scraped from any publisher's page can be used **from any origin**.
2. `/api/embed/chat` answers with `Access-Control-Allow-Origin: *` (only for token-authenticated requests — see note below) and accepts the token via `Authorization: Bearer` **or `?token=` in the query string**. The query-string variant lands the token in hosting access logs, browser history, and any referrer chain that outlives the `strict-origin-when-cross-origin` policy.
3. The abuse of a leaked token is server-credit burnout: each request proxies the account owner's OpenRouter key (`getLlmConfig()` — the **server** key, not a per-user key) against any of the owner's custom agents. The only brake is `rateLimit('embed:<agentId>:ip', 30/min)` — per-IP, not per-agent-day and not per-token. A scraped token + cheap IP rotation = sustained cost drain.

A positively-enforced origin the server trusts (`X-Embed-Parent-Origin`) only exists for requests where the client _supplies_ it from `document.parentElement`/referrer — a cooperative channel, not a control.

### Steps to reproduce (non-destructive)

```powershell
# 1. Grab any publisher page that embeds a Pulse widget — the token is in the HTML:
#    <script data-agent-id="..." data-token="..." src=".../embed-widget.js"></script>

# 2. Replay it from anywhere (no origin binding when token was minted with origin '*'):
curl.exe -s -X POST "https://ai-chatbot-rose-ten.vercel.app/api/embed/chat?agentId=<id>&token=<token>" \
  -H "Content-Type: application/json" \
  --data '{"messages":[{"role":"user","content":"repeat this many times"}]}'
# → 200 text/event-stream, streaming replies billed to the token owner's OpenRouter key
```

### Remediation

- **Default to strict origin binding** in `lib/embed.ts` — make the publisher explicitly opt in to `'*'` (or better, disallow it) and verify the embedding page's origin server-side from the `Referer`/`Origin`/`X-Embed-Parent-Origin` of the _page_ load, not a client-supplied header.
- **Shorten default TTL** (30 days → 24 h) and allow expires-on-use via a jti/one-time variant.
- **Add per-agent daily cost/token budgets** (e.g. in `lib/billing/tier-rate-limit.ts` or a new daily counter) so a leaked token can't run the server balance dry; keep the per-IP brake as defense-in-depth.
- **Remove the `?token=` query-string channel** from `tokenFromRequest`; peer to client-reachable storage (`sessionStorage` set by a script-load handshake) is better than the URL. Keep `Referrer-Policy: no-referrer` on the `/embed/*` CSP block.
- Optional hardening: `Access-Control-Allow-Origin` should echo policy-approved origins, not `*`.

### Status — Fixed (hardened, Sep 2026)

- `lib/embed.ts`: token TTL **30 days → 24 h**; `verifyEmbedToken` now accepts a list of origin signals (`Origin` / `X-Embed-Parent-Origin` / `Referer` origin) and **rejects a bound token when no signal matches** (a scraped token can't be replayed from an unrelated site; origin-less requests fail closed).
- `app/api/embed/chat/route.ts`: `?token=` channel removed (Authorization only); per-agent **daily budget** (`embed:<agentId>:day`, default 500, overridable via `EMBED_DAILY_LIMIT`) added on top of the per-IP 30/min brake; CORS echoes the request `Origin` instead of `*`.
- New `app/api/embed/agent` (GET): client-side token verification + assistant-name lookup before the chat surface mounts.
- `app/embed/[agentId]/page.tsx` is now a thin shell; new `components/embed-shell.tsx` reads the token from the URL **fragment** (`#token=…`), scrubs it from history, and verifies before mounting.
- `app/embed-widget.js` + `components/embed-generator.tsx`: iframe/script URLs put the token in the fragment (never the query string → not in server access logs or Referer chains).
- `app/actions.ts`: `createCustomAgentEmbedToken` **requires an explicit origin** (no silent `*` default).
- `next.config.ts`: `/embed/*` now serves `Referrer-Policy: no-referrer`.
- Tests: `tests/embed.test.ts`, `tests/api-embed.test.ts` (query-only token → 401, bound-origin mismatch → 401), new `tests/api-embed-agent.test.ts`, new `createCustomAgentEmbedToken` coverage in `tests/actions.test.ts`.

---

## Finding 5 — LOW: Public `/api/health` discloses database reachability

- **CVSS 3.7** (AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N) — CWE-200 (information exposure)
- **Affected:** `app/api/health/route.ts` (live), `proxy.ts` allowlist

### Description

`GET /api/health` is public and returns `{"status":"ok","checks":{"database":"ok"}}`. This:

- Confirms to anyone that the app is on Postgres and that **the database is reachable from the internet** — meaningful context when combined with the leaked credential from Finding 1 (an attacker knows exactly which endpoint to validate against).
- Discloses deployment internals useful for fingerprinting.

### Steps to reproduce

```powershell
curl.exe -s https://ai-chatbot-rose-ten.vercel.app/api/health
# {"status":"ok","checks":{"database":"ok"},"timestamp":"..."}
```

### Remediation

Return a terse liveness body without internals to unauthenticated callers (`{"status":"ok"}`), and keep the detailed DB-check shape behind the session-guarded surface (e.g. `/api/health/queue` already is), or drop the details entirely and rely on an outside uptime monitor for DB reachability.

### Status — Fixed

- Anonymous callers get `{"status":"ok"}` and **no database connection is attempted** — no scanner learns anything from the endpoint.
- The detailed `checks.database` readiness shape is served **only** to requests carrying the `HEALTH_CHECK_TOKEN` env secret as a Bearer token (constant-time compare). Unset token → detail never served.
- `tests/api-health.test.ts` covers anonymous/no-token/wrong-token/authorized-ok/authorized-degraded paths.

---

## Finding 6 — INFO: `Access-Control-Allow-Origin: *` on the `/login` HTML page

- **Affected:** `GET /login` (live)

The `/login` HTML response carries `Access-Control-Allow-Origin: *`. HTML responses are opaque to cross-origin JS (`text/html` without `text/plain` is not readable cross-origin), so this is cosmetic low-risk, but the header set on an authentication page is a bad signal (can confuse scanners, and if the page ever serves a `Content-Type` a browser can sniff, it becomes a cross-origin read primitive). Recommend removing it from non-API responses.

```powershell
curl.exe -s -I https://ai-chatbot-rose-ten.vercel.app/login | findstr "Access-Control"
```

### Status — No code change (platform behavior)

Re-investigation shows the header is added by the **Vercel platform layer on `*.vercel.app` deployment URLs, not by application code**: no file in the current tree or anywhere in git history sets `Access-Control-Allow-Origin` outside the embed routes (`app/api/embed/chat`, `app/api/embed/agent`, `app/embed-widget.js`), yet every SSR HTML response that returns `200` (`/login`, `/forgot-password`, `/reset-password`) carries it while `307` redirects and `/api/*` JSON responses do not. This is a documented Vercel quirk on `vercel.app` domains. It disappears once the app is served from a **custom domain**. Nothing to change in code.

---

## Verified strengths (no action needed)

- **Headers:** production CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS `max-age=31536000; includeSubDomains`, `X-Frame-Options: DENY`, `Permissions-Policy` (camera/mic/geolocation = `()`), `X-Content-Type-Options: nosniff`. Clickjacking protection is deliberately relaxed only on the `/embed/*` subtree (`frame-ancestors *`), which is required for the widget to work.
- **Auth:** NextAuth v5 on the server, `bcryptjs` password hashing; **generic success messages** on login/register/reset prevent account enumeration; `checkLoginRateLimit` (per-IP _and_ per-account) runs before bcrypt work; reset tokens are stored as SHA-256 hashes and are single-use with expiry + one-active-per-user invalidation.
- **API routes:** CSRF origin/referer guard plus rate limiting (IP- or session-scoped) via `guardRoute`; ownership scoping everywhere (`where: { id, userId }`, `findOwnedSession`); transcribe/upload enforce content-type allowlists and size caps; `ROUTE_GUARDS` is a single reviewable map.
- **SSRF:** `assertSafeUrl` blocks private/loopback/link-local/reserved IPv4+IPv6, unresolvable hosts, and any-resolved-address-private (DNS-rebinding defense); deliberately **not** applied to the LLM base URL so self-hosted local models keep working.
- **Data at rest:** AES-256-GCM field encryption for `UserPreference.apiKey` and `googleServiceAccountKey` (`v1:<iv>:<tag>:<ct>` envelope, sha256-derived key); undecryptable rows degrade to `''` with an audit event, never a throw or ciphertext in the response.
- **Auditing:** structured OWASP-A09 JSON security events (`lib/audit.ts`) wired into guard blocks, auth throttles, Stripe signature failures, and ownership violations; info events opt-in.
- **Secrets hygiene (current tree):** only `.env.example` placeholders are committed; a full-history scan for OpenRouter/Gemini/Stripe/GitHub/`npg_`-style keys found **no other real secrets** beyond the Finding 1 `DATABASE_URL`.

## Methodology notes

- DAST: header capture, endpoint enumeration (including probing for `.env` fetch attempts — all correctly engage the auth/login surface, not serve files), webhook/agent/API probing, HTTP-method and OPTIONS checks.
- SAST: full read of auth, session, proxy, embed, billing, health, upload/transcribe/citation, encryption, rate-limit, and RAG modules; secret scan across every commit reachable from `git rev-list --all`.
- No destructive actions taken against the live target; both half-open credentials (webhook redirect, health response) were confirmed with benign requests only.
