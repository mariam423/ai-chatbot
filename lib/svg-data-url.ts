/**
 * Helpers for SVG data URLs produced by the `diagram_render` skill tool
 * (base64 or percent-encoded `data:image/svg+xml` payloads). Browser-safe:
 * used by client components to render, copy, and download rendered diagrams.
 */

/** True when a string is an SVG data URL. */
export function isSvgDataUrl(src: string): boolean {
  return src.startsWith('data:image/svg+xml')
}

/**
 * Decode an SVG data URL into its raw markup. Returns null when the URL is
 * not an SVG data URL, is malformed, or does not decode to an `<svg>` document
 * — callers then fall back to rendering the URL as a plain image.
 */
export function decodeSvgDataUrl(src: string): string | null {
  if (!isSvgDataUrl(src)) return null
  const comma = src.indexOf(',')
  if (comma === -1) return null
  const meta = src.slice(0, comma)
  const payload = src.slice(comma + 1)
  try {
    const text = meta.includes(';base64') ? atob(payload) : decodeURIComponent(payload)
    return /<svg[\s/>]/i.test(text) ? text : null
  } catch {
    return null
  }
}

/** Safe filename for a downloaded SVG, derived from the image alt text. */
export function svgFilename(alt?: string): string {
  const stem = (alt ?? 'diagram')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${stem || 'diagram'}.svg`
}
