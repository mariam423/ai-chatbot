import { describe, expect, it } from 'vitest'
import { decodeSvgDataUrl, isSvgDataUrl, svgFilename } from '../lib/svg-data-url'

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'

describe('isSvgDataUrl', () => {
  it('recognizes SVG data URLs', () => {
    expect(isSvgDataUrl(`data:image/svg+xml;base64,${btoa(SVG)}`)).toBe(true)
    expect(isSvgDataUrl(`data:image/svg+xml,${encodeURIComponent(SVG)}`)).toBe(true)
    expect(isSvgDataUrl('https://example.com/diagram.svg')).toBe(false)
    expect(isSvgDataUrl('data:image/png;base64,AAAA')).toBe(false)
  })
})

describe('decodeSvgDataUrl', () => {
  it('decodes a base64 SVG data URL', () => {
    expect(decodeSvgDataUrl(`data:image/svg+xml;base64,${btoa(SVG)}`)).toBe(SVG)
  })

  it('decodes a percent-encoded SVG data URL', () => {
    expect(decodeSvgDataUrl(`data:image/svg+xml,${encodeURIComponent(SVG)}`)).toBe(SVG)
  })

  it('returns null for non-SVG, malformed, or non-SVG payloads', () => {
    expect(decodeSvgDataUrl('https://example.com/diagram.svg')).toBeNull()
    expect(decodeSvgDataUrl('data:image/svg+xml;base64')).toBeNull()
    expect(decodeSvgDataUrl('data:image/svg+xml;base64,not-valid-base64!!!')).toBeNull()
    expect(decodeSvgDataUrl('data:image/svg+xml;base64,' + btoa('hello'))).toBeNull()
    expect(decodeSvgDataUrl('data:image/png;base64,' + btoa(SVG))).toBeNull()
  })
})

describe('svgFilename', () => {
  it('derives a slug from the alt text and falls back to diagram', () => {
    expect(svgFilename('Auth flow')).toBe('auth-flow.svg')
    expect(svgFilename('  Architecture  Overview  ')).toBe('architecture-overview.svg')
    expect(svgFilename('')).toBe('diagram.svg')
    expect(svgFilename('!!!')).toBe('diagram.svg')
    expect(svgFilename(undefined)).toBe('diagram.svg')
  })
})
