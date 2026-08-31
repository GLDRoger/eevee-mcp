import { deflateSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { validateOfficeFile } from './office-file-validation'

const u16 = (bytes: Uint8Array, offset: number, value: number): void => {
  new DataView(bytes.buffer).setUint16(offset, value, true)
}

const u32 = (bytes: Uint8Array, offset: number, value: number): void => {
  new DataView(bytes.buffer).setUint32(offset, value, true)
}

const storedZip = (names: readonly string[]): Uint8Array => {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let localOffset = 0
  for (const name of names) {
    const encoded = encoder.encode(name)
    const local = new Uint8Array(30 + encoded.length)
    u32(local, 0, 0x04034b50)
    u16(local, 4, 20)
    u16(local, 26, encoded.length)
    local.set(encoded, 30)
    locals.push(local)
    const entry = new Uint8Array(46 + encoded.length)
    u32(entry, 0, 0x02014b50)
    u16(entry, 4, 20)
    u16(entry, 6, 20)
    u16(entry, 28, encoded.length)
    u32(entry, 42, localOffset)
    entry.set(encoded, 46)
    central.push(entry)
    localOffset += local.length
  }
  const centralSize = central.reduce((total, entry) => total + entry.length, 0)
  const end = new Uint8Array(22)
  u32(end, 0, 0x06054b50)
  u16(end, 8, names.length)
  u16(end, 10, names.length)
  u32(end, 12, centralSize)
  u32(end, 16, localOffset)
  const chunks = [...locals, ...central, end]
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

const deflatedZip = (
  entries: readonly { name: string; content: string; declaredSize?: number }[],
): Uint8Array => {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const central: Uint8Array[] = []
  let localOffset = 0
  for (const { name, content, declaredSize } of entries) {
    const encodedName = encoder.encode(name)
    const encodedContent = encoder.encode(content)
    const compressed = deflateSync(encodedContent)
    const uncompressedSize = declaredSize ?? encodedContent.length
    const local = new Uint8Array(30 + encodedName.length + compressed.length)
    u32(local, 0, 0x04034b50)
    u16(local, 4, 20)
    u16(local, 8, 8)
    u32(local, 18, compressed.length)
    u32(local, 22, uncompressedSize)
    u16(local, 26, encodedName.length)
    local.set(encodedName, 30)
    local.set(compressed, 30 + encodedName.length)
    locals.push(local)

    const entry = new Uint8Array(46 + encodedName.length)
    u32(entry, 0, 0x02014b50)
    u16(entry, 4, 20)
    u16(entry, 6, 20)
    u16(entry, 10, 8)
    u32(entry, 20, compressed.length)
    u32(entry, 24, uncompressedSize)
    u16(entry, 28, encodedName.length)
    u32(entry, 42, localOffset)
    entry.set(encodedName, 46)
    central.push(entry)
    localOffset += local.length
  }
  const centralSize = central.reduce((total, entry) => total + entry.length, 0)
  const end = new Uint8Array(22)
  u32(end, 0, 0x06054b50)
  u16(end, 8, entries.length)
  u16(end, 10, entries.length)
  u32(end, 12, centralSize)
  u32(end, 16, localOffset)
  const chunks = [...locals, ...central, end]
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

describe('office file validation', () => {
  it('accepts structurally identified DOCX, XLSX, PPTX, and PDF bytes', () => {
    expect(validateOfficeFile('brief.docx', storedZip(['[Content_Types].xml', 'word/document.xml'])))
      .toMatchObject({ medium: 'document' })
    expect(validateOfficeFile('model.xlsx', storedZip(['[Content_Types].xml', 'xl/workbook.xml'])))
      .toMatchObject({ medium: 'spreadsheet' })
    expect(validateOfficeFile('compressed.xlsx', deflatedZip([
      { name: '[Content_Types].xml', content: '<Types />' },
      { name: 'xl/workbook.xml', content: '<workbook />' },
    ]))).toMatchObject({ medium: 'spreadsheet' })
    expect(validateOfficeFile('deck.pptx', storedZip(['[Content_Types].xml', 'ppt/presentation.xml'])))
      .toMatchObject({ medium: 'presentation' })
    expect(validateOfficeFile('signed.pdf', new TextEncoder().encode('%PDF-1.7\n%%EOF')))
      .toMatchObject({ medium: 'pdf' })
  })

  it('rejects mismatched containers, macros, traversal, and incomplete PDFs', () => {
    expect(() => validateOfficeFile('wrong.docx', storedZip(['[Content_Types].xml', 'xl/workbook.xml'])))
      .toThrow('word/document.xml')
    expect(() => validateOfficeFile('macro.docx', storedZip([
      '[Content_Types].xml',
      'word/document.xml',
      'word/vbaProject.bin',
    ]))).toThrow('Macro-enabled')
    expect(() => validateOfficeFile('unsafe.xlsx', storedZip([
      '[Content_Types].xml',
      'xl/workbook.xml',
      '../secret.xml',
    ]))).toThrow('unsafe path')
    expect(() => validateOfficeFile('broken.pdf', new TextEncoder().encode('%PDF-1.7')))
      .toThrow('complete PDF')
  })

  it('rejects an entry whose actual inflated bytes exceed its declared size', () => {
    const hostile = deflatedZip([
      { name: '[Content_Types].xml', content: '<Types />' },
      { name: 'xl/workbook.xml', content: 'A'.repeat(2_000_000), declaredSize: 1 },
    ])

    expect(() => validateOfficeFile('hostile.xlsx', hostile)).toThrow(
      'xl/workbook.xml expands beyond its declared uncompressed size',
    )
  })
})
