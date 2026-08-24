import { describe, expect, it } from 'vitest'
import { POST } from '../app/api/upload/route'
import {
  chunkDocumentText,
  extractDocumentText,
  getDocumentExtension,
  MAX_DOCUMENT_BYTES,
} from '../lib/documents'
import { createEmbedding, EMBEDDING_DIMENSION } from '../lib/rag'

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

describe('document processing', () => {
  it('recognizes only the supported file extensions', () => {
    expect(getDocumentExtension('notes.TXT')).toBe('txt')
    expect(getDocumentExtension('readme.md')).toBe('md')
    expect(getDocumentExtension('rows.csv')).toBe('csv')
    expect(getDocumentExtension('scan.pdf')).toBe('pdf')
    expect(getDocumentExtension('script.exe')).toBeNull()
  })

  it('extracts UTF-8 text and rejects empty or malformed text files', () => {
    expect(extractDocumentText('notes.txt', 'text/plain', bytes('hello\nworld'))).toBe(
      'hello\nworld',
    )
    expect(() => extractDocumentText('empty.txt', 'text/plain', bytes('   '))).toThrow(
      'does not contain any text',
    )
    expect(() =>
      extractDocumentText('binary.txt', 'text/plain', new Uint8Array([0xff, 0xfe, 0x00])),
    ).toThrow()
  })

  it('extracts text operators from a small uncompressed PDF', () => {
    const pdf = '%PDF-1.4\n1 0 obj\n<< /Length 42 >>\nstream\n(Hello PDF) Tj\nendstream\nendobj\n'
    expect(extractDocumentText('sample.pdf', 'application/pdf', bytes(pdf))).toContain('Hello PDF')
  })

  it('creates bounded overlapping chunks', () => {
    const text = `${'a'.repeat(1_500)}\n${'b'.repeat(1_500)}`
    const chunks = chunkDocumentText(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 1_600)).toBe(true)
    expect(chunks[1]).toContain('a')
  })

  it('creates deterministic normalized embeddings', () => {
    const first = createEmbedding('A document about retrieval')
    const second = createEmbedding('A document about retrieval')
    expect(first).toEqual(second)
    expect(first).toHaveLength(EMBEDDING_DIMENSION)
    expect(Math.hypot(...first)).toBeCloseTo(1)
  })
})

describe('POST /api/upload boundary', () => {
  it('rejects non-multipart requests without touching persistence', async () => {
    const response = await POST(new Request('http://localhost/api/upload', { method: 'POST' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Upload must be sent as multipart form data.' })
  })

  it('rejects an unsupported extension before session lookup', async () => {
    const form = new FormData()
    form.set('sessionId', 'session-1')
    form.set('file', new File(['malware'], 'payload.exe', { type: 'application/octet-stream' }))
    const response = await POST(
      new Request('http://localhost/api/upload', { method: 'POST', body: form }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('Only PDF')
  })

  it('rejects a document over the 20 MB limit with a 413', async () => {
    const form = new FormData()
    form.set('sessionId', 'session-1')
    form.set(
      'file',
      new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], 'huge.csv', { type: 'text/csv' }),
    )
    const response = await POST(
      new Request('http://localhost/api/upload', { method: 'POST', body: form }),
    )
    expect(response.status).toBe(413)
    expect((await response.json()).error).toContain('20 MB')
  })
})
