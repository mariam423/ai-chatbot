import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_AGENT_STEPS, runAgent, type AgentInputMessage } from '../lib/agent'
import { toOpenAITools, type McpTool } from '../lib/mcp-client'
import { VideoFrameSchema } from '../lib/types'

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
