import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_AGENT_STEPS, runAgent, type AgentInputMessage } from '../lib/agent'
import { toOpenAITools, validateMcpArguments, type McpTool } from '../lib/mcp-client'
import { VideoFrameSchema } from '../lib/types'

// The SSRF guard (lib/ssrf.ts) resolves configured endpoints before fetching.
// The fake `mcp.example.com` host won't resolve offline, so stub DNS to a
// public address — the guard stays active, only resolution is deterministic.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}))

const tool: McpTool = {
  serverId: 'demo',
  name: 'lookup',
  description: 'Look up a value.',
  inputSchema: { type: 'object', properties: { key: { type: 'string' } } },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('MCP client and agent loop', () => {
  it('validates discovered MCP JSON schemas before tool execution', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 2 },
        limit: { type: 'integer', maximum: 10 },
      },
    }
    expect(validateMcpArguments({ query: 'status', limit: 5 }, schema)).toBeNull()
    expect(validateMcpArguments({ query: 'x' }, schema)).toContain('too short')
    expect(validateMcpArguments({ query: 'status', extra: true }, schema)).toContain('not allowed')
    expect(validateMcpArguments({ limit: 1 }, schema)).toContain('required')
  })

  it('converts MCP tool metadata to function tools', () => {
    expect(toOpenAITools([tool])[0]).toEqual({
      type: 'function',
      function: {
        name: 'mcp__demo__lookup',
        description: 'Look up a value.',
        parameters: tool.inputSchema,
      },
    })
  })

  it('retains assistant and tool messages across bounded agent steps', async () => {
    const fetchMock = vi.fn()
    fetchMock
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
                      id: 'call-1',
                      type: 'function',
                      function: { name: 'mcp__demo__lookup', arguments: '{"key":"x"}' },
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
        new Response(JSON.stringify({ result: { protocolVersion: '2025-03-26' } }), {
          status: 200,
          headers: { 'Mcp-Session-Id': 'mcp-session' },
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { content: [{ type: 'text', text: 'value' }] } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Done.' } }] }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('MCP_SERVERS_JSON', JSON.stringify([{ id: 'demo', url: 'https://mcp.example.com' }]))

    const messages: AgentInputMessage[] = [{ role: 'user', content: 'Look up x.' }]
    const result = await runAgent({
      apiKey: 'test-key',
      baseUrl: 'https://llm.example.com/v1',
      model: 'test/model',
      messages,
      systemPrompt: 'You are an agent.',
      tools: [tool],
    })

    expect(result.toolCount).toBe(1)
    expect(result.finalMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ])
    expect(result.continuationMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(MAX_AGENT_STEPS).toBe(4)
  })

  it('uses a strict Zod-derived response schema for a tool-free structured agent', async () => {
    const structured = JSON.stringify({
      kind: 'chart',
      content: 'Trend',
      code: '',
      language: '',
      columns: [],
      rows: [],
      chart: [{ timestamp: '2026-01', value: 3 }],
      citations: [],
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: structured } }] }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runAgent({
      apiKey: 'test-key',
      baseUrl: 'https://llm.example.com/v1',
      model: 'test/model',
      messages: [{ role: 'user', content: 'Make a chart.' }],
      systemPrompt: 'Return structured data.',
      tools: [],
      builtInTools: [],
      skillTools: [],
      structuredOutput: 'chart',
    })

    expect(result.structuredOutput).toMatchObject({
      kind: 'chart',
      chart: [{ timestamp: '2026-01', value: 3 }],
    })
    const payload = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as {
      response_format?: { type: string; json_schema: { strict: boolean; schema: { type: string } } }
    }
    expect(payload.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true, schema: { type: 'object' } },
    })
  })
})

describe('video frame boundary', () => {
  it('accepts bounded JPEG data URLs and rejects non-image input', () => {
    const valid = VideoFrameSchema.safeParse({
      id: 'clip-0',
      timestamp: 1.5,
      dataUrl: 'data:image/jpeg;base64,AAAA',
    })
    expect(valid.success).toBe(true)
    expect(
      VideoFrameSchema.safeParse({ id: 'bad', timestamp: 0, dataUrl: 'file:///tmp/x' }).success,
    ).toBe(false)
  })
})
