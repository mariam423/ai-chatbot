# Codebase Overview

Produced by following the `codebase-overview` agent workflow (architecture-designer
skill in documentation mode) — this describes the architecture **as it exists**
at the time of writing.

## Overview

A Next.js 16 (App Router) chatbot app that streams replies from an LLM API,
wired by default to **OpenRouter** (OpenAI-compatible) — the provider is now
named explicitly in `PRD.md` (Overview + open questions), matching the code
and env docs. The app layer is small and cleanly separated: a server-side
streaming proxy, a client chat component, a dependency-free SSE parser, a
shared types module, and — since FR-11 — a SQLite-backed per-session
conversation store (Prisma + Server Actions) with localStorage as the offline
fallback. The repo also contains a Codebuff agent scaffold
(`.agents/`) — tooling, not app code, with no runtime coupling to the app.
TypeScript strict mode and a single shared `tsconfig.json` cover both halves.
PRD coverage is tracked by tests (`tests/prd-checklist.test.ts`) and most
FRs/NFRs have e2e or integration coverage.

## Components

### App layer

- **`app/api/chat/route.ts`** — Server-side streaming proxy.
  - Responsibility: validate the request, call the configured LLM API with
    `stream: true`, pipe the SSE body back. Must never expose the API key.
  - Contract: `POST /api/chat`, body `{ messages: [{role, content}] }`
    validated with Zod (`ChatRequestSchema`: non-empty
    `ChatWireMessage[]`, roles user/assistant/system); returns
    `text/event-stream` or JSON errors (400 with structured `issues`,
    429/5xx/502).
  - Depends on: `OPENROUTER_API_KEY` (preferred) or `OPENAI_API_KEY`; when only
    the OpenRouter key is set, defaults to `https://openrouter.ai/api/v1` and
    `stealth/ox-alpha`; `OPENROUTER_BASE_URL`/`MODEL_NAME` override OpenRouter
    defaults, `OPENAI_BASE_URL`/`OPENAI_MODEL` override OpenAI defaults;
    `OPENROUTER_APP_NAME` → `X-Title` header.
  - Boundary: no client code touches this module's env access.

- **`components/chat-app.tsx`** — App shell (client).
  - Responsibility: sidebar + thread layout, anonymous `chat.sessionId`
    management (New Chat clears the id AND the cached thread so the restore
    effect lands on the empty state), dark/light theme toggle (persisted in
    `chat.theme`), and the session list for the sidebar (`listChatSessions`,
    refreshed via `onConversationChanged` after DB writes).
  - Contract: `'use client'`; renders `Sidebar` + `Chat`.

- **`components/sidebar.tsx`** — Sidebar: desktop aside + mobile drawer.
  - Responsibility: list DB sessions with the active one highlighted
    (`aria-current`), "New Chat" action, dark mode toggle, and per-session
    rename/delete (a ⋯ row menu opens inline Rename — input, Enter saves —
    and a two-step Delete confirm; one action state at a time, Escape
    dismisses). Desktop renders an aside at `md+`; on mobile the same content
    (extracted as `SidebarContent`) renders in a slide-in overlay drawer
    opened from the header menu button — backdrop click / Escape / X to
    close, a Tab focus trap, focus moved in on open and restored to the
    trigger on close, and the container is `inert` + `aria-hidden` while
    closed (no stray focus/pointer events).
  - Contract: props add `onRenameSession(id, title)` / `onDeleteSession(id)`
    (wired in chat-app.tsx to `renameChatSession` / `clearChatSession` +
    session-list refresh; deleting the active session resets the thread).

- **`components/chat.tsx`** — Chat client (state + orchestration).
  - Responsibility: message state, send/stop/retry/regenerate/clear, streaming
    consumption, streaming skeleton while the first token is pending, error
    surface, auto-scroll, reduced-motion, and persistence (FR-9 localStorage:
    restore after mount, deterministic persist at stream settle, `restored`
    guard against StrictMode clobbering; FR-11 database via `saveChatMessages`
    — persisted on success, failure, and abort alike, then
    `onConversationChanged` refreshes the sidebar). Input gating delegates to
    `lib/validation.ts` (`isValidMessageInput`, `MAX_INPUT_LENGTH = 4000`).
    Regenerate re-runs the last user message in place — `send()` reuses a base
    that already ends with that exact user content instead of appending a
    duplicate bubble. `MessageBubble` entrance animations via Framer Motion
    (disabled under reduced motion).
  - Contract: `'use client'`; `{ sessionId, onSessionChange, onConversationChanged }`.
  - Depends on: `lib/sse.ts` (`readSSEStream`), `lib/types.ts`,
    `lib/validation.ts`, `lib/storage.ts`, `app/actions.ts`,
    `components/message-bubble.tsx`, `components/streaming-skeleton.tsx`,
    `framer-motion`, `lucide-react`, `@/` path alias.

