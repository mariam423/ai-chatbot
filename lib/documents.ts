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
  xlsx: {
    extension: '.xlsx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  docx: {
    extension: '.docx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  },
} as const

export type SupportedDocumentExtension = keyof typeof SUPPORTED_DOCUMENTS

export function getDocumentExtension(name: string): SupportedDocumentExtension | null {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
  const match = (Object.keys(SUPPORTED_DOCUMENTS) as SupportedDocumentExtension[]).find(
    (key) => SUPPORTED_DOCUMENTS[key].extension === extension,
  )
  return match ?? null
}

const ZIP_LOCAL_HEADER = 0x04034b50
const ZIP_CENTRAL_HEADER = 0x02014b50
const ZIP_END_HEADER = 0x06054b50

function uint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  )
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code: string) =>
      String.fromCodePoint(
        Number.parseInt(
          code.startsWith('x') ? code.slice(1) : code,
          code.startsWith('x') ? 16 : 10,
        ),
      ),
    )
}

function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  let end = -1
  for (let offset = Math.min(bytes.length - 22, 65_557); offset >= 0; offset -= 1) {
    if (uint32(bytes, offset) === ZIP_END_HEADER) {
      end = offset
      break
    }
  }
  if (end < 0) throw new Error('The archive has no valid ZIP directory.')
  const count = uint16(bytes, end + 10)
  const directoryOffset = uint32(bytes, end + 16)
  const entries = new Map<string, Uint8Array>()
  let cursor = directoryOffset
  for (let index = 0; index < count; index += 1) {
    if (uint32(bytes, cursor) !== ZIP_CENTRAL_HEADER) break
    const method = uint16(bytes, cursor + 10)
    const compressedSize = uint32(bytes, cursor + 20)
    const nameLength = uint16(bytes, cursor + 28)
    const extraLength = uint16(bytes, cursor + 30)
    const commentLength = uint16(bytes, cursor + 32)
    const localOffset = uint32(bytes, cursor + 42)
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength))
    cursor += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/') || compressedSize > MAX_EXTRACTED_TEXT_LENGTH * 4) continue
    if (uint32(bytes, localOffset) !== ZIP_LOCAL_HEADER) continue
    const localNameLength = uint16(bytes, localOffset + 26)
    const localExtraLength = uint16(bytes, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = bytes.slice(dataStart, dataStart + compressedSize)
    try {
      const output =
        method === 0
          ? compressed
          : method === 8
            ? inflateSync(compressed, { maxOutputLength: MAX_EXTRACTED_TEXT_LENGTH })
            : null
      if (output) entries.set(name, output)
    } catch {
      // Ignore one malformed member; the format-specific extractor will
      // report a useful error if its required member is missing.
    }
  }
  return entries
}

function xmlText(xml: string): string {
  return decodeXml(
    xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function extractDocxText(bytes: Uint8Array): string {
  const document = zipEntries(bytes).get('word/document.xml')
  if (!document) throw new Error('The DOCX document body is missing.')
  const xml = new TextDecoder().decode(document)
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((match) =>
    xmlText(match[1]!.replace(/<w:tab\s*\/?>/g, '\\t').replace(/<w:br\s*\/?>/g, '\\n')),
  )
  const text = paragraphs.join('\n').trim()
  if (!text) throw new Error('The DOCX document does not contain extractable text.')
  return text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
}

function extractXlsxText(bytes: Uint8Array): string {
  const entries = zipEntries(bytes)
  const decoder = new TextDecoder()
  const shared = entries.get('xl/sharedStrings.xml')
  const sharedStrings = shared
    ? [...decoder.decode(shared).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) =>
        xmlText(match[1]!),
      )
    : []
  const sheets = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()
  const rows: string[] = []
  for (const sheetName of sheets) {
    const xml = decoder.decode(entries.get(sheetName)!)
    for (const row of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = []
      for (const cell of row[1]!.matchAll(/<c(?:\s[^>]*)?>([\s\S]*?)<\/c>/g)) {
        const body = cell[1]!
        const type = cell[0].match(/\bt="([^"]+)"/)?.[1]
        const raw =
          body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t>([\s\S]*?)<\/t>/)?.[1] ?? ''
        const value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : xmlText(raw)
        cells.push(value)
      }
      if (cells.length > 0) rows.push(cells.join('\t'))
    }
  }
  const text = rows.join('\n').trim()
  if (!text) throw new Error('The XLSX workbook does not contain extractable cell text.')
  return text.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
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
  if (!extension) throw new Error('Only PDF, TXT, MD, CSV, XLSX, and DOCX files are supported.')

  if (extension === 'docx') return sanitizeForPostgres(extractDocxText(bytes))
  if (extension === 'xlsx') return sanitizeForPostgres(extractXlsxText(bytes))
  if (extension !== 'pdf') {
    // TextDecoder with fatal=true rejects malformed/binary payloads early.
    const text = decodeUtf8(bytes)
    if (!text.trim()) throw new Error('The document does not contain any text.')
    return sanitizeForPostgres(text.slice(0, MAX_EXTRACTED_TEXT_LENGTH))
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
  return sanitizeForPostgres(text.slice(0, MAX_EXTRACTED_TEXT_LENGTH))
}

/**
 * Strip characters that PostgreSQL refuses to store in a UTF-8 text column.
 *
 * The only one we actually hit in practice is the NUL byte (0x00) — PDFs
 * occasionally include it inside compressed stream fragments, and DOCX/XLSX
 * can carry it through legacy Office XML. Postgres raises SQLSTATE 22021
 * (`invalid byte sequence for encoding "UTF8": 0x00`) and Prisma surfaces it
 * as a 422 with the raw `prisma.document.create()` invocation in the error
 * message, which is what users were seeing in the upload error toast.
 *
 * The fix is to scrub the NUL byte (and the other control characters in the
 * C0 range that Postgres's text encoding rejects, namely 0x01-0x08 / 0x0B /
 * 0x0C / 0x0E-0x1F) before persistence. We replace each one with a space so
 * adjacent text doesn't merge into garbage; collapsing runs of whitespace
 * back to a single space is left to the chunker.
 */
function sanitizeForPostgres(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
}

/** Split extracted text into overlapping, bounded chunks for retrieval. */
export function chunkDocumentText(text: string): string[] {
  // Defense in depth: callers normally route through extractDocumentText
  // (which already scrubs control bytes), but a future caller could pass
  // raw input straight in. Re-sanitize here so a stray 0x00 can never reach
  // Postgres via the chunk insert.
  const sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
  const normalized = sanitized.replace(/\r\n?/g, '\n').trim()
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
