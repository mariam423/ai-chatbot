import { beforeEach, describe, expect, it } from 'vitest'
import {
  THREAD_STORAGE_KEY,
  THREAD_STORAGE_VERSION,
  clearThread,
  loadThread,
  normalizeThread,
  saveThread,
} from '../lib/storage'
import type { ChatMessage } from '../lib/types'

// vitest runs in node, so there is no real localStorage or window. Provide an
// in-memory Storage implementation behind a fake window for the module under
// test.
const store = new Map<string, string>()

const storageStub: Storage = {
  get length() {
    return store.size
  },
  clear: () => store.clear(),
  getItem: (key) => store.get(key) ?? null,
  key: (index) => [...store.keys()][index] ?? null,
  removeItem: (key) => {
    store.delete(key)
  },
  setItem: (key, value) => {
    store.set(key, value)
  },
}

beforeEach(() => {
  store.clear()
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: storageStub },
    configurable: true,
  })
})

function storedRaw(): string | null {
  return store.get(THREAD_STORAGE_KEY) ?? null
}

const sample: ChatMessage[] = [
  { id: '1', role: 'user', content: 'Hello' },
  { id: '2', role: 'assistant', content: 'Hi there' },
]

describe('loadThread', () => {
  it('returns an empty thread when nothing is stored', () => {
    expect(loadThread()).toEqual([])
  })

  it('returns an empty thread when window is unavailable (SSR guard)', () => {
    delete (globalThis as { window?: unknown }).window
    store.set(THREAD_STORAGE_KEY, JSON.stringify({ version: 1, messages: sample }))
    expect(loadThread()).toEqual([])
  })

  it('round-trips a saved thread', () => {
    saveThread(sample)
    expect(loadThread()).toEqual(sample)
  })

  it('returns an empty thread for corrupt JSON', () => {
    store.set(THREAD_STORAGE_KEY, '{not json')
    expect(loadThread()).toEqual([])
  })

  it('returns an empty thread for a non-object payload', () => {
    store.set(THREAD_STORAGE_KEY, '"just a string"')
    expect(loadThread()).toEqual([])
  })

  it('migrates a legacy unversioned payload and writes it back in the current format', () => {
    // Pre-versioning format was a bare array of messages.
    store.set(THREAD_STORAGE_KEY, JSON.stringify(sample))
    expect(loadThread()).toEqual(sample)
    expect(JSON.parse(storedRaw()!)).toEqual({
      version: THREAD_STORAGE_VERSION,
      messages: sample,
    })
  })

  it('returns an empty thread for a future storage version', () => {
    store.set(
      THREAD_STORAGE_KEY,
      JSON.stringify({ version: THREAD_STORAGE_VERSION + 1, messages: sample }),
    )
    expect(loadThread()).toEqual([])
  })

  it('returns an empty thread when a message has an invalid role', () => {
    store.set(
      THREAD_STORAGE_KEY,
      JSON.stringify({
        version: THREAD_STORAGE_VERSION,
        messages: [{ id: '1', role: 'system', content: 'nope' }],
      }),
    )
    expect(loadThread()).toEqual([])
  })

  it('returns an empty thread when a message is missing fields', () => {
    store.set(
      THREAD_STORAGE_KEY,
      JSON.stringify({ version: THREAD_STORAGE_VERSION, messages: [{ id: '1' }] }),
    )
    expect(loadThread()).toEqual([])
  })
})

describe('saveThread', () => {
  it('stores a versioned payload', () => {
    saveThread(sample)
    expect(JSON.parse(storedRaw()!)).toEqual({
      version: THREAD_STORAGE_VERSION,
      messages: sample,
    })
  })

  it('tolerates storage failures (private mode, quota)', () => {
    const failing: Storage = {
      ...storageStub,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: failing },
      configurable: true,
    })
    expect(() => saveThread(sample)).not.toThrow()
    expect(loadThread()).toEqual([])
  })
})

describe('normalizeThread', () => {
  it('passes through a current-version payload without migration', () => {
    const payload = { version: THREAD_STORAGE_VERSION, messages: sample }
    expect(normalizeThread(payload)).toEqual({ thread: payload, migrated: false })
  })

  it('migrates a legacy bare-array payload', () => {
    expect(normalizeThread(sample)).toEqual({
      thread: { version: THREAD_STORAGE_VERSION, messages: sample },
      migrated: true,
    })
  })

  it('returns null for corrupt or invalid payloads', () => {
    for (const payload of [
      'nope',
      42,
      null,
      { version: THREAD_STORAGE_VERSION, messages: 'nope' },
      { version: THREAD_STORAGE_VERSION + 1, messages: sample },
      [{ id: '1', role: 'system', content: 'x' }],
      [{ id: '1' }],
    ]) {
      expect(normalizeThread(payload), JSON.stringify(payload)).toBeNull()
    }
  })

  it('leaves invalid legacy data untouched on load', () => {
    store.set(THREAD_STORAGE_KEY, JSON.stringify([{ id: '1', role: 'system', content: 'x' }]))
    expect(loadThread()).toEqual([])
    // Raw data is preserved, not destroyed, so a future migration can retry.
    expect(storedRaw()).toBe(JSON.stringify([{ id: '1', role: 'system', content: 'x' }]))
  })
})

describe('clearThread', () => {
  it('removes the persisted thread', () => {
    saveThread(sample)
    clearThread()
    expect(storedRaw()).toBeNull()
  })
})
