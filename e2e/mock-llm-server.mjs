/**
 * Local mock of an OpenAI-compatible /chat/completions endpoint, used ONLY by
 * e2e/proxy-stream.spec.ts.
 *
 * Every other e2e spec mocks /api/chat at the browser level, so the app
 * server's real proxy code never runs against a live provider. This server
 * gives the REAL /api/chat route a deterministic upstream so the full proxy
 * path (guard -> zod -> provider fetch -> SSE passthrough) can be exercised
 * without an API key or any cost. playwright.config.ts points the app at it
 * with OPENROUTER_BASE_URL=http://127.0.0.1:4010/v1 (plus a dummy key), which
 * overrides any .env / .env.local value.
 *
 * Endpoints:
 *  - GET  /__health          -> 200 { ok: true }  (Playwright readiness probe)
 *  - GET  /__last-request    -> the most recently recorded chat-completions
 *                               request body as JSON (so the spec can assert
 *                               what the server actually sent, e.g. max_tokens)
 *  - POST /v1/chat/completions
 *      Records the parsed JSON body, then:
 *       - stream: true  -> SSE stream of a long reply whose mid marker sits
 *                          past the 4096-token default cap and whose tail
 *                          marker is at the very end (mirrors the markers in
 *                          e2e/long-reply-export.spec.ts; the proxy spec
 *                          asserts both come back verbatim).
 *       - stream: false -> a plain (non-SSE) JSON completion, so an agent
 *                          planning call would still get a valid answer.
 */

import { createServer } from 'node:http'

const HOST = '127.0.0.1'
const PORT = Number(process.env.MOCK_LLM_PORT) || 4010

let lastRequest = null

const MARKER_MID = 'MID_MARKER_PAST_THE_DEFAULT_4096_TOKEN_CAP'
const MARKER_TAIL = 'TAIL_MARKER_FINAL_SENTENCE_END'

const filler = (n, tag) =>
  Array.from(
    { length: n },
    (_, i) =>
      `${tag} paragraph ${i}: the quick brown fox jumps over the lazy dog while the stream keeps flowing far past the token budget of the conservative default.`,
  ).join('\n\n')

/** ~30,500 chars (~7,600 tokens — well beyond the 4096 default). */
function longReply() {
  return [
    'Here is a deliberately very long answer.',
    filler(150, 'Opening'),
    MARKER_MID,
    filler(100, 'Middle'),
    MARKER_TAIL,
  ].join('\n\n')
}

function sseChunk(content) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/__health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/__last-request') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(lastRequest))
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    lastRequest = { url: req.url, body }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    })

    if (body.stream) {
      const reply = longReply()
      // Stream the reply in ~512-char chunks with a small pause between them
      // so the proxy genuinely passes an ongoing stream rather than one blob.
      const partSize = 512
      for (let i = 0; i < reply.length; i += partSize) {
        res.write(sseChunk(reply.slice(i, i + partSize)))
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    res.end(
      JSON.stringify({
        id: 'mock-completion',
        object: 'chat.completion',
        created: Date.now(),
        model: body.model ?? 'mock-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: longReply() },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    )
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: `not found: ${req.method} ${url.pathname}` }))
})

server.listen(PORT, HOST, () => {
  console.log(`[mock-llm] listening on http://${HOST}:${PORT}`)
})
