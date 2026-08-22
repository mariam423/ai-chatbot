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

## Application components

- **`app/api/chat/route.ts`** — Validated chat endpoint. It accepts text
  messages, a session ID, a model key, optional structured-output mode, up
  to six validated video frames, and optional still-image/audio data URLs. It retrieves session-owned RAG context,
  composes grounding/vision/memory instructions, reserves prompt tokens before
  FIFO history compression, optionally runs MCP agent steps, and streams the
  final OpenAI-compatible response.
- **`app/api/upload/route.ts`** — Node-runtime document API. `POST` accepts
  PDF/TXT/MD/CSV multipart uploads, validates ownership and limits, extracts
  text, chunks and embeds it, and stores metadata. `GET` lists session
  documents; `DELETE` removes a document and its chunks.
- **`app/actions.ts`** — Server Actions for session/message persistence,
  sidebar listing, rename/pin/archive, preferences, prompt presets, and
  long-term memory records. Inputs are Zod-validated and results use `{ ok }`
  discriminated unions.
- **`components/chat-app.tsx`** — Client shell for sessions, sidebar, command
  palette, theme, and the model selector. The selected stable model key is
  persisted as `chat.model`.
- **`components/chat.tsx`** — Chat state/orchestration for restore, send,
  retry, regenerate, stop, clear, document attachments, video frame state,
  SSE consumption, and persistence. Normal deltas are coalesced into
  word-sized UI updates. Structured JSON is validated and rendered as Markdown
  after completion.
- **`components/file-upload.tsx`** — PDF/TXT/MD/CSV attachment picker with
  compact removable badges and processing errors.
- **`components/media-upload.tsx`** — MP4/WebM picker that previews sampled
  keyframes, plus bounded JPEG/PNG and MP3/WAV attachments for the current
  vision/audio request. Original media is not persisted.
- **`components/citation-drawer.tsx`** — Interactive RAG citation badge and
  drawer UI. It loads the exact matched chunk and source metadata through the
  citation API when a `[Document: ..., section N]` citation is selected.
- **`components/message-bubble.tsx`**, **`components/markdown.tsx`**, and
  **`components/streaming-skeleton.tsx`** — User/assistant presentation,
  highlighted Markdown/code rendering with copy buttons, citation badge
  handling, and loading state.
- **`components/sidebar.tsx`** — Accessible desktop session list and mobile
  drawer with search, pagination, rename, delete, pin, archive, and theme
  controls.

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
- **`lib/mcp-client.ts`** — Optional MCP Streamable HTTP client. It validates
  `MCP_SERVERS_JSON`, initializes servers, discovers tools, converts them to
  OpenAI function definitions, validates tool arguments, applies timeouts, and
  bounds tool responses.
- **`lib/structured-output.ts`** — Intent detection, strict JSON-schema metadata,
  Zod validation, safe Markdown conversion for table/code/citation envelopes,
  and validated chart data for the Recharts renderer.
- **`lib/documents.ts`** — Bounded UTF-8/PDF extraction and overlapping text
  chunking for document RAG.
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
- **`lib/storage.ts`** — Versioned localStorage fallback for chat messages.
- **`lib/db.ts`** — Hot-reload-safe Prisma singleton using the LibSQL adapter.

## Database

- **`prisma/schema.prisma`** — `ChatSession` owns `ChatMessage[]` and
  `Document[]`. `DocumentChunk` stores bounded extracted text and a JSON vector
  embedding. `MemoryRecord` stores user-scoped preferences, entities, and
  summaries. Document and user relations cascade appropriately.
- **`prisma/migrations/20260822100000_add_documents/migration.sql`** — Creates
  the document and chunk tables and retrieval indexes.
- **`prisma/migrations/20260822120000_add_memory/migration.sql`** — Creates
  user preferences and long-term memory tables and brings session metadata
  columns into the migration history.
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
   servers, the route discovers function tools. `lib/agent.ts` makes bounded
   planning steps, executes built-in calls through `lib/agent-tools.ts` and MCP
   calls through `lib/mcp-client.ts`, retains tool results, and continues with
   the final streaming request. Ordinary chat keeps the single streaming call.
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
  unavailable servers are skipped during discovery.
- Web search and audio operations default to mock adapters when no provider is
  configured. The interfaces are replaceable without changing the agent loop.
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
  and video-frame validation.
- `npm run build` verifies the production Next.js bundle and route modules.
- `npm run test:e2e` runs the existing Playwright chat/sidebar/accessibility/
  visual flows against a production build with mocked chat streaming.
