import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserPreference } from '../generated/client'

// Mock the DB so getUserSkillContext never touches a real connection.
const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }))
vi.mock('../lib/db', () => ({
  prisma: { userPreference: { findUnique: findUniqueMock } },
}))

import { getUserSkillContext } from '../lib/skills/credentials'

afterEach(() => {
  vi.clearAllMocks()
})

const VALID_KEY = JSON.stringify({
  client_email: 'svc@example.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
})

function pref(overrides: Partial<UserPreference> = {}): UserPreference {
  return {
    id: 'pref-1',
    userId: 'user-1',
    displayName: null,
    avatarUrl: null,
    apiKey: null,
    systemPromptPresets: '[]',
    googleCalendarId: null,
    googleServiceAccountKey: null,
    preferredModel: null,
    temperature: null,
    maxCompletionTokens: null,
    ...overrides,
  }
}

describe('getUserSkillContext', () => {
  it('returns an empty context when auth is disabled (no user id)', async () => {
    expect(await getUserSkillContext(null)).toEqual({})
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('returns an empty context when the user has no preferences', async () => {
    findUniqueMock.mockResolvedValue(null)
    expect(await getUserSkillContext('user-1')).toEqual({})
  })

  it('resolves stored service-account credentials into a tool context', async () => {
    findUniqueMock.mockResolvedValue(
      pref({ googleCalendarId: 'primary', googleServiceAccountKey: VALID_KEY }),
    )
    expect(await getUserSkillContext('user-1')).toEqual({
      googleCalendar: {
        calendarId: 'primary',
        email: 'svc@example.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
      },
    })
  })

  it('ignores a missing calendar id or an unparseable stored key', async () => {
    findUniqueMock.mockResolvedValue(pref({ googleServiceAccountKey: VALID_KEY }))
    expect(await getUserSkillContext('user-1')).toEqual({})

    findUniqueMock.mockResolvedValue(
      pref({ googleCalendarId: 'primary', googleServiceAccountKey: 'not-json' }),
    )
    expect(await getUserSkillContext('user-1')).toEqual({})
  })

  it('degrades to an empty context when the DB query throws', async () => {
    findUniqueMock.mockRejectedValue(new Error('db down'))
    expect(await getUserSkillContext('user-1')).toEqual({})
  })

  it('decrypts an encrypted stored service-account key before parsing', async () => {
    process.env.ENCRYPTION_KEY = 'cred-test-key'
    try {
      const { encryptField } = await import('../lib/field-encryption')
      findUniqueMock.mockResolvedValue(
        pref({ googleCalendarId: 'primary', googleServiceAccountKey: encryptField(VALID_KEY) }),
      )
      expect(await getUserSkillContext('user-1')).toEqual({
        googleCalendar: {
          calendarId: 'primary',
          email: 'svc@example.iam.gserviceaccount.com',
          privateKey: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
        },
      })
    } finally {
      delete process.env.ENCRYPTION_KEY
    }
  })

  it('ignores a stored key that cannot be decrypted (wrong key)', async () => {
    process.env.ENCRYPTION_KEY = 'encrypt-key'
    const { encryptField } = await import('../lib/field-encryption')
    const envelope = encryptField(VALID_KEY)
    process.env.ENCRYPTION_KEY = 'different-key'
    try {
      findUniqueMock.mockResolvedValue(
        pref({ googleCalendarId: 'primary', googleServiceAccountKey: envelope }),
      )
      expect(await getUserSkillContext('user-1')).toEqual({})
    } finally {
      delete process.env.ENCRYPTION_KEY
    }
  })
})
