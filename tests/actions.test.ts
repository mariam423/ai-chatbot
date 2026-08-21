import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../lib/types'

// Mock auth context — next-auth can't run in vitest (no next/server).
// Server actions fall through to anonymous access (userId=null) in tests.
vi.mock('../lib/auth-context', () => ({
  getCurrentUserId: vi.fn().mockResolvedValue(null),
}))

// lib/db.ts reads DATABASE_URL at import time, so the temp DB must be set up
// and the env var set BEFORE the actions module is (dynamically) imported.
const dir = mkdtempSync(join(tmpdir(), 'chat-actions-'))
const dbPath = join(dir, 'test.db')

let actions: typeof import('../app/actions')

beforeAll(() => {
  process.env.DATABASE_URL = `file:${dbPath}`
  execSync('npx prisma db push --accept-data-loss', {
    stdio: 'pipe',
    env: process.env,
  })
})

afterAll(() => {
  delete process.env.DATABASE_URL
  rmSync(dir, { recursive: true, force: true })
})

// Message ids are globally unique (client-generated UUIDs in production), so
// each session's thread uses distinct ids — reusing ids across sessions would
// upsert (update) the first session's rows instead of creating new ones.
function threadFor(sessionId: string): ChatMessage[] {
  return [
    { id: `${sessionId}-1`, role: 'user', content: 'Hello' },
    { id: `${sessionId}-2`, role: 'assistant', content: 'Hi there' },
    { id: `${sessionId}-3`, role: 'user', content: 'How are you?' },
  ]
}

