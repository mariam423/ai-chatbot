'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Mic01Icon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'

/** Minimal structural typing for the Web Speech API (not in TS lib.dom). */
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike
}
interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

/** True when this browser exposes the Web Speech recognition API. */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as SpeechRecognitionWindow
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
}

/** True when this browser can record audio for server-side transcription. */
export function isMediaRecorderSupported(): boolean {
  if (typeof window === 'undefined') return false
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

/** Which transcription engine to use, or null when voice input is unavailable. */
export function pickVoiceEngine(opts: {
  speech: boolean
  mediaRecorder: boolean
}): 'speech' | 'record' | null {
  if (opts.speech) return 'speech'
  if (opts.mediaRecorder) return 'record'
  return null
}

/** POST a recorded clip to the server transcription route and return the text. */
async function transcribeAudio(blob: Blob, mimeType: string): Promise<string> {
  const ext =
    mimeType.includes('mp4') || mimeType.includes('m4a')
      ? 'm4a'
      : mimeType.includes('wav')
        ? 'wav'
        : 'webm'
  const form = new FormData()
  form.append('file', new File([blob], `recording.${ext}`, { type: mimeType }))
  form.append('language', navigator.language?.slice(0, 2) || 'en')
  const response = await fetch('/api/transcribe', { method: 'POST', body: form })
  if (!response.ok) throw new Error(`transcribe failed (${response.status})`)
  const data = (await response.json()) as { transcript?: string }
  return data.transcript ?? ''
}

interface AudioInputProps {
  disabled?: boolean
  /** Called with the finalized transcript to insert into the composer. */
  onTranscript: (text: string) => void
}

/**
 * Animated waveform/equalizer for the active voice-composer states.
 *
 * Micro-interaction modes (see micro-interaction-spec):
 *  - recording: lively emerald bars, each with its own stable peak/delay so the
 *    group reads as an organic, voice-reactive waveform; a live red dot.
 *  - transcribing: softer, slower emerald bars signalling "processing" rather
 *    than "capturing"; an amber dot.
 * Bar parameters are derived deterministically from the index and memoized so
 * the pattern stays stable across re-renders. Respects reduced-motion by
 * rendering a static (non-animated) indication.
 */
function WaveformBars({
  mode,
  reducedMotion,
}: {
  mode: 'recording' | 'transcribing'
  reducedMotion: boolean | null
}) {
  const transcribing = mode === 'transcribing'
  const bars = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        // Deterministic pseudo-random per index → stable, varied peaks/delays.
        const seed = ((i * 37 + 13) % 97) / 97
        return {
          peak: 6 + Math.round(seed * 14),
          delay: Number((seed * 0.9).toFixed(2)),
          duration: transcribing ? 1.1 + seed * 0.5 : 0.7 + seed * 0.5,
        }
      }),
    [transcribing],
  )
  const barColor = transcribing ? 'bg-emerald-300' : 'bg-emerald-500'

  return (
    <span aria-hidden="true" className="flex items-end gap-[3px]">
      {bars.map((bar, i) =>
        reducedMotion ? (
          <span
            key={i}
            style={{ height: bar.peak }}
            className={`w-[3px] rounded-full ${barColor}`}
          />
        ) : (
          <motion.span
            key={i}
            className={`w-[3px] rounded-full ${barColor}`}
            animate={{
              height: [
                Math.max(4, bar.peak * 0.4),
                bar.peak,
                Math.max(4, bar.peak * 0.5),
                bar.peak,
              ],
            }}
            transition={{
              duration: bar.duration,
              repeat: Infinity,
              delay: bar.delay,
              ease: 'easeInOut',
            }}
            style={{ height: 4 }}
          />
        ),
      )}
    </span>
  )
}

/**
 * Live speech-to-text mic for the composer.
 *
 * Engine selection (per `pickVoiceEngine`): the browser Web Speech
 * SpeechRecognition API when available (Chrome/Edge, no network), otherwise a
 * MediaRecorder fallback that records a clip and POSTs it to `/api/transcribe`
 * for server-side transcription (works in Firefox/Safari and any browser with
 * the MediaRecorder API). Renders nothing when neither is available. The same
 * animated recording indicator covers both engines; a brief inline error slips
 * back to idle if recording or transcription fails.
 */
