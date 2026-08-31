import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { redactDocxBytes, scanDocxBytes } from './document-review'

const documentBytes = (): Uint8Array =>
  zipSync({
    '[Content_Types].xml': new TextEncoder().encode(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    ),
    'word/document.xml': new TextEncoder().encode(`
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>Email alex@example.com</w:t></w:r></w:p>
        <w:p><w:r><w:t>Phone +1 415-555-0123</w:t></w:r></w:p>
        <w:p><w:r><w:t>SSN 123-45-6789</w:t></w:r></w:p>
        <w:p><w:r><w:t>Card 4111 1111 1111 1111</w:t></w:r></w:p></w:body>
      </w:document>
    `),
  })

describe('private document review', () => {
  it('returns only masked findings with stable ids', () => {
    const first = scanDocxBytes(documentBytes())
    const second = scanDocxBytes(documentBytes())
    expect(first.map(({ type }) => type)).toEqual([
      'email',
      'phone',
      'government-id',
      'payment-card',
    ])
    expect(first).toEqual(second)
    expect(JSON.stringify(first)).not.toContain('alex@example.com')
    expect(JSON.stringify(first)).not.toContain('4111 1111 1111 1111')
  })

  it('removes selected text from the stored DOCX XML', () => {
    const findings = scanDocxBytes(documentBytes())
    const selected = findings.filter(({ type }) => type === 'email' || type === 'government-id')
    const redacted = redactDocxBytes(
      documentBytes(),
      selected.map(({ id }) => id),
    )
    expect(redacted.redactedCount).toBe(2)
    const xml = new TextDecoder().decode(unzipSync(redacted.bytes)['word/document.xml'])
    expect(xml).not.toContain('alex@example.com')
    expect(xml).not.toContain('123-45-6789')
    expect(xml).toContain('+1 415-555-0123')
    expect(xml).toContain('4111 1111 1111 1111')
    expect(xml).toContain('████')
  })

  it('rejects stale finding ids', () => {
    expect(() => redactDocxBytes(documentBytes(), ['0'.repeat(64)])).toThrow(
      'One or more selected findings no longer exist',
    )
  })
})
