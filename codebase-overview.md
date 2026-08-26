# Codebase Overview

This document describes the current architecture of the Next.js chatbot,
including document RAG, optional MCP agent tools, model switching, and video
frame analysis.

## Overview

A Next.js 16 App Router chatbot streams replies from an OpenAI-compatible
provider, defaulting to OpenRouter. The app uses TypeScript strict mode, React
19, Tailwind CSS v4, Framer Motion, Zod, and Prisma 7 with the LibSQL adapter.
Conversation data, uploaded document metadata, extracted chunks, and serialized
vector embeddings are persisted in SQLite. The app is authenticated by default;
`AUTH_DISABLED=true` enables the anonymous test/local-development mode.

## Design system

- **Palette: "Cyber Emerald & Obsidian Gold"** — `app/globals.css` owns the full
  token set: green-tinged obsidian surfaces (dark) / warm paper (light) with an
  emerald primary accent (`--accent`), a reserved gold (`--gold`) used only for
  the brand mark and pinned/highlight states, emerald focus rings, and a dark
  emerald-tinted code syntax theme (`.code-block .hljs` overrides the imported
  github-dark-dimmed theme — code blocks stay dark in both app themes). Light
  and dark are the same tokens under `:root` / `.dark`; components consume them
  via `var(--...)` inline styles or Tailwind `emerald-*` classes (the old
  cyan-* classes were fully replaced).
- **Typography** — Inter for body/UI text and Space Grotesk for headings,
  self-hosted at build time via `next/font` in `app/layout.tsx`
  (`--font-inter` / `--font-space-grotesk`); headings across the app inherit
  the display face via a global `h1–h4` rule.
- **Motion** — Framer Motion micro-interactions: message-bubble entrances,
  the sliding sidebar active indicator (`layoutId="sidebar-active-indicator"`
  springs between sessions), hover/tap scaling, and the streaming pulse bar —
  all gated on `prefers-reduced-motion`.
- **Visual regression** — `e2e/visual.spec.ts` snapshots encode the palette;
  regenerate with `--update-snapshots` after any intentional visual change.

## Application components

- **`app/api/chat/route.ts`** — Validated chat endpoint. It accepts text
  messages, a session ID, a model key, optional structured-output mode, up
  to six validated video frames, and optional still-image/audio data URLs. It retrieves session-owned RAG context,
  composes grounding/vision/memory instructions, reserves prompt tokens before
  FIFO history compression, optionally runs MCP agent steps, and streams the
  final OpenAI-compatible response.
- **`app/api/skills/route.ts`** — Capability API for the client. `GET`
  returns the full skill catalog (id, name, domain, description, system
  instructions, tool names per skill; tool name/description/JSON-schema
  parameters per tool) plus the effective `activeSkillIds`. An optional
  `enabledSkills` comma-separated query param mirrors the per-session override
  sent with `/api/chat`; otherwise `SKILLS_ENABLED` env or the full catalog
  applies. The chat empty state fetches it to advertise clickable capability
  chips. Guarded by a per-IP rate limit (no CSRF — read-only GET).
- **`app/api/upload/route.ts`** — Node-runtime document API. `POST` accepts
  PDF/TXT/MD/CSV/XLSX/DOCX multipart uploads up to 20 MB, validates ownership
  and limits, extracts text, chunks and embeds it, and stores metadata. `GET`
  lists session documents; `DELETE` removes a document and its chunks.
- **`app/api/health/route.ts`** — Public, non-sensitive readiness endpoint for
  Nginx/ALB/uptime monitors. It runs a lightweight Prisma database check and
  returns `200` for healthy or `503` for degraded readiness.
- **`app/actions.ts`** — Server Actions for session/message persistence,
  sidebar listing, rename/pin/archive, per-user custom assistants, workspace
  task persistence, preferences, prompt presets, and long-term memory records.
  Inputs are Zod-validated and results use `{ ok }` discriminated unions.
- **`app/dashboard/page.tsx`** + **`lib/dashboard.ts`** — Authenticated usage
  and analytics dashboard with token/message quota, subscription status,
  custom-assistant management, and an ADMIN-only platform metrics tab.
