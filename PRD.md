# PRD: Chatbot App

## 1. Overview

A consumer-facing chatbot web app. Users type a message and receive an
assistant reply streamed from an LLM API. Built with Next.js (App Router),
TypeScript, Tailwind CSS, and Framer Motion. The LLM is accessed through a
server-side proxy to OpenRouter (an OpenAI-compatible API, one key for many
models) so API credentials never reach the browser.

## 2. Problem & goal

Users want fast, conversational answers without leaving the browser. The
goal is a polished single-page chat experience where the first token appears
quickly and the UI stays responsive while responses stream in.

## 3. Target users

Individual users on desktop and mobile browsers who want a lightweight,
no-signup chat tool. (Assumption — see Open questions.)

## 4. Scope

### In scope

- Single chat thread UI (messages, input, send).
- Streaming assistant responses via a server-side LLM API proxy.
- Error and edge-case handling (empty input, failures, interrupted streams).
- Responsive layout with Tailwind CSS; Framer Motion entrance/indicator animations honoring `prefers-reduced-motion`.

### Out of scope (initial version)

- User accounts, authentication, and per-user history in a database
  (anonymous per-session history IS in scope — see FR-11).
- Multi-conversation management beyond list/switch/rename/delete (search, archive).
- File/image attachments and tool calling.

## 5. Success metrics

- Time to first token (TFT): median under 1 s after submit on a normal network.
- Reply success rate: at least 99% of non-aborted requests complete with a rendered reply.
- No console errors on happy-path interactions in production.

## 6. Functional requirements

**FR-1 — Chat thread rendering**
MUST render the conversation as a chronological list of user and assistant messages.

- AC: Given an empty thread, when the user sends the first message, then a user bubble appears immediately followed by an assistant placeholder.

**FR-2 — Message submission**
MUST let the user submit a message via the send button or the Enter key, and MUST NOT submit empty or whitespace-only input.

- AC: Given an input containing only spaces, when the user presses Enter, then nothing is sent and the input keeps focus.
- AC: Given a non-empty input, when the user presses Enter, then exactly one message is sent (no duplicate submission).

**FR-3 — Streaming responses**
SHOULD render assistant replies incrementally as tokens arrive from the LLM API.

- AC: Given a submitted message, when the API returns a stream, then tokens render progressively and a typing indicator shows until the first token arrives.

**FR-4 — LLM API integration**
MUST send the system prompt plus the conversation history to the configured LLM API from a server-side route handler, and MUST NOT expose the API key to the client.

- AC: Given a user message, when the request reaches the server route, then the API call includes the full prior history and the response streams back to the client.
- AC: Given a browser network inspection, when any request is examined, then no API key appears in client-side code or requests.

**FR-5 — Failure handling**
MUST surface request failures as a visible inline error and MUST preserve the user's message text for retry.

- AC: Given a failed API request, when the error is returned, then an inline error message appears, the user's message remains visible, and a retry action is available.

**FR-6 — Empty state**
SHOULD show a brief, helpful empty state before the first message.

- AC: Given a fresh conversation, when the page loads, then a short prompt or hint is displayed instead of a blank thread.

**FR-7 — Motion and transitions**
SHOULD use Framer Motion for message entrance and indicator transitions, and MUST respect `prefers-reduced-motion`.

- AC: Given a user with reduced-motion enabled, when a message is added, then no large or long animations play.

**FR-8 — Stop generation**
MAY provide a stop button that cancels an in-flight stream.

- AC: Given an active stream, when the user clicks stop, then token rendering halts and the partial reply remains visible.

**FR-9 — History persistence**
MAY persist the current thread in `localStorage` so a page reload restores it.

- AC: Given a thread with messages, when the page reloads, then the thread is restored if persistence is enabled.

**FR-10 — Responsive layout**
MUST be usable on mobile and desktop viewports without horizontal scrolling.

- AC: Given a 360 px wide viewport, when the thread has a long assistant reply, then the layout fits without horizontal overflow.

**FR-11 — Server-side session persistence**
MUST persist the full conversation thread per anonymous session in the database via Server Actions, and MUST restore it on reload. The database is authoritative when it has history; localStorage remains the offline fallback.

- AC: Given a session with a persisted thread, when the page reloads, then the thread is restored from the database.
- AC: Given a Clear action, when triggered, then the session and its messages are deleted from the database.

