import { execSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../lib/types'
import { getCurrentUserId } from '../lib/auth-context'

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

/** A single-branch persistence payload (the common case). */
function branchesFor(sessionId: string): ChatMessage[][] {
  return [threadFor(sessionId)]
}

/** The shape getChatSession returns for a single-branch session. */
function singleBranchExpected(sessionId: string) {
  return {
    ok: true,
    branches: branchesFor(sessionId),
    active: 0,
    systemPrompt: null,
  } as const
}

describe('conversation persistence server actions', () => {
  beforeAll(async () => {
    actions = await import('../app/actions')
  })

  it('returns an empty thread for an unknown session', async () => {
    const result = await actions.getChatSession('no-such-session')
    expect(result).toEqual({ ok: true, branches: [], active: 0, systemPrompt: null })
  })

  it('rejects an invalid session id', async () => {
    expect(await actions.getChatSession('')).toEqual({ ok: false, error: 'Invalid session id.' })
  })

  it('persists a thread and loads it in order', async () => {
    const thread = threadFor('sess-a')
    const saved = await actions.saveChatMessages({ sessionId: 'sess-a', branches: [thread] })
    expect(saved).toEqual({ ok: true })

    const loaded = await actions.getChatSession('sess-a')
    expect(loaded).toEqual({
      ok: true,
      branches: [thread],
      active: 0,
      systemPrompt: null,
    })
  })

  it('persists multiple branches and the active branch index', async () => {
    const original = threadFor('sess-branch')
    // A fork diverges from the first two messages with a new user prompt.
    const fork: ChatMessage[] = [
      ...original.slice(0, 2),
      { id: 'forkb-1', role: 'user', content: 'Hello (edited)' },
      { id: 'forkb-2', role: 'assistant', content: 'Fork reply' },
    ]
    const saved = await actions.saveChatMessages({
      sessionId: 'sess-branch',
      branches: [original, fork],
      active: 1,
    })
    expect(saved).toEqual({ ok: true })

    const loaded = await actions.getChatSession('sess-branch')
    expect(loaded).toEqual({
      ok: true,
      branches: [original, fork],
      active: 1,
      systemPrompt: null,
    })
  })

  it('restores an empty (just-forked) branch whose index is active', async () => {
    // A fork creates the branch before any message is sent on it.
    const original = threadFor('sess-empty-fork')
    const saved = await actions.saveChatMessages({
      sessionId: 'sess-empty-fork',
      branches: [original, []],
      active: 1,
    })
    expect(saved).toEqual({ ok: true })

    const loaded = await actions.getChatSession('sess-empty-fork')
    expect(loaded).toEqual({
      ok: true,
      branches: [original, []],
      active: 1,
      systemPrompt: null,
    })
  })

  it('updates the active branch via setActiveBranch', async () => {
    const original = threadFor('sess-switch')
    const fork: ChatMessage[] = [
      ...original,
      { id: 'switch-b', role: 'assistant', content: 'extra' },
    ]
    await actions.saveChatMessages({
      sessionId: 'sess-switch',
      branches: [original, fork],
      active: 0,
    })
    expect(await actions.setActiveBranch({ sessionId: 'sess-switch', active: 1 })).toEqual({
      ok: true,
    })

    const loaded = await actions.getChatSession('sess-switch')
    expect(loaded).toEqual({
      ok: true,
      branches: [original, fork],
      active: 1,
      systemPrompt: null,
    })
  })

  it('rejects an invalid setActiveBranch payload', async () => {
    expect(await actions.setActiveBranch({ sessionId: '', active: 0 })).toEqual({
      ok: false,
      error: 'Invalid session id or branch index.',
    })
    expect(await actions.setActiveBranch({ sessionId: 'sess-x', active: 99 })).toEqual({
      ok: false,
      error: 'Invalid session id or branch index.',
    })
  })

  it('is idempotent: re-saving the same thread does not duplicate messages', async () => {
    const thread = threadFor('sess-b')
    await actions.saveChatMessages({ sessionId: 'sess-b', branches: [thread] })
    await actions.saveChatMessages({ sessionId: 'sess-b', branches: [thread] })

    const loaded = await actions.getChatSession('sess-b')
    expect(loaded).toEqual(singleBranchExpected('sess-b'))
  })

  it('updates a message in place when content changes', async () => {
    const thread = threadFor('sess-c')
    await actions.saveChatMessages({ sessionId: 'sess-c', branches: [thread] })
    const edited: ChatMessage[] = [...thread.slice(0, 2), { ...thread[2]!, content: 'Are you ok?' }]
    await actions.saveChatMessages({ sessionId: 'sess-c', branches: [edited] })

    const loaded = await actions.getChatSession('sess-c')
    expect(loaded).toEqual({ ok: true, branches: [edited], active: 0, systemPrompt: null })
    expect((loaded as { branches: ChatMessage[][] }).branches[0]).toHaveLength(3)
  })

  it('rejects messages with an invalid role', async () => {
    // The input type already rejects 'system' at compile time — cast to test
    // the runtime zod guard against a payload that slips past the types.
    const bad = await actions.saveChatMessages({
      sessionId: 'sess-d',
      branches: [[{ id: 'x', role: 'system', content: 'nope' } as unknown as ChatMessage]],
    })
    expect(bad).toEqual({ ok: false, error: 'Invalid session id, branches, or messages payload.' })
  })

  it('rejects an empty branches array and an empty branch', async () => {
    const emptyTop = await actions.saveChatMessages({ sessionId: 'sess-e', branches: [] })
    expect(emptyTop).toEqual({
      ok: false,
      error: 'Invalid session id, branches, or messages payload.',
    })
    const emptyBranch = await actions.saveChatMessages({ sessionId: 'sess-e', branches: [[]] })
    expect(emptyBranch).toEqual({
      ok: false,
      error: 'Invalid session id, branches, or messages payload.',
    })
  })

  it('creates a session via createChatSession and clears it with clearChatSession', async () => {
    const created = await actions.createChatSession()
    expect(created.ok).toBe(true)
    const sessionId = (created as { sessionId: string }).sessionId
    const thread = threadFor(sessionId)

    await actions.saveChatMessages({ sessionId, branches: [thread] })
    const loaded = await actions.getChatSession(sessionId)
    expect(loaded).toEqual({ ok: true, branches: [thread], active: 0, systemPrompt: null })

    expect(await actions.clearChatSession(sessionId)).toEqual({ ok: true })
    expect(await actions.getChatSession(sessionId)).toEqual({
      ok: true,
      branches: [],
      active: 0,
      systemPrompt: null,
    })
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
        await actions.saveChatMessages({ sessionId: id, branches: branchesFor(id) })
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
        branches: branchesFor('sess-search-1'),
      })
      await actions.renameChatSession({ sessionId: 'sess-search-1', title: 'My Trip to Paris' })
      await actions.saveChatMessages({
        sessionId: 'sess-search-2',
        branches: branchesFor('sess-search-2'),
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
      await actions.saveChatMessages({ sessionId: 'sess-content', branches: [unique] })
      await actions.saveChatMessages({
        sessionId: 'sess-other',
        branches: branchesFor('sess-other'),
      })

      const result = await actions.listChatSessions({ search: 'search this exact phrase' })
      expect(result.ok).toBe(true)
      const sessions = (result as { sessions: Array<{ id: string }> }).sessions
      expect(sessions.map((s) => s.id)).toEqual(['sess-content'])
    })

    it('returns nothing for a search with no matches', async () => {
      await actions.saveChatMessages({
        sessionId: 'sess-none',
        branches: branchesFor('sess-none'),
      })

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
      await actions.saveChatMessages({ sessionId: 'older', branches: [older] })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const newer = threadFor('newer')
      await actions.saveChatMessages({ sessionId: 'newer', branches: [newer] })

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
      await actions.saveChatMessages({ sessionId: 'sess-rename', branches: [thread] })

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
      await actions.saveChatMessages({ sessionId: 'sess-no-title', branches: [thread] })

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

  describe('session skills', () => {
    beforeEach(async () => {
      const { prisma } = await import('../lib/db')
      await prisma.chatSession.deleteMany()
    })

    it('returns null skills for an unknown session', async () => {
      expect(await actions.getSessionSkills('no-such-session')).toEqual({
        ok: true,
        enabledSkills: null,
      })
    })

    it('persists an explicit skill subset with the thread', async () => {
      const thread = threadFor('skills-a')
      await actions.saveChatMessages({
        sessionId: 'skills-a',
        branches: [thread],
        enabledSkills: ['planning', 'docs'],
      })
      expect(await actions.getSessionSkills('skills-a')).toEqual({
        ok: true,
        enabledSkills: ['planning', 'docs'],
      })
    })

    it('stores an explicit empty list (all skills disabled)', async () => {
      await actions.saveChatMessages({
        sessionId: 'skills-b',
        branches: branchesFor('skills-b'),
        enabledSkills: [],
      })
      expect(await actions.getSessionSkills('skills-b')).toEqual({ ok: true, enabledSkills: [] })
    })

    it('updates an existing session via updateSessionSkills', async () => {
      await actions.saveChatMessages({
        sessionId: 'skills-c',
        branches: branchesFor('skills-c'),
        enabledSkills: ['testing'],
      })
      expect(
        await actions.updateSessionSkills({ sessionId: 'skills-c', enabledSkills: null }),
      ).toEqual({
        ok: true,
      })
      expect(await actions.getSessionSkills('skills-c')).toEqual({ ok: true, enabledSkills: null })
      expect(
        await actions.updateSessionSkills({ sessionId: 'skills-c', enabledSkills: ['docs'] }),
      ).toEqual({
        ok: true,
      })
      expect(await actions.getSessionSkills('skills-c')).toEqual({
        ok: true,
        enabledSkills: ['docs'],
      })
    })

    it('rejects unknown skill ids', async () => {
      expect(
        await actions.updateSessionSkills({ sessionId: 'skills-d', enabledSkills: ['ghost'] }),
      ).toEqual({ ok: false, error: 'Invalid skill ids.' })
      expect(
        await actions.saveChatMessages({
          sessionId: 'skills-d',
          branches: branchesFor('skills-d'),
          enabledSkills: ['ghost'],
        }),
      ).toEqual({ ok: false, error: 'Invalid skill ids.' })
    })

    it('rejects an invalid session id', async () => {
      expect(await actions.getSessionSkills('')).toEqual({
        ok: false,
        error: 'Invalid session id.',
      })
      expect(
        await actions.updateSessionSkills({ sessionId: '', enabledSkills: ['planning'] }),
      ).toEqual({
        ok: false,
        error: 'Invalid session id.',
      })
    })

    it('leaves skills untouched when re-saving a thread without an override', async () => {
      const thread = threadFor('skills-e')
      await actions.saveChatMessages({
        sessionId: 'skills-e',
        branches: [thread],
        enabledSkills: ['planning'],
      })
      await actions.saveChatMessages({ sessionId: 'skills-e', branches: [thread] })
      expect(await actions.getSessionSkills('skills-e')).toEqual({
        ok: true,
        enabledSkills: ['planning'],
      })
    })
  })
})

describe('user preferences (calendar credentials)', () => {
  let prefsActions: typeof import('../app/actions')
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const VALID_KEY = JSON.stringify({
    client_email: 'svc@example.iam.gserviceaccount.com',
    private_key: pem,
  })

  beforeAll(async () => {
    prefsActions = await import('../app/actions')
    // user_preferences has an FK to users — create the test user once.
    const { prisma } = await import('../lib/db')
    await prisma.user.upsert({
      where: { id: 'user-1' },
      create: { id: 'user-1', email: 'user-1@example.com' },
      update: {},
    })
  })

  afterEach(async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null)
    vi.unstubAllGlobals()
    const { prisma } = await import('../lib/db')
    await prisma.userPreference.deleteMany()
  })

  it('requires authentication for preferences', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null)
    expect(await prefsActions.updateUserPreferences({ displayName: 'Anon' })).toEqual({
      ok: false,
      error: 'Not authenticated.',
    })
  })

  it('round-trips profile, presets, calendar credentials, and model tuning', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue('user-1')
    expect(
      await prefsActions.updateUserPreferences({
        displayName: 'Ada',
        apiKey: 'sk-or-123',
        systemPromptPresets: '[{"id":"p1","name":"Expert","prompt":"Be expert"}]',
        googleCalendarId: 'primary',
        googleServiceAccountKey: VALID_KEY,
        preferredModel: 'qwen-3-6',
        temperature: 0.7,
        maxCompletionTokens: 2048,
      }),
    ).toEqual({ ok: true })

    const loaded = await prefsActions.getUserPreferences()
    expect(loaded.ok).toBe(true)
    expect(loaded).toMatchObject({
      ok: true,
      data: {
        displayName: 'Ada',
        apiKey: 'sk-or-123',
        googleCalendarId: 'primary',
        googleServiceAccountKey: VALID_KEY,
        preferredModel: 'qwen-3-6',
        temperature: 0.7,
        maxCompletionTokens: 2048,
      },
    })
    // The effective server default rides along so the settings UI can show it.
    expect(loaded).toMatchObject({ ok: true, data: { defaultMaxCompletionTokens: 4096 } })
  })

  it('surfaces the effective server default max tokens (env-overridable)', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null)
    process.env.MAX_OUTPUT_TOKENS = '8192'
    try {
      expect(await prefsActions.getUserPreferences()).toMatchObject({
        ok: true,
        data: { defaultMaxCompletionTokens: 8192 },
      })
    } finally {
      delete process.env.MAX_OUTPUT_TOKENS
    }
    // Unset env falls back to the built-in conservative default.
    expect(await prefsActions.getUserPreferences()).toMatchObject({
      ok: true,
      data: { defaultMaxCompletionTokens: 4096 },
    })
  })

  it('rejects invalid model tuning values via the zod schema', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue('user-1')
    expect(
      await prefsActions.updateUserPreferences({ temperature: 1.5 } as Parameters<
        typeof prefsActions.updateUserPreferences
      >[0]),
    ).toEqual({ ok: false, error: 'Invalid preferences.' })
    expect(
      await prefsActions.updateUserPreferences({ maxCompletionTokens: -5 } as Parameters<
        typeof prefsActions.updateUserPreferences
      >[0]),
    ).toEqual({ ok: false, error: 'Invalid preferences.' })
    expect(await prefsActions.updateUserPreferences({ preferredModel: 'not-a-model' })).toEqual({
      ok: false,
      error: 'Invalid preferences.',
    })
  })

  it('clears model tuning with explicit null/defaults', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue('user-1')
    await prefsActions.updateUserPreferences({
      preferredModel: 'kimi-k3',
      temperature: 0.2,
      maxCompletionTokens: 1024,
    })
    expect(
      await prefsActions.updateUserPreferences({
        preferredModel: '',
        temperature: 0,
        maxCompletionTokens: 256,
      }),
    ).toEqual({ ok: true })
    const loaded = await prefsActions.getUserPreferences()
    expect(loaded.ok).toBe(true)
    const data = (
      loaded as {
        data: {
          preferredModel: string
          temperature: number | null
          maxCompletionTokens: number | null
        }
      }
    ).data
    expect(data.preferredModel).toBe('')
    expect(data.temperature).toBe(0)
    expect(data.maxCompletionTokens).toBe(256)
  })

  it('rejects a malformed service-account key before persisting anything', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue('user-1')
    const result = await prefsActions.updateUserPreferences({
      displayName: 'Ada',
      googleServiceAccountKey: '{ not json',
    })
    expect(result).toEqual({ ok: false, error: 'Invalid Google service-account key JSON.' })
    const loaded = await prefsActions.getUserPreferences()
    expect(loaded.ok).toBe(true)
    const data = (loaded as { data: { displayName: string; googleServiceAccountKey: string } }).data
    expect(data.displayName).toBe('')
    expect(data.googleServiceAccountKey).toBe('')
  })

  it('clears saved calendar credentials with an empty key', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue('user-1')
    await prefsActions.updateUserPreferences({
      googleCalendarId: 'primary',
      googleServiceAccountKey: VALID_KEY,
    })
    expect(await prefsActions.updateUserPreferences({ googleServiceAccountKey: '' })).toEqual({
      ok: true,
    })
    const loaded = await prefsActions.getUserPreferences()
    expect(loaded.ok).toBe(true)
    const data = (loaded as { data: { googleCalendarId: string; googleServiceAccountKey: string } })
      .data
    expect(data.googleServiceAccountKey).toBe('')
    expect(data.googleCalendarId).toBe('primary')
  })

  it('connection test requires saved credentials', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue('user-1')
    expect(await prefsActions.testGoogleCalendarConnection()).toEqual({
      ok: false,
      error: 'No Google Calendar credentials saved yet.',
    })
  })

  it('connection test reports an invalid stored key', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue('user-1')
    const { prisma } = await import('../lib/db')
    // Bypass the save-time validation by writing the invalid key directly.
    await prisma.userPreference.upsert({
      where: { userId: 'user-1' },
      create: {
        userId: 'user-1',
        googleCalendarId: 'primary',
        googleServiceAccountKey: '{ not json',
      },
      update: {},
    })
    expect(await prefsActions.testGoogleCalendarConnection()).toEqual({
      ok: false,
      error: 'Stored Google service-account key is invalid.',
    })
  })

  it('connection test succeeds against a reachable calendar', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue('user-1')
    await prefsActions.updateUserPreferences({
      googleCalendarId: 'primary',
      googleServiceAccountKey: VALID_KEY,
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'tok-conn' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'primary', summary: 'Sandbox' }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await prefsActions.testGoogleCalendarConnection()
    expect(result).toMatchObject({
      ok: true,
      calendarId: 'primary',
      email: 'svc@example.iam.gserviceaccount.com',
    })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://oauth2.googleapis.com/token')
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary',
    )
  })

  it('connection test explains a calendar access failure', async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue('user-1')
    await prefsActions.updateUserPreferences({
      googleCalendarId: 'primary',
      googleServiceAccountKey: VALID_KEY,
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'tok-conn' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await prefsActions.testGoogleCalendarConnection()
    expect(result.ok).toBe(false)
    expect((result as { error: string }).error).toContain('Calendar access check failed (403)')
  })
})

