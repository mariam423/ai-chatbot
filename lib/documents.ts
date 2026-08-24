import { inflateSync } from 'node:zlib'

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
export const MAX_EXTRACTED_TEXT_LENGTH = 1_000_000
export const MAX_DOCUMENT_CHUNKS = 500
export const CHUNK_SIZE = 1_600
export const CHUNK_OVERLAP = 200

export const SUPPORTED_DOCUMENTS = {
  pdf: { extension: '.pdf', mimeTypes: ['application/pdf'] },
  txt: { extension: '.txt', mimeTypes: ['text/plain'] },
  md: { extension: '.md', mimeTypes: ['text/markdown', 'text/plain'] },
  csv: { extension: '.csv', mimeTypes: ['text/csv', 'text/plain', 'application/vnd.ms-excel'] },
} as const

export type SupportedDocumentExtension = keyof typeof SUPPORTED_DOCUMENTS

export function getDocumentExtension(name: string): SupportedDocumentExtension | null {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
  const match = (Object.keys(SUPPORTED_DOCUMENTS) as SupportedDocumentExtension[]).find(
    (key) => SUPPORTED_DOCUMENTS[key].extension === extension,
  )
  return match ?? null
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\0', '')
}

function decodePdfLiteral(value: string): string {
  return value.replace(/\\([\\()nrtbf]|[0-7]{1,3})/g, (_, escaped: string) => {
    const escapes: Record<string, string> = {
      '\\': '\\',
      '(': '(',
      ')': ')',
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
    }
    if (escaped in escapes) return escapes[escaped]!
    return String.fromCharCode(parseInt(escaped, 8))
  })
}

function extractPdfStrings(source: string): string[] {
  const strings: string[] = []
  const literalPattern = /\(((?:\\.|[^()\\])*)\)/g
  let match: RegExpExecArray | null
  while ((match = literalPattern.exec(source)) !== null) {
    const after = source.slice(literalPattern.lastIndex).match(/^\s*(?:\]|Tj|TJ)/)
    if (after) strings.push(decodePdfLiteral(match[1]!))
  }
  return strings
}

function pdfStreamBytes(pdf: Uint8Array): Array<{ bytes: Uint8Array; compressed: boolean }> {
  const source = new TextDecoder('latin1').decode(pdf)
  const streams: Array<{ bytes: Uint8Array; compressed: boolean }> = []
  let cursor = 0
  while (cursor < source.length) {
    const startMarker = source.indexOf('stream', cursor)
    if (startMarker < 0) break
    const endMarker = source.indexOf('endstream', startMarker + 6)
    if (endMarker < 0) break
    let start = startMarker + 6
    if (source[start] === '\r' && source[start + 1] === '\n') start += 2
    else if (source[start] === '\n' || source[start] === '\r') start += 1
    const header = source.slice(Math.max(0, startMarker - 300), startMarker)
    const raw = pdf.slice(start, endMarker).filter((_, index, bytes) => {
      if (index === bytes.length - 1 && bytes[index] === 10) return false
      if (index === bytes.length - 2 && bytes[index] === 13 && bytes[index + 1] === 10) return false
      return true
    })
    streams.push({ bytes: raw, compressed: header.includes('/FlateDecode') })
    cursor = endMarker + 9
  }
  return streams
}

/** Extract text without trusting the file's declared MIME type or executing it. */
export function extractDocumentText(name: string, mimeType: string, bytes: Uint8Array): string {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error('Document is empty or exceeds the 20 MB limit.')
  }
  const extension = getDocumentExtension(name)
  if (!extension) throw new Error('Only PDF, TXT, MD, and CSV files are supported.')

  if (extension !== 'pdf') {
    // TextDecoder with fatal=true rejects malformed/binary payloads early.
    const text = decodeUtf8(bytes)
    if (!text.trim()) throw new Error('The document does not contain any text.')
    return text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
  }

  if (mimeType && mimeType !== 'application/pdf') {
    throw new Error('The PDF MIME type is invalid.')
  }
  const header = new TextDecoder('latin1').decode(bytes.slice(0, 5))
  if (header !== '%PDF-') throw new Error('The uploaded file is not a valid PDF.')

  const streams = pdfStreamBytes(bytes)
  const candidates = streams.flatMap(({ bytes: stream, compressed }) => {
    try {
      const decoded = compressed
        ? inflateSync(stream, { maxOutputLength: MAX_EXTRACTED_TEXT_LENGTH })
        : stream
      return extractPdfStrings(new TextDecoder('latin1').decode(decoded))
    } catch {
      return []
    }
  })
  if (candidates.length === 0) {
    // Uncompressed PDFs sometimes place text outside a stream.
    candidates.push(...extractPdfStrings(new TextDecoder('latin1').decode(bytes)))
  }
  const text = candidates.join(' ').replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('The PDF does not contain extractable text.')
  return text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
}

/** Split extracted text into overlapping, bounded chunks for retrieval. */
export function chunkDocumentText(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  const chunks: string[] = []
  let start = 0
  while (start < normalized.length && chunks.length < MAX_DOCUMENT_CHUNKS) {
    const maxEnd = Math.min(start + CHUNK_SIZE, normalized.length)
    let end = maxEnd
    if (maxEnd < normalized.length) {
      const boundary = normalized.lastIndexOf('\n', maxEnd)
      const sentence = normalized.lastIndexOf('. ', maxEnd)
      const preferred = Math.max(boundary, sentence)
      if (preferred > start + CHUNK_SIZE / 2) end = preferred + (preferred === sentence ? 1 : 0)
    }
    const chunk = normalized.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= normalized.length) break
    start = Math.max(start + 1, end - CHUNK_OVERLAP)
  }
  return chunks
}
