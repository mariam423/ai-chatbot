'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Speaker01Icon, SquareStopIcon } from '@hugeicons/core-free-icons'
import { useEffect, useRef, useState } from 'react'

interface SpeechButtonProps {
  text: string
}

/** Play assistant text through server TTS when available, otherwise the browser voice. */
export default function SpeechButton({ text }: SpeechButtonProps) {
  const [speaking, setSpeaking] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
    }
  }, [])

  function stop() {
    const audio = audioRef.current
    audio?.pause()
    if (audio?.src.startsWith('blob:')) URL.revokeObjectURL(audio.src)
    audioRef.current = null
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
    setSpeaking(false)
  }

  async function speak() {
    if (!text.trim() || speaking) return
    setSpeaking(true)
    try {
      const response = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
      if (response.ok) {
        const audio = new Audio(URL.createObjectURL(await response.blob()))
        audioRef.current = audio
        audio.onended = () => {
          URL.revokeObjectURL(audio.src)
          audioRef.current = null
          setSpeaking(false)
        }
        audio.onerror = () => {
          URL.revokeObjectURL(audio.src)
          audioRef.current = null
          setSpeaking(false)
        }
        await audio.play()
        return
      }
    } catch {
      // Fall through to the browser's local voice.
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text.trim())
      utterance.onend = () => setSpeaking(false)
      utterance.onerror = () => setSpeaking(false)
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
      return
    }
    setSpeaking(false)
  }

  return (
    <button
      type="button"
      onClick={() => (speaking ? stop() : void speak())}
      disabled={!text.trim()}
      aria-label={speaking ? 'Stop speaking' : 'Read response aloud'}
      aria-pressed={speaking}
      title={speaking ? 'Stop speaking' : 'Read response aloud'}
      className="flex size-7 items-center justify-center rounded-lg text-[var(--text-muted)] opacity-0 transition-all hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)] focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
    >
      <HugeiconsIcon icon={speaking ? SquareStopIcon : Speaker01Icon} size={14} strokeWidth={1.5} />
    </button>
  )
}
