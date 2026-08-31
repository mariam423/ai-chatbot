# Project knowledge

## What this is

A Next.js chatbot app (App Router, TypeScript, Tailwind CSS v4, Framer Motion)
that streams replies from an OpenAI-compatible LLM API — plus the Codebuff
agent scaffold (`.agents/`) and tests that validate both.

## Key files / directories

- `app/page.tsx`, `app/layout.tsx` — homepage and root layout.
- `app/api/chat/route.ts` — server-side streaming proxy to the LLM API
  (OpenAI-compatible chat completions; credentials never reach the client).
  The request body is validated with a Zod schema (`ChatRequestSchema`,
  non-empty `ChatWireMessage[]`); invalid bodies return 400 with structured
  `issues`.
- `app/actions.ts` — Server Actions for per-session conversation persistence
  (FR-11): createChatSession, getChatSession, saveChatMessages, clearChatSession,
  listChatSessions (sidebar session list, newest first, empty sessions excluded,
  with `{ search, skip }` support — case-insensitive match on title or message
  content, default page of 20, `hasMore` flag) and renameChatSession (custom
  sidebar title). All return `{ ok }` results; inputs validated with Zod.
- `prisma/schema.prisma` — ChatSession has an optional `title` (user-renamed
  sidebar label); when null the sidebar derives the title from the first message.
- `lib/db.ts` — PrismaClient singleton (LibSQL adapter, WASM).
- `prisma/schema.prisma` — ChatSession + ChatMessage models (SQLite); generated
  client at `generated/` (gitignored), migrations in `prisma/migrations/`.
- `components/chat-app.tsx` — app shell: sidebar + thread layout, session id
  management (New Chat clears the id AND the cached thread), dark/light theme
  toggle persisted in `chat.theme`, session list refresh.
- `components/sidebar.tsx` — sidebar: DB session list with active highlight,
  New Chat, dark mode toggle, and per-session rename/delete (row ⋯ menu →
  inline rename input or two-step delete confirm). Desktop aside at `md+`;
  on mobile the same content renders in an overlay drawer (slide-in,
  backdrop, focus trap, Escape to close, `inert` + `aria-hidden` while
  closed) opened from the header menu button.
- `components/chat.tsx` — chat client: streaming via SSE, stop, retry,
  regenerate (re-runs the last user message in place), clear conversation,
  streaming skeleton pre-first-token, Framer Motion animations, DB persist on
  success/failure/abort.
- `components/markdown.tsx` — assistant replies rendered as Markdown
  (react-markdown + remark-gfm + rehype-highlight): code blocks get a language
  badge + copy button; raw HTML stays escaped (NFR-3).
- `components/message-bubble.tsx`, `components/streaming-skeleton.tsx` —
  message bubble (markdown for assistant) and the pre-first-token skeleton.
- `lib/sse.ts` — SSE parsing helpers (extractSSEEvents, deltaText, readSSEStream).
- `lib/context.ts` — history truncation + token-budget compression for LLM
  requests: keeps the last N messages, then drops the oldest until the
  estimated tokens fit (defaults 20 / 8000; env `MAX_HISTORY_MESSAGES` /
  `MAX_CONTEXT_TOKENS`). Deterministic FIFO, no extra LLM calls.
- `lib/storage.ts` — versioned localStorage thread persistence (loadThread/
  saveThread/clearThread/normalizeThread); payload is `{ version: 3, branches,
active }` with optional per-message `model`/`modelOverridden` (which model
  served a reply, and whether it was swapped) — validated with Zod at the
  storage boundary. Legacy unversioned data (a bare array) and v1/v2 payloads
  are migrated on first load and written back in the current format;
  corrupt/partial data → empty thread.
- `lib/types.ts` — shared chat + SSE types; `ChatMessageSchema` and
  `ChatWireMessageSchema` (Zod) are the source of truth for `ChatMessage` and
  `ChatWireMessage`; `ChatSessionSummary` for the sidebar session list.
- `.agents/` — custom Codebuff agents (one file per agent, `<id>.ts`), types
  in `.agents/types/`, skills in `.agents/skills/<name>/SKILL.md`.
- `tests/` — vitest suites: agent conventions, skill frontmatter, skill
  references, `sse.test.ts` (streaming parser), `api-chat.test.ts` (route
  contract), and `prd-checklist.test.ts` (PRD traceability).
- `e2e/chat.spec.ts` — Playwright e2e for the chat flow (mocked LLM API,
  no key needed); run via `npm run test:e2e`.
