/**
 * Browser-safe helpers for the composer's media attachments: the 20 MB file
 * caps, the client-side image compression pipeline (HTML5 Canvas), and the
 * pure decision helpers so the limits are testable without a DOM.
 *
 * Design notes:
 * - Images and audio are accepted up to 20 MB at the picker, but the payload
 *   actually sent to the LLM is bounded separately (see the Zod schemas in
 *   lib/types.ts, which mirror these caps). Images larger than 5 MB — or that
 *   would still exceed the data-URL cap, e.g. huge dimensions stored very
 *   efficiently — are re-encoded through a canvas at a bounded dimension, so
 *   vision models receive an optimal size and the chat request body stays
 *   small. Audio has no lossless client-side shrink path (and the provider's
 *   `input_audio` accepts wav/mp3), so it rides the data-URL cap directly.
 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024
/** Images above this size are automatically re-encoded through a canvas. */
export const IMAGE_COMPRESS_THRESHOLD_BYTES = 5 * 1024 * 1024
/** Longest side of the canvas output; vision models never need more. */
export const IMAGE_MAX_DIMENSION = 1600
export const IMAGE_COMPRESS_QUALITY = 0.8
/** Longest image data URL the chat route accepts (mirrors ImageDataUrlSchema). */
export const MAX_IMAGE_DATA_URL_LENGTH = 1_200_000
/** Longest audio data URL the chat route accepts (mirrors AudioDataUrlSchema). */
export const MAX_AUDIO_DATA_URL_LENGTH = 4_000_000

/**
 * Whether an image needs the canvas compression pass: any non-GIF file over
 * the 5 MB threshold, or whose raw data URL would already exceed the payload
 * cap (large dimensions that compress well on disk). Animated GIFs are always
 * kept intact — flattening them to a canvas would destroy the animation — and
 * instead ride the raw data-URL cap.
 */
export function shouldCompressImage(
  type: string,
  fileSize: number,
  dataUrlLength: number,
): boolean {
  if (type === 'image/gif') return false
  return fileSize > IMAGE_COMPRESS_THRESHOLD_BYTES || dataUrlLength > MAX_IMAGE_DATA_URL_LENGTH
}

/** Downscale keeping aspect ratio; never upscales. Degenerate input → zeros. */
export function scaleDimensions(
  width: number,
  height: number,
  maxDimension: number = IMAGE_MAX_DIMENSION,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 }
  }
  const scale = Math.min(1, maxDimension / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The image could not be decoded for compression.'))
    image.src = dataUrl
  })
}

/**
 * Re-encode an image data URL through a canvas, downscaled to
 * IMAGE_MAX_DIMENSION and exported as JPEG. On any failure (undecodable
 * image, no canvas support) it returns the original data URL unchanged — the
 * caller's length check is the final guard.
 */
export async function compressImageDataUrl(dataUrl: string): Promise<string> {
  let image: HTMLImageElement
  try {
    image = await loadImage(dataUrl)
  } catch {
    return dataUrl
  }
  const { width, height } = scaleDimensions(image.naturalWidth, image.naturalHeight)
  if (width === 0 || height === 0) return dataUrl
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return dataUrl
  // Flatten transparency onto white so the JPEG export has no black holes.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', IMAGE_COMPRESS_QUALITY)
}