**FR-12 — Session sidebar & dark mode**
MUST list saved sessions in a sidebar with the active session highlighted and a "New Chat" action that resets to the empty state, and SHOULD offer a dark mode toggle whose preference persists across reloads.

- AC: Given saved sessions, when the sidebar renders, then each session appears with its title and the active one is visually highlighted.
- AC: Given a session, when its Rename action is used, then the new title persists and the sidebar shows it.
- AC: Given a session, when its Delete action is confirmed, then the session is removed from the sidebar and, if it was active, the thread resets to the empty state.
- AC: Given many sessions, when the sidebar renders, then only the latest page (20) is shown and a "Show more" action loads the next page.
- AC: Given a search term, when typed into the sidebar search box, then sessions whose title or message content matches appear (case-insensitive) and clearing the box restores the list.
- AC: Given a mobile viewport, when the conversations menu is opened, then the sessions appear in an overlay drawer and are switchable (the drawer closes on selection or Escape).
- AC: Given a New Chat action, when clicked, then the thread resets to the empty state and a new anonymous session is started.
- AC: Given the dark mode toggle, when switched, then the theme changes immediately and is restored on the next reload.

**FR-13 — Markdown rendering & code blocks**
SHOULD render assistant replies as Markdown, giving fenced code blocks a language badge and a one-click copy button, while raw HTML in replies displays literally (never executes).

- AC: Given an assistant reply containing a fenced code block, when rendered, then the code is syntax-highlighted with a language badge and a copy button.
- AC: Given a copy button, when clicked, then the code is copied to the clipboard and the button confirms.
- AC: Given a reply containing raw HTML, when rendered, then it appears as literal text (NFR-3 holds).

**FR-14 — Regenerate response**
SHOULD let the user re-run the last user message, replacing the previous assistant reply with a fresh stream.

- AC: Given a completed assistant reply, when Regenerate is triggered, then a new reply streams in place of the old one without duplicating the user message.

## 7. Non-functional requirements

**NFR-1 — Performance**
MUST keep the UI interactive while a stream is in progress, with median time to first token under 1 s on a normal network.

- AC: Given a streaming reply, when tokens are rendering, then input, scroll, and stop controls respond without noticeable lag.

**NFR-2 — Accessibility**
MUST be keyboard-operable with visible focus, and MUST announce new messages to assistive technology.

- AC: Given a screen reader, when a new message renders, then it is announced via `aria-live`.
- AC: Given keyboard-only navigation, when the input is focused, then Enter sends and Escape (if a stop control exists) cancels.

**NFR-3 — Security**
MUST treat user input as untrusted text and MUST render it as plain text, never as HTML.

- AC: Given a message containing markup such as `<script>`, when it renders, then it displays literally as text and never executes.

**NFR-4 — Type safety**
MUST compile under TypeScript strict mode with typed message and API payloads (no `any` for chat data).

**NFR-5 — Maintainability**
SHOULD keep chat state and API logic separate from presentational components so the message protocol can change without touching the UI.

## 8. Edge cases

- Empty or whitespace-only input (FR-2).
- Double submission from rapid Enter presses (FR-2).
- API timeout, 429 rate limit, and 5xx responses (FR-5).
- Stream interrupted mid-token by network loss (FR-5, FR-3): show a truncated-reply notice and allow retry.
- Very long messages and replies (boundary: max input length is 4000 characters, enforced by the textarea `maxLength` and `lib/validation.ts`; unit-tested in `tests/validation.test.ts`).
- Unicode, emoji, and code blocks in user or assistant text (FR-1 rendering).
- Markup in user input rendered as plain text (NFR-3).
- Reload during an active stream: thread restores without a hanging indicator (FR-9).

## 9. Open questions & assumptions

- No auth in v1 (assumed) — confirm whether accounts are planned and when.
- Single conversation thread in v1 (assumed) — confirm before adding persistence (FR-9).
- Provider/model tuning: OpenRouter is the default (via `OPENROUTER_API_KEY`,
  default model `stealth/ox-alpha`), with overrides via `OPENROUTER_BASE_URL` /
  `MODEL_NAME` and an OpenAI-compatible fallback (`OPENAI_API_KEY`) — confirm
  which models to ship in v1.
- Maximum input length and any per-user rate limiting.
- Whether retry (FR-5) should resend the full history or only the failed request.