- **`components/chat-app.tsx`** — Client shell for sessions, sidebar, command
  palette, theme, model selector, and the standard/custom-assistant selector.
  The selected stable model key is persisted as `chat.model`; on load it also
  reads user preferences to apply the preferred default model (only when no
  local choice exists) and carries generation tuning (temperature/max
  completion tokens) into `Chat`. The active custom assistant supplies scoped
  `--accent-*` variables for its persisted emerald/sapphire/violet/obsidian/
  amber visual theme. The header also exposes responsive Terminal, Files,
  Preview, and Publish workspace controls using `lucide-react`, plus a
  server-backed daily quota badge from `getBillingStatus`. Workspace tasks are
  loaded from the user-scoped `WorkspaceTask` table and the active task is
  restored from `UserPreference.activeWorkspaceTaskId`; anonymous mode keeps a
  local fallback. The desktop sidebar and mobile drawer share this persisted
  task state. Header tool buttons open the responsive `WorkspacePanel`: Terminal
  provides a constrained navigation/chat command console, Files reuses the
  session-scoped document uploader, Preview renders the latest assistant
  response, and Publish links to the authenticated custom-assistant dashboard.
- **`app/settings/page.tsx`** — Settings UI (Profile, Model & Generation,
  API Key, Google Calendar, System Prompt Presets). The Model & Generation
  section picks a preferred default model (from `lib/models.ts`) and has
  Temperature (0.0–1.0) + Max Completion Tokens (256–16384) sliders whose
  values are re-validated against client-side Zod schemas in real time before
  being persisted via `updateUserPreferences`; `chat.tsx` forwards them to
  `/api/chat`, which validates them again and applies them to the upstream
  body (`temperature` / `max_tokens`).
- **`components/workspace-panel.tsx`** — Responsive Terminal, Files, Preview,
  and Publish panel implementations used by the chat shell. It deliberately
  does not expose arbitrary server-side shell execution to browser clients.
- **`components/chat.tsx`** — Chat state/orchestration for restore, send,
  retry, regenerate, stop, clear, document attachments, video frame state,
  SSE consumption, and persistence. Normal deltas are coalesced into
  word-sized UI updates. Structured JSON is validated and rendered as Markdown
  after completion. The thread is stored as a branch-aware `ThreadState`
  (see `components/message-bubble.tsx`): editing a past user prompt forks a new
  branch from the shared prefix and regenerates the reply, and a version
  switcher bar lets the user toggle between branches without losing context.
  The chat toolbar also exposes the active assistant identity and export menu.
- **`components/file-upload.tsx`** — PDF/TXT/MD/CSV/XLSX/DOCX attachment
  picker with compact removable badges and processing errors.
- **`components/media-upload.tsx`** — MP4/WebM picker that previews sampled
  keyframes, plus JPEG/PNG/WEBP/GIF and MP3/WAV attachments for the current
  vision/audio request (20 MB caps; images over 5 MB are auto-compressed
  through a canvas — `lib/media-compress.ts`). Original media is not persisted.
- **`components/citation-drawer.tsx`** — Interactive RAG citation badge and
  drawer UI. It loads the exact matched chunk and source metadata through the
  citation API when a `[Document: ..., section N]` citation is selected.
- **`components/message-bubble.tsx`**, **`components/markdown.tsx`**, and
  **`components/streaming-skeleton.tsx`** — User/assistant presentation,
  highlighted Markdown/code rendering with copy buttons, citation badge
  handling, and loading state. User bubbles expose an **Edit prompt** action
  that swaps the bubble for an inline textarea; saving calls back into
  `chat.tsx` to fork a new branch (tree-branching).
- **`components/chat-export.tsx`** + **`lib/export-chat.ts`** — An **Export
  chat** menu in the chat toolbar that downloads the active branch as
  timestamped Markdown, JSON, or plain text (`lib/export-chat.ts` also holds
  the Node-testable pure `chatToMarkdown`/`chatToJson`/`chatToText`/
  `exportFileName` helpers) via generated Blobs, and renders a styled
  self-contained transcript into a hidden iframe for the browser's native
  **Print → Save-as-PDF** flow (no PDF dependency). Exports include assistant
  identity, message timestamps, and served-model provenance.
- **`lib/email.ts`** — Server-only transactional email boundary. Resend is
  preferred over SendGrid when configured; otherwise local development logs a
  short console preview and production skips delivery safely. Provider
  failures are swallowed and lifecycle helpers cover welcome, Pro activation,
  and cancellation notifications.