- **`components/message-bubble.tsx`** — Presentational bubble.
  - Responsibility: render one message — assistant messages go through
    `components/markdown.tsx`; user messages render as plain text
    (React-escaped, NFR-3), `break-words` + `pre-wrap` wrapping (FR-10),
    `aria-live` on assistant bubbles, user/assistant styling, and a
    "Regenerate response" action on the last completed assistant message.
  - Contract: `{ message: ChatMessage }` from the shared `lib/types.ts`.

- **`components/markdown.tsx`** — Markdown renderer (FR-13).
  - Responsibility: `react-markdown` + `remark-gfm` + `rehype-highlight`
    (hljs CSS in `globals.css`). Fenced code blocks get a header with a
    language badge and a one-click copy button (clipboard write, "Code
    copied" confirmation). No `rehype-raw` — raw HTML in replies renders
    literally (NFR-3 holds).

- **`components/streaming-skeleton.tsx`** — Pre-first-token loading state.
  - Responsibility: animated skeleton lines while the assistant placeholder is
    empty (replaces the old typing indicator); `aria-label="Assistant is
typing"`, no-op animation under reduced motion.

- **`lib/sse.ts`** — SSE parsing utilities (framework-free).
  - Responsibility: split SSE events, extract chat-completion delta text, read
    a stream with abort support (self-observing signal).
  - Contract: `extractSSEEvents`, `deltaText`, `readSSEStream`, `SSE_DONE`.

- **`lib/context.ts`** — History truncation + token-budget compression.
  - Responsibility: keep the last N messages (default 20) then drop the
    oldest until estimated tokens fit (default 8000) before the upstream LLM
    call — deterministic FIFO per the session-compression skill; no extra
    LLM calls. Newest message is never dropped.
  - Contract: `truncateHistory(messages, { maxMessages?, maxTokens? })`,
    `estimateTokens(text)`, `DEFAULT_MAX_HISTORY_MESSAGES`,
    `DEFAULT_MAX_CONTEXT_TOKENS` (env overrides `MAX_HISTORY_MESSAGES` /
    `MAX_CONTEXT_TOKENS` read in the route).

- **`lib/storage.ts`** — Versioned localStorage thread persistence (FR-9).
  - Responsibility: load/save/clear the thread; stored payload is
    `{ version: 1, messages }` (per the vercel `client-localstorage-schema`
    rule), validated with Zod `safeParse` at the storage boundary. Legacy
    unversioned data (bare array) is migrated to v1 via `normalizeThread` and
    written back on first load; corrupt or partial payloads yield an empty
    thread, never trusted data.
  - Contract: `loadThread()` → `ChatMessage[]`, `saveThread(messages)`,
    `clearThread()`, `THREAD_STORAGE_KEY`, `THREAD_STORAGE_VERSION`.
  - Depends on: `lib/types.ts` (`ChatMessageSchema`).

- **`lib/types.ts`** — Shared chat + SSE types.
  - `ChatMessageSchema` (Zod) is the source of truth for `ChatMessage`
    (client thread state); `ChatWireMessageSchema` (Zod) for the wire format
    (validated in the route); `ChatSessionSummary` for the sidebar session
    list; `ChatCompletionChunk` (SSE delta payload), `SSEExtract` (SSE parser
    result), `StreamCallbacks` (stream consumer options).
  - Consumed by chat-app.tsx, chat.tsx, message-bubble.tsx, the route, and
    lib/sse.ts; presentational code no longer imports types from the
    orchestrator.

- **`lib/validation.ts`** — Pure input-validation helpers (`isValidMessageInput`,
  `MAX_INPUT_LENGTH`), unit-tested at the boundary.

- **`app/actions.ts`** — Server Actions for FR-11 conversation persistence.
  - Responsibility: create/get/save/clear/rename a session's thread in the
    database, and list sessions for the sidebar; never throw to the client
    (all return discriminated `{ ok }` results).
  - Contract: `createChatSession()`, `getChatSession(id)` → `ChatMessage[]`
    (ordered by `position`), `saveChatMessages({ sessionId, messages })`
    (zod-validated, idempotent per-message upsert on client UUIDs),
    `clearChatSession(id)` (cascade delete), `renameChatSession({ sessionId,
title })` (zod-validated, no-op for unknown sessions), `listChatSessions({ search, skip })`
    → `{ sessions, hasMore }` — title = custom rename ?? first message, message
    count, ordered newest first, empty sessions excluded; `search` matches
    title or message content case-insensitively (parameterized `LIKE` —
    `mode: 'insensitive'` is unsupported on this Prisma 7 + SQLite setup), a
    page of 20 by default, `hasMore` drives the sidebar's Show-more button.
  - Depends on: `lib/db.ts`, `lib/types.ts` (`ChatMessageSchema`, `ChatSessionSummary`).

- **`lib/db.ts`** — PrismaClient singleton (LibSQL driver adapter).
  - Responsibility: one client per process (dev hot-reload safe); SQLite via
    WASM (no native build tools), swappable to hosted LibSQL/Turso via
    `DATABASE_URL`.

- **`prisma/schema.prisma`** — `ChatSession` (cuid id, optional `title` for
  user renames) + `ChatMessage` (client-UUID id, `role` string since SQLite
  has no enums, `position` int for deterministic thread order, cascade
  delete). Generated client at `generated/`, migrations in
  `prisma/migrations/`.

- **`app/page.tsx`, `app/layout.tsx`, `app/globals.css`** — Shell.

### Reference docs

- **`PRD.md`** — product requirements for the chatbot: 10 FRs, 5 NFRs, edge
  cases, open questions. Names the stack (Next.js, TypeScript, Tailwind,
  Framer Motion) and, since the OpenRouter wiring, **OpenRouter as the LLM
  provider** (with `OPENAI_API_KEY` fallback and env overrides documented in
  the open-questions section). Traceability: every FR/NFR has a row in
  `tests/prd-checklist.test.ts`.

### Test tooling

- **`tests/`** — ten vitest suites (agent conventions, skill frontmatter,
  skill references, SSE parser, API route contract, PRD checklist, input
  validation, storage persistence, session actions incl. rename, context
  compression); run by `npm test`,
  scoped via `vitest.config.ts` (`tests/**` only, so Playwright specs stay
  out). `tests/actions.test.ts` spins up a temp SQLite DB (`prisma db push`)
  and exercises the Server Actions for real.
- **`.agents/skills/`** — includes three community-installed skills
  (`react-best-practices`, `vercel-react-best-practices`,
  `zod-schema-validation`, via `npx skills add`); their bundled rule files
  are vendor content, excluded from Prettier.
- **`e2e/`** — Playwright specs (`chat.spec.ts`, `responsive.spec.ts`,
  `sidebar.spec.ts`, `a11y.spec.ts`, `visual.spec.ts`) + shared `helpers.ts`
  (rename/delete covered in `sidebar.spec.ts` with unique titles, since the
  DB accumulates sessions across runs; search + Show-more covered there too)
  (SSE mock) and visual baselines in `visual.spec.ts-snapshots/` (empty
  state, streamed thread, open mobile drawer — the latter masks the
  DB-dependent session list for deterministic baselines).
  `playwright.config.ts` runs **chromium** and **mobile** (Pixel 5) projects
  against the **production build** (`npm run build && npm run start`) — no
  dev overlays, no StrictMode. Because the sidebar lists every conversation
  title, thread assertions are scoped to `main`
  (`page.locator('main').getByText(...)`); the markdown spec grants
  clipboard permissions (`test.use`) for the copy button; the mobile drawer
  spec targets `getByRole('dialog', { name: 'Conversations' })`; the a11y
  spec walks real keyboard tab order and asserts the `:focus-visible`
  outline (NFR-2).
- **`.agents/`** — Codebuff agent definitions + skills; validated by tests.

## Data flow

1. `ChatApp` restores the session id (`chat.sessionId`) and thread, then
   `Chat` renders. User types a message → `Chat` appends a user message and an
   empty assistant placeholder (with a streaming skeleton until the first
   token), opens an `AbortController`, and `POST`s the history to `/api/chat`
   (typed as `ChatWireMessage[]`).
2. The route validates, compresses history (`lib/context.ts`: last-N
   truncation + token-budget FIFO), prepends a system prompt, and calls the
   upstream `chat/completions` endpoint with `stream: true` (Bearer key
   server-side, `X-Title` for OpenRouter attribution).
3. The upstream SSE body is piped back unchanged; the client parses `data:`
   events via `lib/sse.ts` and appends each `delta.content` to the assistant
   message, re-rendering per chunk.
4. `[DONE]` ends the stream; abort (Stop) cancels the reader and keeps the
   partial reply; failures surface an inline error with retry (Regenerate
   re-runs the last user message in place); the settled thread is persisted to
   `localStorage` as a versioned `{ version: 1, messages }` payload
   (`lib/storage.ts`, Zod-validated) AND to the database via
   `saveChatMessages` (FR-11) — then `onConversationChanged` re-lists the
   sessions so the sidebar shows the new conversation. On the next load the
   DB is authoritative when the session (`chat.sessionId`) has history, with
   localStorage as the offline fallback; Clear and New Chat delete/reset the
   session from both.

## Conventions observed

- TypeScript strict + `noUncheckedIndexedAccess`; one shared `tsconfig.json`;
  `next build` may rewrite it — strict flags must survive. TypeScript pinned
  to ^6 (typescript-eslint doesn't support TS 7 yet).
- Tailwind CSS v4 (`@import 'tailwindcss'` + `@tailwindcss/postcss`), no
  `tailwind.config` file.
- App deps: Next 16, React 19, Framer Motion 13, Zod (runtime schema
  validation at boundaries — localStorage restore + request bodies + action
  inputs), Prisma 7 + `@prisma/adapter-libsql` (SQLite via WASM — no native
  build tools needed). No AI SDK — SSE is parsed by hand in `lib/sse.ts`
  (deliberate, provider-agnostic).
- Conversation history: DB (authoritative) + localStorage (fallback); message
  ids are client UUIDs so saves are idempotent upserts; `position` preserves
  thread order (createdAt can tie within one transaction).
- All secrets server-side via env (`OPENROUTER_API_KEY`); client code has no
  key access. LLM interactions mocked in e2e via `page.route`.
- Read-only agents by convention; UI code follows component-per-file layout.

## Tradeoffs (recorded decisions)

- **OpenRouter as default provider** — one key, 200+ models, free tier; the
  route stays OpenAI-compatible so switching providers is a `.env` change.
  Cost: default model/base URL branch on which key var is set. Now documented
  in `PRD.md` as the chosen provider.
- **SQLite via LibSQL adapter vs. better-sqlite3 / hosted Postgres** — the
  WASM LibSQL driver needs no native build tools (unavailable here) and
  works locally; hosted LibSQL/Turso or Postgres is a `DATABASE_URL` +
  provider change later. Cost: SQLite writes serialize (fine for single-user
  chat); no enums (roles validated in code).
- **Server Actions for persistence vs. route handlers** — mutations live in
  `app/actions.ts` (zod-validated, `{ ok }` returns, integration-tested).
  Cost: actions run in the request's server runtime, so they need the DB
  reachable from the app server (true here).
- **Hand-rolled SSE vs. Vercel AI SDK** — chosen: no SDK, full control,
  provider-agnostic. Cost: we own stream parsing and abort handling
  (unit-tested in `tests/sse.test.ts`, contract-tested in `tests/api-chat.test.ts`).
- **App merged at repo root vs. separate workspace** — single package.json,
  shared tsconfig. Cost: `next build` touches shared tsconfig; app and agent
  tooling compile together.
- **e2e against the production build** — no dev-mode overlays or StrictMode
  surprises; tests match what users get. Cost: each e2e run builds first.
- **ESLint + Prettier added to `lint`** — `eslint . && prettier --check . &&
tsc --noEmit`, with `eslint-config-prettier` last so formatting rules don't
  fight. Cost: two more tools to keep in sync (TS 6 pin is the current cost).
- **No auth / single thread in v1** — matches PRD scope; multi-conversation and
  per-user history remain future work.

## Open questions

- Whether to add multi-conversation management or per-user auth (both currently
  out of scope per PRD section 4).
- ~~Whether to add ESLint~~ — resolved: ESLint + Prettier are wired into `lint`.
- ~~Whether to enforce a documented max input length~~ — resolved: 4000 chars
  via `lib/validation.ts` (shared with the textarea `maxLength`), unit-tested
  in `tests/validation.test.ts`.