- `e2e/sidebar.spec.ts` — Playwright e2e for Phase 3 UI: sidebar session
  list + New Chat, dark mode persistence, regenerate, markdown code blocks
  (badge + copy), the mobile drawer (open/list/switch/Escape), session
  rename/delete, search (debounced, resets on clear), and Show-more
  pagination. Grants clipboard permissions via `test.use`.
- `e2e/a11y.spec.ts` — Playwright e2e accessibility checks (NFR-2): keyboard
  nav with real `:focus-visible` ring assertions, `aria-current` tracking on
  the active session, mobile drawer focus trap + Escape/focus return.
- `e2e/visual.spec.ts` — visual regression snapshots of the chat UI
  (baselines in `e2e/visual.spec.ts-snapshots/`; regenerate after intentional
  UI changes with `npx playwright test e2e/visual.spec.ts --update-snapshots`).
  Covers the empty state, a mocked stream thread, and the open mobile drawer
  (mobile project only; the DB-dependent session list is masked so the
  baseline is deterministic).
  Tests force `prefers-reduced-motion` so animations don't blur baselines.
- `PRD.md` — product requirements for the chatbot app.
- `codebase-overview.md` — architecture map of what exists, produced with the
  codebase-overview agent workflow.

## Commands

```bash
npm install        # install all deps (app + dev tooling); postinstall runs prisma generate
npx prisma migrate dev  # apply schema migrations to the local SQLite DB
npm run dev        # Next.js dev server
npm run build      # production build (also typechecks the app)
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit over app + .agents/ + tests/
npm run lint       # eslint . (Next + TS rules), prettier --check ., then tsc --noEmit
npm run format     # prettier --write .
npm test           # vitest run — agents, skills, SSE parser, route, PRD
npm run test:e2e   # Playwright e2e (auto-builds + starts the production server)
npm run check      # typecheck + tests
```

## Environment

- `OPENROUTER_API_KEY` — preferred: wires the app to OpenRouter (one key,
  200+ models, free models available). Copy `.env.example` → `.env.local`.
- `OPENAI_API_KEY` — also supported for any other OpenAI-compatible endpoint.
  When only `OPENROUTER_API_KEY` is set, the route defaults to
  `https://openrouter.ai/api/v1` and model `stealth/ox-alpha` (a genuinely
  free, vision-capable route — 0-cost and verified live, so the app works on
  a zero-credit key; override with `FALLBACK_MODEL`). The 404/402/429 error
  retry is per-provider: OpenRouter retries with `FALLBACK_MODEL`,
  Gemini with `GEMINI_FALLBACK_MODEL` (default `gemini-2.5-flash-lite`), and
  OpenAI with `OPENAI_FALLBACK_MODEL` (default `gpt-4o-mini`). Otherwise
  defaults are OpenAI's (`api.openai.com/v1`, `gpt-4o-mini`).
- `OPENROUTER_BASE_URL`, `MODEL_NAME` — override OpenRouter defaults.
- `OPENAI_BASE_URL`, `OPENAI_MODEL` — override OpenAI defaults.
- `OPENROUTER_APP_NAME` — optional; sent as `X-Title` for OpenRouter app
  attribution.
- `DATABASE_URL` — SQLite file for conversation history (`file:./prisma/dev.db`
  in `.env`); production: hosted LibSQL/Turso URL.

## Conventions

- Agent files live in `.agents/` and import types from `./types/...`:
  `import { AgentDefinition, ToolName, ModelName } from './types/agent-definition'`.
- File name must match the agent id: `.agents/<id>.ts` with
  `id` being lowercase letters, numbers, and hyphens only (e.g. `'code-reviewer'`).
- Agent `id`s must be unique across the repo; `displayName` and `model` are required.
- `model` can be any OpenRouter model slug (see `ModelName` in
  `agent-definition.ts`; recommended models are listed there).
- For MCP server env vars, use `'$VAR_NAME'` syntax to read from local env
  (e.g. `.env.local`) rather than hardcoding secrets.
- Prefer `instructionsPrompt` over `stepPrompt`/`systemPrompt` to shape agent
  behavior; `inheritParentSystemPrompt` cannot be combined with `systemPrompt`.
- `outputSchema` is only allowed when `outputMode` is `'structured_output'`.
- `reasoningOptions` must provide `max_tokens` or `effort` (enforced by TS as
  an exclusive union — narrow with `'max_tokens' in opts` when checking).
- Adding an agent file should keep `npm run check` green; new conventions that
  should hold for all agents belong in `tests/agent-definitions.test.ts`.