- **`components/audio-input.tsx`** — A mic button in the composer. Engine
  selection is `pickVoiceEngine`: the browser Web Speech `SpeechRecognition`
  API when available (Chrome/Edge, no network), otherwise a MediaRecorder
  fallback that records a clip and POSTs it to `/api/transcribe` for
  server-side transcription (Firefox/Safari). Renders nothing when neither is
  available. While active it shows a pulsing red indicator and an animated
  equalizer (recording or transcribing), a transient inline pill on failure,
  and the finalized transcript is appended to the composer via `onTranscript`.
- **`components/speech-button.tsx`** — Speaker control rendered beside each
  completed assistant response. It tries the server `/api/speak` adapter first
  (for OpenAI-compatible TTS), then uses browser `SpeechSynthesis`; stopping,
  cleanup, and reduced provider availability do not affect the chat thread.
- **`components/embed-chat.tsx`** + **`components/embed-generator.tsx`** —
  Lightweight iframe chat surface with the same STT/TTS controls and a
  dashboard custom-assistant panel that creates copyable signed iframe/script
  snippets. Tokens are generated only by the authenticated
  `createCustomAgentEmbedToken` server action and are scoped to one assistant
  owner.
- **`app/api/transcribe/route.ts`** — Server-side speech-to-text fallback. It
  accepts a multipart audio `file`, enforces a size cap, and forwards it to
  the configured provider's OpenAI-compatible `/audio/transcriptions` endpoint
  (API key stays server-side; `TRANSCRIBE_MODEL` overrides the default
  `whisper-1`), returning `{ transcript }` with timeout/error mapping. Same-origin
  check + per-IP rate limit.
- **`app/api/speak/route.ts`** — Bounded server-side OpenAI-compatible TTS
  adapter. It accepts up to 4,000 characters, forwards the request to
  `/audio/speech` when a compatible OpenAI-style provider is configured, and
  returns audio bytes with provider failures mapped to safe statuses. The
  client falls back to browser `SpeechSynthesis`; the route is rate-limited
  through the existing transcription guard without changing provider routing.
- **`app/api/embed/chat/route.ts`** — Public-but-token-authenticated custom
  assistant stream. It verifies a signed, expiring assistant-owner token,
  checks the optional parent origin, bounds message history, applies a per-
  assistant/IP rate limit, loads only the requested assistant, and reuses the
  existing provider model/fallback resolution for SSE. CORS `OPTIONS` and
  stream headers support cross-origin iframe clients.
- **`app/embed/[agentId]/page.tsx`** + **`app/embed-widget.js/route.ts`** —
  Minimal iframe page and public script loader for generated embeds. The page
  reveals only the owned assistant name after token verification; the script
  creates an iframe and never receives an LLM credential.
- **`app/api/analytics/route.ts`** — Thin client bridge for user-activity
  events: validates `{ event, properties }` with Zod and forwards to the
  configured provider (PostHog) server-side so the key never reaches the
  browser. No-op by default.
- **`app/api/webhooks/stripe/route.ts`** — Signature-verified Stripe webhook
  (`STRIPE_WEBHOOK_SECRET`; unverified → 401, unconfigured → 501). Handles
  `checkout.session.completed` (upgrade → pro/PRO, stores customer/subscription
  ids, and sends the activation notification) and
  `customer.subscription.updated`/`deleted` (synchronizes plan and role;
  deletion clears the subscription id and sends the cancellation notification).
  Subscription events can resolve the user from metadata/reference id or
  stored Stripe ids. Guarded by a generous per-IP flood brake (signature
  verification is the real auth; the CSRF check is defense in depth — Stripe's
  server-to-server calls carry no Origin).
- **`lib/security.ts`** — Shared guardrails: `checkCsrf`
  (Origin/Referer vs `NEXT_PUBLIC_APP_URL`; absent Origin allowed for
  non-browser traffic), `sanitizeInput` (control-char strip preserving
  `\t\n\r` — newlines are legitimate markdown/code-block content), `requireSession` (lazy `auth()`
  import keeps the module vitest-safe; `AUTH_DISABLED` bypasses), and
  `guardRoute` — a one-call composition (CSRF → optional session → rate
  limit) used by every API route. Each route's config lives in the exported
  `ROUTE_GUARDS` map (keyed by `RouteGuardKey`): bucket namespace, scope
  (signed-in user for chat, IP otherwise), session/CSRF flags, and the
  limit (literal or env-var name + `defaultLimit`). The return is a
  discriminated union: `{ ok: true, userId }` or `{ ok: false, response }`.
  The auth counterpart is the `AUTH_GUARDS` map (register 5/min,
  login 20/min per-IP + 10/min per-account, reset-request 5/min,
  reset-complete 10/min) applied by `checkAuthRateLimit` (server actions)
  and `checkLoginRateLimit` (the credentials provider), both keyed through
  the shared rate-limit store via `clientIpFromHeaders` — server actions
  have no `Request`, so the IP comes from `next/headers`.
  It re-exports `rateLimit`/`rateLimitResponse` from `lib/rate-limit.ts`.
