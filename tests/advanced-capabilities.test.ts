import { afterEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => ({
  chatSessionFindFirst: vi.fn(),
  documentChunkFindFirst: vi.fn(),
}))

vi.mock('../lib/db', () => ({
  prisma: {
    chatSession: { findFirst: dbMocks.chatSessionFindFirst },
    documentChunk: { findFirst: dbMocks.documentChunkFindFirst },
  },
}))

// The chat guard requires a session (requireSession), which lazily imports
// next-auth; next-auth imports 'next/server', which only resolves inside
// Next's bundler, so mock it (same as tests/security.test.ts).
vi.mock('../lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: 'test-user' } }),
}))

vi.mock('../lib/auth-context', () => ({
  getCurrentUserId: vi.fn().mockResolvedValue(null),
}))

import { getCurrentUserId } from '../lib/auth-context'
import { GET as getCitation } from '../app/api/citation/route'
import {
  executeBuiltInAgentTool,
  hasBuiltInToolIntent,
  listBuiltInAgentTools,
} from '../lib/agent-tools'
import { extractMemoryCandidates, formatMemoryContext } from '../lib/memory'
import { POST as postChat } from '../app/api/chat/route'

function chatRequest(content: string): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content }] }),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  dbMocks.chatSessionFindFirst.mockReset()
  dbMocks.documentChunkFindFirst.mockReset()
  // Restore the anonymous default; the citation test overrides it below.
  vi.mocked(getCurrentUserId).mockResolvedValue(null)
})

describe('built-in agent tools', () => {
  it('exposes bounded web, computation, image, and audio capabilities', () => {
    expect(listBuiltInAgentTools().map((tool) => tool.name)).toEqual([
      'web_search',
      'code_interpreter',
      'image_inspect',
      'audio_transcribe',
      'audio_synthesize',
    ])
    expect(hasBuiltInToolIntent('Calculate and plot the time-series')).toBe(true)
    expect(hasBuiltInToolIntent('Tell me a short story')).toBe(false)
  })

  it('executes arithmetic and returns validated chart points without arbitrary code execution', async () => {
    const result = await executeBuiltInAgentTool({
      name: 'code_interpreter',
      arguments: {
        expression: '2 + 3 * 4',
        points: [
          { timestamp: '2026-01', value: 10 },
          { timestamp: '2026-02', value: 12 },
        ],
      },
    })
    expect(result).toMatchObject({ ok: true, tool: 'code_interpreter' })
    expect(result.data).toEqual({
      result: 14,
      chart: [
        { timestamp: '2026-01', value: 10 },
        { timestamp: '2026-02', value: 12 },
      ],
    })

    const rejected = await executeBuiltInAgentTool({
      name: 'code_interpreter',
      arguments: { expression: 'process.exit()' },
    })
    expect(rejected.ok).toBe(false)
  })
})

describe('long-term memory', () => {
  it('extracts explicit preferences and formats bounded memory context', () => {
    expect(extractMemoryCandidates('Please call me Buffy. I prefer concise answers.')).toEqual([
      { category: 'preference', key: 'explicit-preference', value: 'concise answers' },
      { category: 'entity', key: 'user-name', value: 'Buffy' },
    ])
    expect(
      formatMemoryContext([
        {
          id: '1',
          category: 'preference',
          key: 'style',
          value: 'concise',
          confidence: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ).toBe('- [preference] style: concise')
  })
})

describe('citation API', () => {
  it('returns the exact chunk only after session ownership succeeds', async () => {
    // An authenticated owner so findOwnedSession runs the ownership query
    // against the mocked DB (anonymous access would 404 without a query).
    vi.mocked(getCurrentUserId).mockResolvedValue('test-user')
    dbMocks.chatSessionFindFirst.mockResolvedValue({ id: 'session-1' })
    dbMocks.documentChunkFindFirst.mockResolvedValue({
      content: 'The refund period is 30 days.',
      chunkIndex: 1,
      document: {
        id: 'doc-1',
        name: 'handbook.txt',
        mimeType: 'text/plain',
        size: 512,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    })

    const response = await getCitation(
      new Request(
        'http://localhost/api/citation?sessionId=session-1&documentName=handbook.txt&section=2',
      ),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      section: 2,
      content: 'The refund period is 30 days.',
      document: { id: 'doc-1', name: 'handbook.txt' },
    })

    dbMocks.chatSessionFindFirst.mockReset()
    dbMocks.chatSessionFindFirst.mockResolvedValue(null)
    const denied = await getCitation(
      new Request(
        'http://localhost/api/citation?sessionId=other&documentName=handbook.txt&section=2',
      ),
    )
    expect(denied.status).toBe(404)
    expect(dbMocks.documentChunkFindFirst).toHaveBeenCalledTimes(1)
  })
})

describe('built-in tool route integration', () => {
  it('executes a tool call and sends its result into the streamed continuation', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'calc-1',
                      type: 'function',
                      function: { name: 'code_interpreter', arguments: '{"expression":"2+2"}' },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: '4' } }] }),
          {
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(new Response(stream, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await postChat(chatRequest('Calculate 2 + 2'))
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const planningBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      tools: Array<{ function: { name: string } }>
    }
    expect(planningBody.tools.some((tool) => tool.function.name === 'web_search')).toBe(true)

    const finalBody = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(finalBody.messages.some((message) => message.role === 'tool')).toBe(true)
  })
})