## Gotchas

- `tsconfig.json` is shared between the app and the agent tooling; `next build`
  may rewrite it (it adds its required options). Keep strict flags intact.
- The app requires `.env.local` with `OPENROUTER_API_KEY` (or `OPENAI_API_KEY`);
  without it, `/api/chat` returns 500 with a clear error by design.
- TypeScript is pinned to ^6: typescript-eslint (bundled by eslint-config-next)
  does not support TS 7 yet — bump both together when that changes.
- `lib/sse.ts` parses OpenAI-compatible SSE manually (no AI SDK dependency);
  swapping to a different streaming protocol means updating it.
- Playwright e2e reuses an existing server on port 3000
  (`reuseExistingServer` in `playwright.config.ts`). If a `next dev` server
  is running, e2e runs against it — dev overlays (`nextjs-portal`, the
  "Open Next.js Dev Tools" bubble) can intercept clicks, and StrictMode
  double-rendering kicks in. Stop `next dev` before `npm run test:e2e` so the
  production build is used.
- The desktop sidebar lists every conversation title, so e2e thread-text
  assertions must be scoped to `<main>` (`page.locator('main').getByText(...)`)
  or they match sidebar entries too (strict-mode violations). Same for the
  mobile drawer (`role=dialog`, `aria-label="Conversations"`).
- The mobile drawer container is `inert` + `aria-hidden` while closed, so
  Playwright `toBeHidden()` works even though the panel is only translated
  off-screen.
- Chromium quirk (a11y spec): after ANY interaction, the first Tab press is
  absorbed into `<body>` — only a fresh page load starts native tab order at
  the skip link. The keyboard-walk test reloads first, and must wait for the
  fire-and-forget `saveChatMessages` to land (session visible in the sidebar)
  before reloading, or the reload cancels the in-flight DB write.
- `vitest.config.ts` maps the `@/` path alias (matching tsconfig) so tests can
  import app modules — required since the route imports `ChatWireMessageSchema`
  as a runtime value.
- The /api/chat route truncates/compresses history before calling the LLM
  (per the session-compression skill): newest message is never dropped, even
  if it alone exceeds the budget. Abstractive (LLM) summarization is
  deliberately not used — it would add a second LLM call per request.
- The /api/chat route truncates/compresses history before the LLM call (per
  the session-compression skill): newest message is never dropped even if it
  alone exceeds the budget. Abstractive (LLM) summarization is deliberately
  not used — it would add a second LLM call per request.
- Conversation history (FR-11): Server Actions persist the thread per
  anonymous session (`chat.sessionId` in localStorage) via Prisma/SQLite;
  the DB is authoritative on load, localStorage is the offline fallback.
  Message ids are globally unique (client UUIDs) — re-saving is an idempotent
  upsert; reusing an id across sessions would update the wrong row.
- SQLite runs through `@prisma/adapter-libsql` (WASM) — `better-sqlite3`
  needs native build tools (`make`/`g++`) that are unavailable here. Re-run
  `npx prisma generate` after any schema change (postinstall does it).
- Conversation persistence (FR-9) is best-effort via localStorage
  (`chat.messages` key). The stored payload is versioned
  (`{ version: 3, branches, active }`, with optional per-message `model` /
  `modelOverridden`) — bump `THREAD_STORAGE_VERSION` in `lib/storage.ts` and
  add a migration case to `normalizeThread` when the shape changes; legacy
  unversioned data (bare array) and v1/v2 payloads are migrated to v3 on
  first load and written back (tested). The persist effect is
  guarded by a `restored` flag: without it, React StrictMode's double effect
  run in dev writes `[]` over a stored thread before restore applies.
  Stream-settle persistence is deterministic (not effect-timed) so a reload
  right after a reply keeps it.
- `ChatMessage` is derived from the Zod `ChatMessageSchema` in `lib/types.ts`
  (the schema is the source of truth; it also validates restored data). zod
  is a runtime dependency of the client bundle.
- The chat restore effect is async and must not clobber newer state: a stale
  `getChatSession` could resolve after a New Chat/switch (cancelled via the
  effect cleanup) or after a regenerate/send (invalidated via a
  thread-generation ref bumped on every send/regenerate/clear). Without
  these guards, an in-flight restore re-populated the old thread and e2e
  flaked (regenerate: reply never rendered; delete: reset never landed).
  Rename/delete sessions are e2e-covered with unique titles
  (`Renamed ${Date.now()}`) since the DB accumulates sessions across runs.
