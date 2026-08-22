# Advanced AI Chatbot & Autonomous Agent

A production-oriented Next.js chatbot with streaming responses, bounded autonomous agent workflows, Model Context Protocol integrations, document-grounded RAG, multimodal analysis, structured outputs, and cross-session memory.

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2d3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Vitest](https://img.shields.io/badge/Vitest-134_tests-6e9f18?logo=vitest&logoColor=white)](https://vitest.dev/)

## Highlights

- **Multi-Agent Workflows** - Bounded planning and sequential tool execution with retained execution memory.
- **MCP Integration** - Discover and call tools from configured Streamable HTTP MCP servers.
- **Dynamic Model Switching** - Switch models from the chat header with server-side model resolution and environment overrides.
- **Streaming Chat** - OpenAI-compatible SSE streaming with responsive word-sized rendering and abort support.
- **Video and Media Analysis** - Extract browser-side video keyframes and attach JPEG, PNG, MP3, and WAV media for multimodal requests.
- **Interactive RAG Citations** - Upload documents, retrieve relevant chunks, and open exact source excerpts from citation badges.
- **Dynamic Recharts Visualization** - Render validated time-series chart data as interactive Recharts line charts.
- **Structured Outputs** - Strict JSON schemas for tables, charts, code snippets, and citation responses.
- **Cross-Session Long-Term Memory** - Persist authenticated user preferences, entities, and bounded conversation summaries.
- **Authentication and Persistence** - NextAuth-based auth, Prisma-backed sessions/messages, document metadata, and memory.
- **Accessible Chat UI** - Responsive sidebar, mobile drawer, keyboard navigation, theme switching, retry, stop, regenerate, and copy-code actions.

## Tech Stack

- **Frontend:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Framer Motion
- **AI transport:** OpenAI-compatible Chat Completions API with SSE streaming
- **Default provider:** OpenRouter, with support for other OpenAI-compatible endpoints
- **Agent tools:** Built-in tools plus optional MCP Streamable HTTP servers
- **RAG:** Prisma-persisted document chunks with deterministic local vector embeddings and cosine retrieval
- **Visualization:** Recharts
- **Database:** SQLite through Prisma 7 and the LibSQL adapter
- **Validation:** Zod at API, upload, media, tool, structured-output, storage, and persistence boundaries
- **Testing:** Vitest unit/integration suites and Playwright end-to-end tests

## Quick Start

### Prerequisites

- Node.js 20 or newer
- npm
- An OpenRouter API key or another OpenAI-compatible API key

### Installation

```bash
git clone <repository-url>
cd <repository-directory>
npm install
```

The install hook generates the Prisma client. Create the local environment file and configure an LLM provider:

```bash
cp .env.example .env.local
```

At minimum, set `OPENROUTER_API_KEY` in `.env.local`. Then apply the local database migrations:

```bash
npx prisma migrate dev
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Setup

### Required LLM configuration

OpenRouter is the default provider:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key
```

The route uses `https://openrouter.ai/api/v1` and the default model `stealth/ox-alpha` when no overrides are provided.

For another OpenAI-compatible provider, use:

```env
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

Provider and model settings are server-side. API keys are never sent to the browser.

### Database and authentication

```env
DATABASE_URL="file:./prisma/dev.db"
AUTH_SECRET=your-secret
AUTH_TRUST_HOST=true
```

For local development or automated browser tests without authentication, you can enable the explicit bypass mode:

```env
AUTH_DISABLED=true
```

Do not enable `AUTH_DISABLED` in production.

### Model selector overrides

The chat header exposes stable model keys. Provider-specific model IDs can be overridden without changing client code:

```env
MODEL_QWEN_3_6=qwen/qwen3.5-397b-a17b
MODEL_DEEPSEEK_V4_FLASH=deepseek/deepseek-v4-flash
MODEL_KIMI_K3=moonshotai/kimi-k3
MODEL_GPT_5_6=openai/gpt-5.6
```

You can also set `OPENROUTER_APP_NAME` to send an optional `X-Title` header to OpenRouter.

### Optional MCP servers

Configure one or more Streamable HTTP MCP servers with a JSON array. Keep credentials in server-only environment variables:

```env
MCP_SERVERS_JSON='[{"id":"weather","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer your-token"}}]'
```

The agent validates server configuration, discovers available tools, applies request timeouts, bounds tool responses, and executes only discovered tools.

### Optional web search adapter

The built-in web search tool uses a configurable server-side adapter. Without these variables, it returns a clearly marked mock result:

```env
WEB_SEARCH_URL=https://search-provider.example/api/search
WEB_SEARCH_API_KEY=your-search-provider-key
```

### Context compression

Conversation history is compressed before each upstream request. The system prompt, document context, memory, and visual instructions are reserved first:

```env
MAX_HISTORY_MESSAGES=20
MAX_CONTEXT_TOKENS=8000
```

## Feature Walkthrough

### 1. Chat and model switching

1. Start a new chat or select an existing session from the sidebar.
2. Choose a model from the chat header.
3. Enter a message and send it.
4. Responses stream over SSE and render incrementally.
5. Use Stop, Retry, Regenerate, Clear, or the model selector as needed.

The selected model key is persisted locally as `chat.model`; the actual provider model ID is resolved on the server.

### 2. Autonomous agent tools

Requests that imply external retrieval, calculation, plotting, transcription, or media inspection can activate the bounded agent workflow. The agent:

1. Sends a non-streaming planning request with available function tools.
2. Executes returned built-in or MCP tool calls sequentially.
3. Adds each assistant and tool result to execution memory.
4. Repeats for a maximum of four planning steps.
5. Sends one final streamed request containing the tool results.

Built-in tools include web search, safe arithmetic evaluation, chart-point normalization, image inspection, and audio mock adapters. Arbitrary Python or JavaScript execution is intentionally not enabled in the server process.

### 3. MCP server integration

When `MCP_SERVERS_JSON` is configured, the chat route discovers tools from the configured servers. MCP tools are converted to OpenAI-compatible function definitions and namespaced as:

```text
mcp__<server-id>__<tool-name>
```

MCP failures are returned to the agent as bounded tool errors so a single unavailable integration does not crash the entire chat request.

### 4. Document RAG and citations

1. Attach a PDF, TXT, Markdown, or CSV file from the message composer.
2. The server validates the extension, MIME type, size, and session ownership.
3. Text is extracted, chunked, embedded, and stored in Prisma.
4. Relevant chunks are retrieved for subsequent questions in that session.
5. The model receives bounded context with labels such as:

   ```text
   [Document: handbook.txt, section 2]
   ```

6. Click a citation badge in an assistant response to open the exact stored chunk and source metadata in the citation drawer.

Raw uploaded files are not exposed to the model or returned to the client after processing.

### 5. Video and media analysis

The media control accepts:

- MP4 and WebM video, sampled into a maximum of six resized JPEG keyframes in the browser
- JPEG and PNG images
- MP3 and WAV audio data URLs within configured size limits

Only request-scoped frame or media data is sent to `/api/chat`; original video binaries are never persisted. Vision and audio behavior depends on the selected provider model. Audio uses the provider's `input_audio` content shape when supported.

### 6. Structured responses and charts

The route detects or accepts structured-output modes for:

- Tables
- Time-series charts
- Code snippets
- Document citations

Responses are requested with an OpenAI-compatible strict JSON schema and validated with Zod. Valid chart envelopes render as interactive Recharts line charts. Valid code responses continue through the existing highlighted code blocks and copy action. Invalid structured output falls back to the raw response instead of discarding the answer.

### 7. Cross-session memory

For authenticated users, the application stores bounded memory records for:

- Explicit preferences such as response style
- Key entities such as the user's preferred name
- Recent conversation summaries

Relevant memory is injected into future system prompts as untrusted personalization context. Memory is not enabled for anonymous requests when authentication is active.

## Project Structure

```text
app/
  api/chat/route.ts          Validated streaming chat and agent orchestration
  api/citation/route.ts      Session-owned citation lookup
  api/upload/route.ts        Document upload, extraction, and persistence
  actions.ts                 Session, preference, and persistence actions
components/
  chat-app.tsx               Application shell and model selector
  chat.tsx                   Chat state, streaming, uploads, and persistence
  citation-drawer.tsx        Interactive RAG source drawer
  markdown.tsx               Markdown, code, and citation rendering
  media-upload.tsx           Video, image, and audio attachments
  structured-response.tsx    Recharts and structured response rendering
lib/
  agent.ts                   Bounded multi-step agent loop
  agent-tools.ts             Built-in tool definitions and dispatch
  mcp-client.ts              MCP Streamable HTTP client
  memory.ts                  Long-term memory persistence and formatting
  rag.ts                     Local embeddings and document retrieval
  structured-output.ts       Structured schemas and response rendering
  video.ts                   Browser-side video frame extraction
prisma/
  schema.prisma              Database models
  migrations/                Checked-in database migrations
tests/                       Vitest unit and integration suites
e2e/                         Playwright end-to-end suites
```

## Development Commands

```bash
npm run dev          # Start the Next.js development server
npm run build        # Create the production build
npm run start        # Serve the production build
npm run typecheck    # Run strict TypeScript checking
npm test             # Run the Vitest suite
npm run test:watch   # Run Vitest in watch mode
npm run test:e2e     # Run Playwright end-to-end tests
npm run check        # Run typecheck and all Vitest tests
npm run lint         # Run ESLint, Prettier check, and TypeScript checking
npm run format       # Format the repository with Prettier
```

The end-to-end suite builds and starts the production app through Playwright. It does not require a live LLM key because chat requests are mocked in the tests.

## Security and Runtime Boundaries

- API credentials remain on the server.
- Uploads, media data, document chunks, citations, MCP calls, and tool arguments are validated and bounded.
- RAG retrieval and citation lookup are scoped to the current session and authenticated user.
- Document content and long-term memory are treated as untrusted context, not instructions.
- Arbitrary server-side code execution is not supported.
- MCP credentials are read only from server-side environment configuration.
- Video binaries and request-scoped image/audio attachments are not persisted.

## Documentation

- [`codebase-overview.md`](./codebase-overview.md) - Architecture, data flow, boundaries, and tradeoffs
- [`PRD.md`](./PRD.md) - Product requirements and traceability checklist
- [`.env.example`](./.env.example) - Environment variable template

## License

No license has been specified for this repository yet.