export default function AudioInput({ disabled = false, onTranscript }: AudioInputProps) {
  const [listening, setListening] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reducedMotion = useReducedMotion()

  const engine = pickVoiceEngine({
    speech: isSpeechRecognitionSupported(),
    mediaRecorder: isMediaRecorderSupported(),
  })

  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Clean up any in-flight capture on unmount.
  useEffect(() => {
    return () => {
      recRef.current?.stop()
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  // Transient error indicator that auto-clears.
  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), 3000)
    return () => window.clearTimeout(timer)
  }, [error])

  function finishWithError(message: string) {
    setListening(false)
    setTranscribing(false)
    setError(message)
  }

  function startSpeech() {
    const w = window as SpeechRecognitionWindow
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = navigator.language || 'en-US'
    rec.interimResults = false
    rec.continuous = false
    rec.onresult = (event) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += String(event.results[i]?.[0]?.transcript ?? '')
      }
      if (transcript) onTranscript(transcript)
    }
    rec.onerror = () => finishWithError('Voice recognition is unavailable.')
    rec.onend = () => setListening(false)
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
      setError(null)
    } catch {
      finishWithError('Voice recognition could not start.')
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => finishWithError('Recording failed.')
      recorder.onstop = () => void handleStop()
      recorder.start()
      recorderRef.current = recorder
      setListening(true)
      setError(null)
    } catch {
      finishWithError('Microphone access was denied or is unavailable.')
    }
  }

  async function handleStop() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setListening(false)
    const mimeType = recorderRef.current?.mimeType || 'audio/webm'
    recorderRef.current = null
    const blob = new Blob(chunksRef.current, { type: mimeType })
    chunksRef.current = []
    if (blob.size === 0) {
      finishWithError('No audio was captured.')
      return
    }
    setTranscribing(true)
    try {
      const transcript = await transcribeAudio(blob, mimeType)
      if (transcript) onTranscript(transcript)
    } catch {
      finishWithError('Voice transcription failed.')
    } finally {
      setTranscribing(false)
    }
  }

  function toggle() {
    if (transcribing) return
    if (engine === 'speech') {
      if (listening) {
        recRef.current?.stop()
      } else {
        startSpeech()
      }
      return
    }
    if (engine === 'record') {
      if (listening) {
        recorderRef.current?.stop()
      } else {
        void startRecording()
      }
    }
  }

  if (!engine) return null

  const busy = listening || transcribing

  return (
    <div className="relative shrink-0">
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            role="status"
            className="absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-lg px-2.5 py-1 text-[11px] font-medium"
            style={{
              background: 'var(--error-bg)',
              border: '1px solid var(--error-border)',
              color: 'var(--error-text)',
            }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={toggle}
        disabled={disabled}
        whileHover={reducedMotion ? undefined : { scale: 1.05 }}
        whileTap={reducedMotion ? undefined : { scale: 0.95 }}
        aria-label={
          transcribing ? 'Transcribing voice' : listening ? 'Stop voice input' : 'Voice input'
        }
        aria-pressed={listening}
        title={error ?? undefined}
        className="relative rounded-xl p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-30"
      >
        {busy ? (
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1"
          >
            <WaveformBars
              mode={listening ? 'recording' : 'transcribing'}
              reducedMotion={reducedMotion}
            />
            <span className="sr-only">{transcribing ? 'Transcribing…' : 'Listening…'}</span>
          </motion.span>
        ) : (
          <HugeiconsIcon icon={Mic01Icon} size={18} strokeWidth={1.5} />
        )}
        {/* Status dot: live red while recording, amber while processing. */}
        {busy && (
          <motion.span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 flex size-2"
            animate={reducedMotion ? undefined : { scale: [1, 1.6, 1], opacity: [0.9, 0.3, 0.9] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <span
              className={`relative inline-flex size-2 rounded-full ${
                transcribing ? 'bg-amber-400' : 'bg-red-500'
              }`}
            />
          </motion.span>
        )}
      </motion.button>
    </div>
  )
}