describe('saveChatMessages session ownership', () => {
  afterEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null)
    delete process.env.AUTH_DISABLED
  })

  it('rejects saving to a session owned by another user', async () => {
    // Engage the ownership check (the suite otherwise runs anonymous).
    const original = process.env.AUTH_DISABLED
    delete process.env.AUTH_DISABLED
    try {
      // user-a creates the session and writes a message.
      vi.mocked(getCurrentUserId).mockResolvedValue('user-a')
      await actions.saveChatMessages({
        sessionId: 'ownership-sess',
        branches: [[{ id: 'own-msg-1', role: 'user', content: "alice's message" }]],
      })

      // user-b must NOT be able to inject messages into that session.
      vi.mocked(getCurrentUserId).mockResolvedValue('user-b')
      const result = await actions.saveChatMessages({
        sessionId: 'ownership-sess',
        branches: [[{ id: 'own-msg-2', role: 'user', content: "bob's injection" }]],
      })
      expect(result).toEqual({ ok: false, error: 'Chat session not found.' })

      // The victim's message is untouched and still readable by its owner.
      vi.mocked(getCurrentUserId).mockResolvedValue('user-a')
      const load = await actions.getChatSession('ownership-sess')
      expect(load.ok).toBe(true)
      if (load.ok) {
        expect(load.branches[0]?.map((message) => message.content)).toEqual(["alice's message"])
      }
    } finally {
      if (original === undefined) delete process.env.AUTH_DISABLED
      else process.env.AUTH_DISABLED = original
      vi.mocked(getCurrentUserId).mockResolvedValue(null)
    }
  })

  it('rejects oversized persistence payloads (zod caps)', async () => {
    const original = process.env.AUTH_DISABLED
    delete process.env.AUTH_DISABLED
    try {
      vi.mocked(getCurrentUserId).mockResolvedValue('user-c')
      const tooManyBranches = Array.from({ length: 65 }, (_, index) => [
        { id: `own-branch-${index}`, role: 'user' as const, content: 'x' },
      ])
      const branchResult = await actions.saveChatMessages({
        sessionId: 'cap-branches',
        branches: tooManyBranches,
      })
      expect(branchResult).toMatchObject({ ok: false })

      const tooLongContent = await actions.saveChatMessages({
        sessionId: 'cap-content',
        branches: [[{ id: 'own-msg-3', role: 'user', content: 'x'.repeat(50_001) }]],
      })
      expect(tooLongContent).toMatchObject({ ok: false })
    } finally {
      if (original === undefined) delete process.env.AUTH_DISABLED
      else process.env.AUTH_DISABLED = original
      vi.mocked(getCurrentUserId).mockResolvedValue(null)
    }
  })
})

