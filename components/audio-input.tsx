'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Mic01Icon } from '@hugeicons/core-free-icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

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

interface AudioInputProps {
  disabled?: boolean
  /** Called with the finalized transcript to insert into the composer. */
  onTranscript: (text: string) => void
}

/**
 * Live speech-to-text mic for the composer. Uses the browser's SpeechRecognition
 * (Chrome/Edge); browsers without it render nothing. While listening, a pulsing
 * recording indicator animates in place of the idle mic icon.
 */
export default function AudioInput({ disabled = false, onTranscript }: AudioInputProps) {
  const [listening, setListening] = useState(false)
  const supported = isSpeechRecognitionSupported()
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const reducedMotion = useReducedMotion()

  // Clean up any in-flight recognition on unmount.
  useEffect(() => {
    return () => {
      recRef.current?.stop()
    }
  }, [])

  function toggle() {
    if (listening) {
      recRef.current?.stop()
      return
    }
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
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  if (!supported) return null

  return (
    <motion.button
      type="button"
      onClick={toggle}
      disabled={disabled}
      whileHover={reducedMotion ? undefined : { scale: 1.05 }}
      whileTap={reducedMotion ? undefined : { scale: 0.95 }}
      aria-label={listening ? 'Stop voice input' : 'Voice input'}
      aria-pressed={listening}
      className="relative shrink-0 rounded-xl p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-30"
    >
      {listening ? (
        <span className="flex items-center gap-1">
          {/* Dynamic recording indicator — animated equalizer bars. */}
          {[0, 1, 2, 3].map((i) => (
            <motion.span
              key={i}
              className="inline-block w-0.5 rounded-full bg-cyan-500"
              animate={{ height: [6, 16, 8, 18, 6] }}
              transition={{
                duration: 0.9,
                repeat: Infinity,
                delay: i * 0.12,
                ease: 'easeInOut',
              }}
              style={{ height: 6 }}
            />
          ))}
          <span className="sr-only">Listening…</span>
        </span>
      ) : (
        <HugeiconsIcon icon={Mic01Icon} size={18} strokeWidth={1.5} />
      )}
      {/* Pulsing dot to signal an active recording session. */}
      {listening && !reducedMotion && (
        <span className="absolute -top-0.5 -right-0.5 flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-red-500" />
        </span>
      )}
    </motion.button>
  )
}
