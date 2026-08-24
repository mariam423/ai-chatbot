import { describe, expect, it } from 'vitest'
import {
  IMAGE_COMPRESS_THRESHOLD_BYTES,
  IMAGE_MAX_DIMENSION,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DATA_URL_LENGTH,
  scaleDimensions,
  shouldCompressImage,
} from '../lib/media-compress'

const MB = 1024 * 1024

describe('media attachment caps', () => {
  it('accepts images and audio up to 20 MB', () => {
    expect(MAX_IMAGE_BYTES).toBe(20 * MB)
    expect(MAX_AUDIO_BYTES).toBe(20 * MB)
  })
})

describe('shouldCompressImage', () => {
  it('compresses raster images over the 5 MB threshold', () => {
    expect(shouldCompressImage('image/jpeg', IMAGE_COMPRESS_THRESHOLD_BYTES + 1, 100)).toBe(true)
    expect(shouldCompressImage('image/png', 8 * MB, 100)).toBe(true)
    expect(shouldCompressImage('image/webp', 6 * MB, 100)).toBe(true)
  })

  it('keeps small images untouched', () => {
    expect(shouldCompressImage('image/jpeg', 4 * MB, 100_000)).toBe(false)
    expect(shouldCompressImage('image/png', 1_000, 1_000)).toBe(false)
  })

  it('compresses when the raw data URL would exceed the payload cap', () => {
    // A huge-dimension PNG can be under 5 MB on disk but produce a data URL
    // far past the payload cap — that must trigger the canvas pass too.
    expect(shouldCompressImage('image/png', 3 * MB, MAX_IMAGE_DATA_URL_LENGTH + 1)).toBe(true)
  })

  it('never compresses animated GIFs (the raw data-URL cap still guards them)', () => {
    expect(shouldCompressImage('image/gif', 12 * MB, 50_000)).toBe(false)
    expect(shouldCompressImage('image/gif', 100, 100)).toBe(false)
  })
})

describe('scaleDimensions', () => {
  it('never upscales small images', () => {
    expect(scaleDimensions(100, 80)).toEqual({ width: 100, height: 80 })
  })

  it('downscales the longest side to the max dimension, preserving aspect', () => {
    expect(scaleDimensions(4000, 2000)).toEqual({ width: IMAGE_MAX_DIMENSION, height: 800 })
    expect(scaleDimensions(1000, 3200)).toEqual({ width: 500, height: IMAGE_MAX_DIMENSION })
  })

  it('rounds to whole pixels and handles degenerate input', () => {
    expect(scaleDimensions(3, 3)).toEqual({ width: 3, height: 3 })
    expect(scaleDimensions(0, 100)).toEqual({ width: 0, height: 0 })
    expect(scaleDimensions(Number.NaN, 100)).toEqual({ width: 0, height: 0 })
  })
})