describe('data-at-rest field encryption (ENCRYPTION_KEY)', () => {
  let encActions: typeof import('../app/actions')
  // parseGoogleServiceAccountKey only requires non-empty client_email/private_key.
  const ENC_VALID_KEY = JSON.stringify({
    client_email: 'svc@example.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
  })

  beforeAll(async () => {
    encActions = await import('../app/actions')
    // user_preferences has an FK to users — ensure the encryption test user.
    const { prisma } = await import('../lib/db')
    await prisma.user.upsert({
      where: { id: 'user-enc' },
      create: { id: 'user-enc', email: 'enc@example.com' },
      update: {},
    })
  })

  afterEach(async () => {
    delete process.env.ENCRYPTION_KEY
    vi.mocked(getCurrentUserId).mockResolvedValue(null)
    const { prisma } = await import('../lib/db')
    await prisma.userPreference.deleteMany()
  })

  it('encrypts apiKey and the service-account key at rest, and decrypts on read', async () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key'
    vi.mocked(getCurrentUserId).mockResolvedValue('user-enc')
    await encActions.updateUserPreferences({
      apiKey: 'sk-or-secret-123',
      googleCalendarId: 'primary',
      googleServiceAccountKey: ENC_VALID_KEY,
    })

    // The DB row must not contain the plaintext — only v1 envelopes.
    const { prisma } = await import('../lib/db')
    const stored = await prisma.userPreference.findUnique({ where: { userId: 'user-enc' } })
    expect(stored?.apiKey).toMatch(/^v1:/)
    expect(stored?.apiKey).not.toContain('sk-or-secret-123')
    expect(stored?.googleServiceAccountKey).toMatch(/^v1:/)
    expect(stored?.googleServiceAccountKey).not.toContain('PRIVATE KEY')

    // Reads return the plaintext to the caller.
    const loaded = await encActions.getUserPreferences()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.data.apiKey).toBe('sk-or-secret-123')
      expect(loaded.data.googleServiceAccountKey).toBe(ENC_VALID_KEY)
    }
  })

  it('passes legacy plaintext rows through (pre-encryption data)', async () => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key'
    vi.mocked(getCurrentUserId).mockResolvedValue('user-enc')
    // Simulate a row written before encryption existed.
    const { prisma } = await import('../lib/db')
    await prisma.userPreference.upsert({
      where: { userId: 'user-enc' },
      create: {
        userId: 'user-enc',
        apiKey: 'sk-legacy-456',
        googleCalendarId: 'primary',
        googleServiceAccountKey: ENC_VALID_KEY,
      },
      update: {},
    })
    const loaded = await encActions.getUserPreferences()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.data.apiKey).toBe('sk-legacy-456')
      expect(loaded.data.googleServiceAccountKey).toBe(ENC_VALID_KEY)
    }
  })

  it('degrades gracefully when an encrypted row cannot be decrypted (rotated key)', async () => {
    process.env.ENCRYPTION_KEY = 'first-key'
    vi.mocked(getCurrentUserId).mockResolvedValue('user-enc')
    await encActions.updateUserPreferences({
      apiKey: 'sk-rotated',
      googleCalendarId: 'primary',
      googleServiceAccountKey: ENC_VALID_KEY,
    })

    // Rotate the key — the envelopes are now undecryptable.
    process.env.ENCRYPTION_KEY = 'second-key'
    const loaded = await encActions.getUserPreferences()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.data.apiKey).toBe('')
      expect(loaded.data.googleServiceAccountKey).toBe('')
    }
    // The calendar connection test degrades to 'no credentials' too.
    expect(await encActions.testGoogleCalendarConnection()).toEqual({
      ok: false,
      error: 'No Google Calendar credentials saved yet.',
    })
  })
})