- **`app/actions/auth.ts` + `lib/auth.ts` (credentials + OAuth)** — Auth throttles:
  `registerUser`, `requestPasswordReset`, and `resetPassword` call
  `checkAuthRateLimit` first (per-IP, before any DB/bcrypt work; reset-request
  is IP-only so an attacker can't burn a victim's reset quota). The
  credentials `authorize` calls `checkLoginRateLimit(clientIp(request), email)`
  before the bcrypt compare — a throttled attempt returns null (the same
  generic failure as a wrong password), and the per-account cap stops targeted
  guessing while the per-IP cap stops floods. Google/GitHub providers are
  enabled only when configured; the OAuth sign-in callback upserts the user and
  provider account into Prisma, links verified-email sign-ins to an existing
  user, and seeds the JWT with the stable user id, `FREE`/`PRO`/`ADMIN` role, and plan.
- **`lib/rate-limit.ts`** — The shared rate-limit store behind
  `guardRoute`. A fixed-window counter (slides forward on expiry) behind a
  narrow `RateLimitStore` interface: `MemoryRateLimitStore` (per-process
  Map, opportunistic cleanup) by default, `RedisRateLimitStore` when
  `REDIS_URL` is set. The Redis path uses ioredis with a single atomic Lua
  script (`INCR` + `PEXPIRE` + `PTTL`) so buckets are shared across
  instances and survive restarts without races; the client is fail-fast
  (`lazyConnect`, no reconnect strategy, error listener), and `rateLimit`
  degrades to a shared in-memory fallback while Redis is unreachable so a
  limiter outage never blocks requests.
- **`lib/billing/plans.ts`** — Plan tiers (free: `FREE_PLAN_DAILY_LIMIT`
  daily chat cap, default 20; pro: unlimited) + `parsePlanKey`/`getPlan`/
  `isOverDailyLimit` helpers shared by the route guard, webhook, and UI.
- **`lib/billing/usage.ts`** — `checkAndRecordUsage(userId)`: reads the user's
  plan + today's counter and either increments (allowing) or returns an
  over-limit error the route surfaces as 429. Enforced in `/api/chat` before
  any RAG/provider work when the user is signed in.
- **`lib/billing/stripe.ts`** — SDK-free Stripe REST client (plain fetch):
  `createCheckoutSession`, `createBillingPortalSession`, and
  `verifyStripeWebhookSignature` (HMAC + timing-safe compare + 5-minute skew
  window). Requests have a timeout and validate returned HTTPS redirect URLs;
  provider bodies are not echoed to clients. All helpers are env-gated; when
  `STRIPE_SECRET_KEY` is unset they return `{ ok: false, notConfigured: true }`.
  Authenticated checkout/portal actions are rate-limited through
  `BILLING_GUARDS` in `lib/security.ts`.
- **`lib/analytics.ts`** + **`lib/use-analytics.ts`** — Env-gated tracking:
  PostHog capture (`POSTHOG_API_KEY`/`POSTHOG_HOST`) or `ANALYTICS_DEBUG`
  console logging; otherwise a complete no-op (the app never phones home by
  default). The client hook posts to `/api/analytics` (fire-and-forget);
  canonical event names in `EVENTS`.
- **`lib/seo.ts`** — `JSON_LD` WebApplication structured data + `SITE`/
  `pageTitle` helpers; rendered in `app/layout.tsx` alongside OpenGraph/
  Twitter metadata (`APP_NAME`, `NEXT_PUBLIC_APP_URL`).
- **`components/structured-chart.tsx`** — Recharts chart extracted from
  `structured-response.tsx` and lazy-loaded via `React.lazy` + `Suspense`, so
  the heavy recharts bundle ships as its own chunk fetched only when a reply
  contains a chart. `chat.tsx` lazy-loads `AudioInput` (media-recorder
  logic) via `next/dynamic` with an icon fallback.
