import { describe, expect, it } from 'vitest'
import { pickVoiceEngine } from '../components/audio-input'

describe('pickVoiceEngine', () => {
  it('prefers the browser Web Speech API when supported', () => {
    expect(pickVoiceEngine({ speech: true, mediaRecorder: true })).toBe('speech')
    expect(pickVoiceEngine({ speech: true, mediaRecorder: false })).toBe('speech')
  })

  it('falls back to MediaRecorder (server transcription) when speech is unavailable', () => {
    expect(pickVoiceEngine({ speech: false, mediaRecorder: true })).toBe('record')
  })

  it('returns null when neither transcription path is available', () => {
    expect(pickVoiceEngine({ speech: false, mediaRecorder: false })).toBeNull()
  })
})
