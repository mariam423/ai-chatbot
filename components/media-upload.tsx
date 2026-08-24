'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, FileAudioIcon, Video01Icon } from '@hugeicons/core-free-icons'
import { useRef, useState } from 'react'
import { extractVideoFrames, type VideoFrame } from '@/lib/video'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_AUDIO_BYTES = 1.5 * 1024 * 1024
const MAX_IMAGE_DATA_URL_LENGTH = 1_200_000
const MAX_AUDIO_DATA_URL_LENGTH = 2_000_000

interface MediaUploadProps {
  frames: VideoFrame[]
  onFramesChange: (frames: VideoFrame[]) => void
  imageDataUrl: string | null
  onImageChange: (dataUrl: string | null) => void
  audioDataUrl: string | null
  onAudioChange: (dataUrl: string | null) => void
  disabled?: boolean
}

function readDataUrl(file: File, maxBytes: number, maxLength: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size === 0 || file.size > maxBytes) {
      reject(
        new Error(`This media file must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`),
      )
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string' || result.length > maxLength) {
        reject(new Error('This media attachment is too large to analyze safely.'))
      } else {
        resolve(result)
      }
    }
    reader.onerror = () => reject(new Error('The media file could not be read.'))
    reader.readAsDataURL(file)
  })
}

export default function MediaUpload({
  frames,
  onFramesChange,
  imageDataUrl,
  onImageChange,
  audioDataUrl,
  onAudioChange,
  disabled = false,
}: MediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
      if (file.type.startsWith('video/') || ['.mp4', '.webm'].includes(extension)) {
        onFramesChange(await extractVideoFrames(file))
      } else if (file.type === 'image/jpeg' || file.type === 'image/png') {
        onImageChange(await readDataUrl(file, MAX_IMAGE_BYTES, MAX_IMAGE_DATA_URL_LENGTH))
      } else if (
        file.type === 'audio/mpeg' ||
        file.type === 'audio/mp3' ||
        file.type === 'audio/wav' ||
        file.type === 'audio/x-wav'
      ) {
        onAudioChange(await readDataUrl(file, MAX_AUDIO_BYTES, MAX_AUDIO_DATA_URL_LENGTH))
      } else {
        throw new Error('Only MP4, WebM, JPEG, PNG, MP3, and WAV files are supported.')
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not process the media.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,image/jpeg,image/png,audio/mpeg,audio/wav,.mp4,.webm,.jpg,.jpeg,.png,.mp3,.wav"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        aria-label="Attach image, audio, or video"
        title="Attach image, audio, or video"
        className="flex size-9 shrink-0 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <HugeiconsIcon icon={Video01Icon} size={18} strokeWidth={1.5} />
      </button>
      {imageDataUrl && (
        <div className="flex items-center gap-1" aria-label="Image attachment">
          <img
            src={imageDataUrl}
            alt="Attached image preview"
            className="size-8 rounded-md object-cover"
          />
          <button
            type="button"
            onClick={() => onImageChange(null)}
            disabled={disabled || busy}
            aria-label="Remove image"
            className="flex size-5 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.5} />
          </button>
        </div>
      )}
      {audioDataUrl && (
        <div
          className="flex items-center gap-1 rounded-lg px-1.5 py-1"
          aria-label="Audio attachment"
        >
          <HugeiconsIcon
            icon={FileAudioIcon}
            size={14}
            strokeWidth={1.5}
            className="text-emerald-500"
          />
          <span className="text-[11px] text-[var(--text-tertiary)]">Audio</span>
          <button
            type="button"
            onClick={() => onAudioChange(null)}
            disabled={disabled || busy}
            aria-label="Remove audio"
            className="flex size-5 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.5} />
          </button>
        </div>
      )}
      {frames.length > 0 && (
        <div className="flex items-center gap-1" aria-label="Video frames">
          <img
            src={frames[0]!.dataUrl}
            alt={`Video frame at ${Math.round(frames[0]!.timestamp)} seconds`}
            className="size-8 rounded-md object-cover"
          />
          <span className="text-[11px] text-[var(--text-tertiary)]">{frames.length} frames</span>
          <button
            type="button"
            onClick={() => onFramesChange([])}
            disabled={disabled || busy}
            aria-label="Remove video"
            className="flex size-5 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.5} />
          </button>
        </div>
      )}
      {busy && <span className="text-xs text-[var(--text-tertiary)]">Processing media...</span>}
      {error && (
        <p role="alert" className="max-w-48 truncate text-xs text-[var(--error-text)]">
          {error}
        </p>
      )}
    </div>
  )
}
