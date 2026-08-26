import { describe, expect, it } from 'vitest'
import { POST } from '../app/api/upload/route'
import { getDocumentExtension, MAX_DOCUMENT_BYTES } from '../lib/documents'
import {
  chunkDocumentText,
  createEmbedding,
  EMBEDDING_DIMENSION,
  extractDocumentText,
} from '../lib/rag'

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

/** Build a tiny stored ZIP fixture; CRC is not needed by the bounded reader. */
function storedZip(entries: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (value: number) => new Uint8Array([value & 255, (value >>> 8) & 255])
  const u32 = (value: number) => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255])
  const join = (...parts: Uint8Array[]) => {
    const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
    let cursor = 0
    for (const part of parts) {
      result.set(part, cursor)
      cursor += part.length
    }
    return result
  }
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(content)
    const local = join(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data)
    chunks.push(local)
    const directory = join(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes)
    central.push(directory)
    offset += local.length
  }
  const centralBytes = join(...central)
  const body = join(...chunks, centralBytes)
  const end = join(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(centralBytes.length), u32(body.length - centralBytes.length), u16(0))
  return join(body, end)
}

describe('document processing', () => {
  it('recognizes only the supported file extensions', () => {
    expect(getDocumentExtension('notes.TXT')).toBe('txt')
    expect(getDocumentExtension('readme.md')).toBe('md')
    expect(getDocumentExtension('rows.csv')).toBe('csv')
    expect(getDocumentExtension('scan.pdf')).toBe('pdf')
    expect(getDocumentExtension('table.xlsx')).toBe('xlsx')
    expect(getDocumentExtension('brief.docx')).toBe('docx')
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

  it('extracts DOCX paragraphs and XLSX cell values without external parsers', () => {
    const docx = storedZip({
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>',
    })
    expect(extractDocumentText('brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docx)).toContain('Hello DOCX\nSecond paragraph')

    const xlsx = storedZip({
      'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Ada</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c></row><row><c t="s"><v>1</v></c><c><v>42</v></c></row></sheetData></worksheet>',
    })
    expect(extractDocumentText('table.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsx)).toContain('Name\nAda\t42')
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
