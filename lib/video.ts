export const MAX_VIDEO_BYTES = 50 * 1024 * 1024
export const MAX_VIDEO_FRAMES = 6
export const MAX_FRAME_DATA_URL_LENGTH = 1_200_000

export interface VideoFrame {
  id: string
  timestamp: number
  dataUrl: string
}

function frameTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0]
  return Array.from({ length: MAX_VIDEO_FRAMES }, (_, index) =>
    Math.min(duration, (duration * index) / (MAX_VIDEO_FRAMES - 1)),
  )
}

function waitForSeek(video: HTMLVideoElement, timestamp: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('The video frame could not be decoded.'))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    if (Math.abs(video.currentTime - timestamp) < 0.001) {
      queueMicrotask(onSeeked)
    } else {
      video.currentTime = timestamp
    }
  })
}

/** Decode keyframes locally; raw video bytes never leave the browser. */
export async function extractVideoFrames(file: File): Promise<VideoFrame[]> {
  if (file.size === 0 || file.size > MAX_VIDEO_BYTES) {
    throw new Error('Video is empty or exceeds the 50 MB limit.')
  }
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  if (!['.mp4', '.webm'].includes(extension)) {
    throw new Error('Only MP4 and WebM videos are supported.')
  }

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('The video metadata could not be read.'))
    })
    if (!video.videoWidth || !video.videoHeight) throw new Error('The video has no usable frames.')

    const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Video frame extraction is unavailable in this browser.')

    const frames: VideoFrame[] = []
    for (const timestamp of frameTimes(video.duration)) {
      await waitForSeek(video, timestamp)
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
      if (dataUrl.length > MAX_FRAME_DATA_URL_LENGTH) {
        throw new Error('A video frame is too large to analyze safely.')
      }
      frames.push({
        id: `${file.name}-${timestamp}`,
        timestamp,
        dataUrl,
      })
    }
    return frames
  } finally {
    video.remove()
    URL.revokeObjectURL(url)
  }
}