- **`next.config.ts`** — Long-lived immutable `Cache-Control` headers for
  static image/font assets (`public, max-age=31536000, immutable`) plus the
  security-header set (OWASP A05): `X-Frame-Options: DENY`, nosniff,
  `Referrer-Policy`, `Permissions-Policy`, and — on production builds only —
  a CSP (`default-src 'self'`, `script-src 'self' 'unsafe-inline'` for the
  inline theme/RSC-flight scripts, `frame-ancestors 'none'`, `object-src
'none'`, `frame-src 'self'` for the srcdoc export iframe) and HSTS
  (`max-age=31536000; includeSubDomains`). The e2e suite runs the production
  build, so the real CSP is exercised on every run.
- **`lib/audit.ts`** — Structured security audit logging (OWASP A09):
  `logSecurityEvent` emits one-line JSON events for denials (CSRF blocks,
  401s, rate-limit trips, auth throttles, ownership violations, webhook
  signature failures) and opt-in info events (successful logins via
  `SECURITY_AUDIT_LOG=true`). No-op under NODE_ENV=test. Never logs bodies,
  headers, or secrets — only ids, IPs, and status codes.
- **`lib/ssrf.ts`** — SSRF guard (OWASP A10): `assertSafeUrl` whitelists
  http(s), blocks private/loopback/link-local/reserved IPs (IPv4 + IPv6,
  incl. IPv4-mapped and dotted-quad forms), and rejects hostnames whose DNS
  resolves to any blocked address (rebinding defense). Applied to web search,
  MCP server URLs, `diagram_render`, and `weather_lookup`; deliberately not
  applied to the LLM base URL (self-hosted local models are legitimate).
- **`lib/embed.ts`** — Server-only HMAC-signed embed token contract. Payloads
  carry assistant id, owner id, optional normalized origin, and expiry; token
  verification is timing-safe, rejects tampering/expiry/id mismatches, and is
  used by both the embed page and stream route.
- **`lib/field-encryption.ts`** — Data-at-rest encryption for sensitive
  preference fields: AES-256-GCM with a `v1:<iv>:<tag>:<ct>` versioned
  envelope, keyed by the `ENCRYPTION_KEY` env var (sha256-derived to 32
  bytes). `encryptField` writes the envelope (plaintext passthrough with a
  one-time warning when the key is unset — local dev); `decryptField` passes
  legacy plaintext rows through unchanged, and an encrypted row that fails
  GCM verification (rotated key, tampering, key missing) degrades to `''`
  with a structured `decryption_failed` audit event instead of surfacing
  ciphertext or throwing. Applied to `UserPreference.apiKey` and
  `UserPreference.googleServiceAccountKey` (the Google service-account
  private key consumed by `schedule_block`): `app/actions.ts` encrypts on
  write and decrypts in `getUserPreferences`/`testGoogleCalendarConnection`;
  `lib/skills/credentials.ts` decrypts before parsing into the skill-tool
  context.