describe('conversation persistence server actions', () => {
  beforeAll(async () => {
    actions = await import('../app/actions')
  })

  it('returns an empty thread for an unknown session', async () => {
    const result = await actions.getChatSession('no-such-session')
    expect(result).toEqual({ ok: true, messages: [] })
  })

  it('rejects an invalid session id', async () => {
    expect(await actions.getChatSession('')).toEqual({ ok: false, error: 'Invalid session id.' })
  })

  it('persists a thread and loads it in order', async () => {
    const thread = threadFor('sess-a')
    const saved = await actions.saveChatMessages({ sessionId: 'sess-a', messages: thread })
    expect(saved).toEqual({ ok: true })

    const loaded = await actions.getChatSession('sess-a')
    expect(loaded).toEqual({ ok: true, messages: thread })
  })

  it('is idempotent: re-saving the same thread does not duplicate messages', async () => {
    const thread = threadFor('sess-b')
    await actions.saveChatMessages({ sessionId: 'sess-b', messages: thread })
    await actions.saveChatMessages({ sessionId: 'sess-b', messages: thread })

    const loaded = await actions.getChatSession('sess-b')
    expect(loaded).toEqual({ ok: true, messages: thread })
  })

  it('updates a message in place when content changes', async () => {
    const thread = threadFor('sess-c')
    await actions.saveChatMessages({ sessionId: 'sess-c', messages: thread })
    const edited: ChatMessage[] = [...thread.slice(0, 2), { ...thread[2]!, content: 'Are you ok?' }]
    await actions.saveChatMessages({ sessionId: 'sess-c', messages: edited })

    const loaded = await actions.getChatSession('sess-c')
    expect(loaded).toEqual({ ok: true, messages: edited })
    expect((loaded as { messages: ChatMessage[] }).messages).toHaveLength(3)
  })

  it('rejects messages with an invalid role', async () => {
    // The input type already rejects 'system' at compile time — cast to test
    // the runtime zod guard against a payload that slips past the types.
    const bad = await actions.saveChatMessages({
      sessionId: 'sess-d',
      messages: [{ id: 'x', role: 'system', content: 'nope' }] as unknown as ChatMessage[],
    })
    expect(bad).toEqual({ ok: false, error: 'Invalid session id or messages payload.' })
  })

  it('rejects an empty messages array', async () => {
    const bad = await actions.saveChatMessages({ sessionId: 'sess-e', messages: [] })
    expect(bad).toEqual({ ok: false, error: 'Invalid session id or messages payload.' })
  })

  it('creates a session via createChatSession and clears it with clearChatSession', async () => {
    const created = await actions.createChatSession()
    expect(created.ok).toBe(true)
    const sessionId = (created as { sessionId: string }).sessionId
    const thread = threadFor(sessionId)

    await actions.saveChatMessages({ sessionId, messages: thread })
    expect(await actions.getChatSession(sessionId)).toEqual({ ok: true, messages: thread })

    expect(await actions.clearChatSession(sessionId)).toEqual({ ok: true })
    expect(await actions.getChatSession(sessionId)).toEqual({ ok: true, messages: [] })
  })

  it('clearChatSession on an unknown session is a no-op success', async () => {
    expect(await actions.clearChatSession('no-such-session')).toEqual({ ok: true })
  })

  describe('listChatSessions', () => {
    // Earlier tests populate the same temp DB — reset between list tests.
    beforeEach(async () => {
      const { prisma } = await import('../lib/db')
      await prisma.chatSession.deleteMany()
    })

    it('returns an empty list when there are no sessions', async () => {
      expect(await actions.listChatSessions()).toEqual({
        ok: true,
        sessions: [],
        hasMore: false,
      })
    })

    it('paginates with skip/take and reports hasMore', async () => {
      for (const id of ['page-1', 'page-2', 'page-3', 'page-4', 'page-5']) {
        await actions.saveChatMessages({ sessionId: id, messages: threadFor(id) })
        await new Promise((resolve) => setTimeout(resolve, 5))
      }

      const first = await actions.listChatSessions({ skip: 0, take: 2 })
      expect(first.ok).toBe(true)
      const firstPage = (first as { sessions: Array<{ id: string }>; hasMore: boolean }).sessions
      expect(firstPage.map((s) => s.id)).toEqual(['page-5', 'page-4'])
      expect((first as { hasMore: boolean }).hasMore).toBe(true)

      const second = await actions.listChatSessions({ skip: 2, take: 2 })
      expect(second.ok).toBe(true)
      const secondPage = (second as { sessions: Array<{ id: string }>; hasMore: boolean }).sessions
      expect(secondPage.map((s) => s.id)).toEqual(['page-3', 'page-2'])
      expect((second as { hasMore: boolean }).hasMore).toBe(true)

      const third = await actions.listChatSessions({ skip: 4, take: 2 })
      expect(third.ok).toBe(true)
      const thirdPage = (third as { sessions: Array<{ id: string }>; hasMore: boolean }).sessions
      expect(thirdPage.map((s) => s.id)).toEqual(['page-1'])
      expect((third as { hasMore: boolean }).hasMore).toBe(false)
    })

    it('searches by custom title (case-insensitive)', async () => {
      await actions.saveChatMessages({
        sessionId: 'sess-search-1',
        messages: threadFor('sess-search-1'),
      })
      await actions.renameChatSession({ sessionId: 'sess-search-1', title: 'My Trip to Paris' })
      await actions.saveChatMessages({
        sessionId: 'sess-search-2',
        messages: threadFor('sess-search-2'),
      })

      const result = await actions.listChatSessions({ search: 'trip to paris' })
      expect(result.ok).toBe(true)
      const sessions = (result as { sessions: Array<{ id: string }> }).sessions
      expect(sessions.map((s) => s.id)).toEqual(['sess-search-1'])
    })

    it('searches by message content', async () => {
      // Distinct content so only this session matches (threadFor is shared).
      const unique = threadFor('sess-content')
      unique[2] = { ...unique[2]!, content: 'Search this exact phrase' }
      await actions.saveChatMessages({ sessionId: 'sess-content', messages: unique })
      await actions.saveChatMessages({ sessionId: 'sess-other', messages: threadFor('sess-other') })

      const result = await actions.listChatSessions({ search: 'search this exact phrase' })
      expect(result.ok).toBe(true)
      const sessions = (result as { sessions: Array<{ id: string }> }).sessions
      expect(sessions.map((s) => s.id)).toEqual(['sess-content'])
    })

    it('returns nothing for a search with no matches', async () => {
      await actions.saveChatMessages({ sessionId: 'sess-none', messages: threadFor('sess-none') })

      const result = await actions.listChatSessions({ search: 'zzz-no-such-session' })
      expect(result).toEqual({ ok: true, sessions: [], hasMore: false })
    })

    it('rejects invalid list options', async () => {
      expect(await actions.listChatSessions({ skip: -1 })).toEqual({
        ok: false,
        error: 'Invalid list options.',
      })
      expect(await actions.listChatSessions({ take: 0 })).toEqual({
        ok: false,
        error: 'Invalid list options.',
      })
    })

    it('lists sessions newest-first with a title from the first message', async () => {
      const older = threadFor('older')
      await actions.saveChatMessages({ sessionId: 'older', messages: older })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const newer = threadFor('newer')
      await actions.saveChatMessages({ sessionId: 'newer', messages: newer })

      const result = await actions.listChatSessions()
      expect(result.ok).toBe(true)
      const sessions = (
        result as { sessions: Array<{ id: string; title: string; messageCount: number }> }
      ).sessions
      expect(sessions.map((s) => s.id)).toEqual(['newer', 'older'])
      expect(sessions[0]).toMatchObject({
        title: 'Hello',
        messageCount: 3,
      })
    })

    it('excludes empty sessions (created but never used) from the list', async () => {
      const created = await actions.createChatSession()
      expect(created.ok).toBe(true)
      const existing = await actions.listChatSessions()
      expect(existing.ok).toBe(true)
      const ids = (existing as { sessions: Array<{ id: string }> }).sessions.map((s) => s.id)
      expect(ids).not.toContain((created as { sessionId: string }).sessionId)
    })
  })

  describe('renameChatSession', () => {
    beforeEach(async () => {
      const { prisma } = await import('../lib/db')
      await prisma.chatSession.deleteMany()
    })

    it('persists a renamed title and lists it', async () => {
      const thread = threadFor('sess-rename')
      await actions.saveChatMessages({ sessionId: 'sess-rename', messages: thread })

      expect(
        await actions.renameChatSession({ sessionId: 'sess-rename', title: 'My trip plan' }),
      ).toEqual({ ok: true })

      const result = await actions.listChatSessions()
      expect(result.ok).toBe(true)
      const sessions = (result as { sessions: Array<{ id: string; title: string }> }).sessions
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({ id: 'sess-rename', title: 'My trip plan' })
    })

    it('falls back to the first-message title when the session has no custom title', async () => {
      const thread = threadFor('sess-no-title')
      await actions.saveChatMessages({ sessionId: 'sess-no-title', messages: thread })

      const result = await actions.listChatSessions()
      const sessions = (result as { sessions: Array<{ id: string; title: string }> }).sessions
      expect(sessions[0]).toMatchObject({ id: 'sess-no-title', title: 'Hello' })
    })

    it('rejects an empty or whitespace-only title', async () => {
      expect(await actions.renameChatSession({ sessionId: 'sess-x', title: '' })).toEqual({
        ok: false,
        error: 'Invalid session id or title.',
      })
      expect(await actions.renameChatSession({ sessionId: 'sess-x', title: '   ' })).toEqual({
        ok: false,
        error: 'Invalid session id or title.',
      })
    })

    it('renaming an unknown session is a no-op success', async () => {
      expect(
        await actions.renameChatSession({ sessionId: 'no-such-session', title: 'Anything' }),
      ).toEqual({ ok: true })
    })
  })
})