- **`components/diagram-card.tsx`** + **`lib/svg-data-url.ts`** — When a reply
  embeds an SVG data URL (the `diagram_render` tool's `imageUrl`), the Markdown
  `img` override routes it into a diagram card rendered via `<img>` (data URLs
  can't execute scripts, so no XSS) with **Copy SVG** (raw markup) and
  **Download** (`diagram.svg`) buttons. While the SVG loads, a spring-animated
  shimmer skeleton holds the card's height; the image fades in over it.
  `markdown.tsx` passes a custom `urlTransform` that permits SVG data URLs for
  image `src` only — react-markdown's default transform strips all `data:`
  URLs, which would otherwise drop rendered diagrams; links keep default
  sanitization.
- **`components/diagram-viewer.tsx`** — Full-screen glassmorphic viewer opened
  from the card's **View** button: wheel/button/double-click zoom
  (125%–800%), drag-to-pan clamped so diagram edges stay in the stage, and
  Escape/backdrop/X close with focus restore to the trigger. Backdrop closes
  only on a press-and-release that both starts and ends on the backdrop, and
  events inside a short mount window are ignored — the opening click's
  trailing touch→mouse events can't instantly close the viewer. `prefers-`
  `reduced-motion` skips entrance motion.
- **`components/sidebar.tsx`** — Accessible desktop session list and mobile
  drawer with a persisted Tasks organizer above the conversation list, search,
  pagination, rename, delete, pin, archive, and theme controls. Task rows use
  `aria-pressed` so their active state remains distinct from the conversation
  list's `aria-current` markers; collapsed mode keeps task and conversation
  controls available as icon-only actions.
- **`components/skill-picker.tsx`** — Per-session skill toggle dropdown in the
  chat header. It lists all eight registered skills with switches; toggling
  persists the override to `ChatSession.enabledSkills` (via
  `updateSessionSkills`), loads it back via `getSessionSkills` on session
  switch, and the override is sent with each `/api/chat` request as
  `enabledSkills`. "Use all" clears the override back to defaults.
- **Auth hardening (OWASP A07/A02)** — `registerUser` returns a generic
  error when the email is taken (no account-enumeration oracle); login and
  password-reset failures are already generic. Google/GitHub providers are
  enabled only when configured, and the login UI discovers them from
  `/api/auth/providers`. OAuth identities are persisted in `Account` rows and
  linked to existing users by verified email; new users default to `FREE`.
  The NextAuth cookie policy is
  left to `@auth/core`'s protocol-derived defaults (httpOnly, sameSite=lax,
  `secure` + `__Secure-`/`__Host-` prefixes over https) and documented in
  `lib/auth.ts`; HTTPS is enforced by the HSTS header in `next.config.ts`.
  Rate-limited logins return the same generic failure as a wrong password.
- **`app/actions.ts` (session skills)** — `getSessionSkills`/`updateSessionSkills`
  read and write the session's comma-separated `enabledSkills` override, and
  `saveChatMessages` accepts an optional `enabledSkills` list applied when the
  session is first created (so a new chat's toggles survive the first save).

## Libraries and boundaries

- **`lib/models.ts`** — Stable model-key registry for Provider default, Qwen
  3.6, DeepSeek V4 Flash, Kimi K3, and GPT-5.6, with server-side environment
  overrides.
- **`lib/agent.ts`** — Bounded autonomous agent loop. It makes non-streaming
  planning calls with built-in and configured MCP function tools, executes
  calls sequentially, retains assistant/tool messages as execution memory, and
  returns a continuation history for the final streamed call.
- **`lib/agent-tools.ts`** — Agent tool definitions and safe dispatch for web
  search, code/chart computation, image inspection, and mock audio
  transcription/synthesis. External execution is server-side, bounded, and
  returns structured results.
- **`lib/skills/registry.ts`** — Browser-safe enterprise skill & tool
  registry (safe to import from client components). It defines eight skill
  domains (Planning, System Design, Frontend UI/UX, Debugging, Testing,
  AI/MCP, Docs, General Utilities) with per-skill system instructions, the
  five Zod-typed tool schemas, and tool metadata whose JSON-schema parameters
  are derived via `z.toJSONSchema`. `SKILLS_ENABLED` filters active skills;
  the client catalog (`getSkillCatalog`) powers `/api/skills`.
- **`lib/skills/tools.ts`** — **Server-only** skill tool executors (imports
  `node:crypto`; never import from client code). `executeSkillTool` validates
  every call against its Zod schema and returns structured fallbacks instead
  of throwing. Providers, when configured: `diagram_render` POSTs the spec to
  a Kroki-compatible `DIAGRAM_RENDER_URL` (default `https://kroki.io`;
  `ascii` maps to Kroki's `svgbob`) and returns an SVG data URL;
  `schedule_block` signs a Google service-account JWT (RS256, no external
  lib), exchanges it for an access token, and creates the event via the
  Calendar v3 API. Executors accept a `SkillToolContext`; `resolveGoogleCredentials`
  prefers the per-user context over `GOOGLE_*` env vars. Unconfigured or
  failing providers degrade to clearly marked local fallbacks (text preview /
  locally computed block).
- **`lib/skills/credentials.ts`** — **Server-only** `getUserSkillContext(userId)`:
  loads a user's pasted Google service-account key + calendar id from
  `UserPreference` into a `SkillToolContext`. Returns an empty context when
  unauthenticated, unset, or the stored key won't parse, so executors fall
  back to env vars and then to the mock path. The route resolves it per
  request (`app/api/chat/route.ts`) and the agent loop threads it into skill
  tool calls (`lib/agent.ts`).
- **`lib/mcp-client.ts`** — Optional MCP Streamable HTTP client. It validates
  `MCP_SERVERS_JSON`, initializes servers, discovers tools, converts them to
  OpenAI function definitions, validates tool arguments, applies timeouts, and
  bounds tool responses.
- **`lib/structured-output.ts`** — Intent detection, strict JSON-schema metadata,
  Zod validation, safe Markdown conversion for table/code/citation envelopes,
  and validated chart data for the Recharts renderer.
- **`lib/documents.ts`** — Bounded UTF-8/PDF/ZIP-XML extraction for CSV, XLSX,
  and DOCX files plus overlapping text chunking for document RAG.
- **`lib/rag.ts`** — Deterministic normalized 128-dimensional local embeddings,
  Zod vector validation, cosine retrieval, and bounded citation-labeled context.
- **`lib/video.ts`** — Browser-only MP4/WebM keyframe sampling. It extracts at
  most six resized JPEG frames, enforces byte/data-URL limits, and never sends
  the original video binary.
- **`lib/memory.ts`** — Validated long-term memory storage and retrieval for
  user preferences, key entities, and conversation summaries. Memory is
  scoped to the authenticated user, capped per category, and formatted as
  bounded system-prompt context.
- **`lib/context.ts`** — Deterministic last-N and token-budget FIFO compression.
  The route subtracts system, document, visual, and memory prompt estimates
  first, so earlier chat history is discarded before current context.
- **`lib/sse.ts`** — Dependency-free SSE extraction, delta parsing, and
  abort-aware stream reading.
- **`lib/types.ts`** — Shared Zod-backed chat, uploaded-document, video-frame,
  session, memory, and prompt-preset types.
- **`lib/storage.ts`** — Versioned localStorage fallback for chat messages,
  extended for branching. The payload is version 2 and stores a `ThreadState`
  (`{ version: 3, branches, active }`, messages may carry the served `model`) — a list of linear branches plus the
  active index. `loadThread`/`saveThread` remain as active-branch
  conveniences; v1 and pre-versioning payloads auto-migrate to a single
  branch.
- **`lib/db.ts`** — Hot-reload-safe Prisma singleton using the LibSQL adapter.

## Database

- **`prisma/schema.prisma`** — `ChatSession` owns `ChatMessage[]` and
  `Document[]`. `DocumentChunk` stores bounded extracted text and a JSON vector
  embedding. `MemoryRecord` stores user-scoped preferences, entities, and
  summaries. `Account` links Google/GitHub identities to `User`; new users
  default to the `FREE` role; `ADMIN` is operator-managed. `CustomAgent` stores
  each user's prompt, baseline model, selected tools, and optional visual
  theme. `User` carries the SaaS billing state (`role`, `plan`,
  `stripeCustomerId`, `stripeSubscriptionId`, daily `usageCount`/`usageDate`).
  Document and user relations cascade appropriately.
- **`prisma/migrations/20260822100000_add_documents/migration.sql`** — Creates
  the document and chunk tables and retrieval indexes.
- **`prisma/migrations/20260822120000_add_memory/migration.sql`** — Creates
  user preferences and long-term memory tables and brings session metadata
  columns into the migration history.
- **`prisma/migrations/20260826000000_add_user_role/migration.sql`** — Adds
  the role column and OAuth account user index.
- **`prisma/migrations/20260826120000_migrate_user_roles/migration.sql`** —
  Migrates legacy `USER` rows to `FREE` and makes `FREE` the SQLite default;
  active Stripe plans use `PRO`, while canceled subscriptions return to `FREE`.
- Generated Prisma output is in `generated/` and ignored by Git. Run
  `npx prisma generate` after schema changes.

## Data flow

1. `ChatApp` restores `chat.sessionId`; `Chat` loads DB messages when available
   and falls back to the versioned localStorage thread. The header model
   selector stores a stable key in `chat.model` and sends it with each request.
2. A document selection posts multipart data to `/api/upload`. The server
   validates extension, MIME, size, ownership, extracts text, chunks it, stores
   embeddings, and returns metadata for the removable badge.
3. A video selection uses `lib/video.ts` in the browser to sample keyframes.
   The client sends only frame data URLs with the next `/api/chat` request as
   multimodal image content. Still images and bounded MP3/WAV data URLs use the
   same request-scoped path; the route validates them and adds visual/audio
   analysis instructions.
4. `/api/chat` retrieves nearest document chunks and relevant user memory,
   detects table/code/citation intent, and optionally adds an OpenAI-compatible
   strict `response_format.json_schema`. Document text and memory are marked
   as untrusted data; the model is instructed to cite `[Document: ..., section
N]` labels.
5. For tool-relevant requests, or whenever `MCP_SERVERS_JSON` configures
   servers, the route discovers function tools. Active skill instructions from
   `lib/skills/registry.ts` are injected into the system prompt and their
   Zod-bound tools are exposed to the model. A per-session `enabledSkills`
   override (from the request body) narrows the catalog, so the skill picker
   controls exactly which instructions and tools a session sees. `lib/agent.ts`
   makes bounded planning steps, executes built-in calls through
   `lib/agent-tools.ts`, skill calls through `lib/skills/registry.ts`, and MCP
   calls through `lib/mcp-client.ts`, retains tool results, and continues with
   the final streaming request. Ordinary chat keeps the single streaming call.
   On load (and whenever the override changes), the chat empty state fetches
   `/api/skills` and renders clickable capability chips for the effective
   active skills, each filling the input with a sample prompt.
6. After successful user interactions, `lib/memory.ts` extracts and upserts
   bounded memory records for future sessions. Memory extraction is
   deterministic and does not add a second LLM call.
7. History compression reserves the composed system/document/visual/memory
   prompt budget, drops the oldest earlier messages until the configured limit
   fits, and always retains the newest user message. Normal SSE deltas render
   in coalesced word-sized updates; structured envelopes are validated and
   converted to Markdown after the stream. Settled chat threads persist to
   localStorage and Prisma.

## Conventions and tradeoffs

- Zod validates request bodies, model keys, structured envelopes, video frames,
  stored embeddings, memory records, localStorage payloads, and upload metadata.
- All app credentials remain server-side. MCP configuration is optional and
  uses server-side headers from `MCP_SERVERS_JSON`; tool calls are bounded and
  validated against discovered JSON Schema, and unavailable servers are skipped
  during discovery.
- Web search and audio operations default to mock adapters when no provider is
  configured. The interfaces are replaceable without changing the agent loop.
  Skill tools follow the same pattern: `weather_lookup` calls an optional
  `WEATHER_API_URL`/`WEATHER_API_KEY` provider, `diagram_render` calls a
  Kroki-compatible `DIAGRAM_RENDER_URL`, and `schedule_block` writes to Google
  Calendar via a service account — each degrades to a clearly marked local
  fallback (placeholder, text preview, or locally computed block) when
  unconfigured or the provider errors.
- Calendar credentials are **per-user**: a service-account key JSON + calendar
  id pasted in Settings is stored on `UserPreference` and resolved per request
  into a `SkillToolContext` (`lib/skills/credentials.ts`), taking precedence
  over the server-wide `GOOGLE_*` env vars. The key is validated (JSON shape)
  on save and via `testGoogleCalendarConnection` (token exchange + calendar
  access check); unauthenticated requests fall through to env → mock.
- The registry stays browser-safe (client components import `SKILLS` from it);
  executor code that uses node builtins (`node:crypto`) or calls providers
  lives in `lib/skills/tools.ts`, which must never be imported from client
  code. The production build treats the two modules as separate graphs.
- Code execution is intentionally limited to a safe arithmetic/JavaScript-like
  expression subset; arbitrary Python or JavaScript evaluation is never run in
  the server process. Chart data is returned as structured points for a client
  Recharts renderer when a charting UI is present.
- Local hashed vectors avoid a second embedding provider and preserve a
  replaceable retrieval contract, at the cost of lower semantic quality than a
  dedicated embedding model.
- Video binaries and image/audio attachments are not persisted. Local browser
  processing reduces upload cost and privacy exposure; vision/audio support
  depends on the selected provider model. Audio uses the provider's
  `input_audio` content shape when supported.
- Strict structured output is requested only for detected or explicitly passed
  table, chart, code, and citation intents. Valid chart envelopes render with
  Recharts; invalid model JSON falls back to raw streamed content rather than
  losing the answer.
- The app deliberately hand-rolls OpenAI-compatible SSE instead of using an AI
  SDK. The MCP planning pass is non-streaming, while the final answer remains
  streamed to preserve the existing UI contract.
- SQLite/LibSQL is the current local database choice. Integration tests use
  temporary databases with `prisma db push`; development and deployment use
  checked-in migrations.

## Tests

- `npm run typecheck` runs strict TypeScript checking.
- `npm test` runs Vitest suites for agents/skills, API contracts, context
  compression, documents/RAG, models/structured output, MCP execution, memory,
  and video-frame validation. `tests/live-providers.test.ts` exercises the
  real Kroki + Google Calendar providers but is skipped unless
  `RUN_LIVE_PROVIDER_TESTS=true` (manual runs only).
- `npm run build` verifies the production Next.js bundle and route modules.
- `npm run test:e2e` runs the existing Playwright chat/sidebar/accessibility/
  visual flows against a production build with mocked chat streaming.
