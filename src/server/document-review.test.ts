import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { redactDocxBytes, scanDocxBytes } from './document-review'

const REVIEW_CONTEXT = 'test-workspace:test-file:test-version'

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

const repeatedEmailBytes = (): Uint8Array =>
  zipSync({
    '[Content_Types].xml': new TextEncoder().encode(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    ),
    'word/document.xml': new TextEncoder().encode(`
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>First same@example.com then same@example.com</w:t></w:r></w:p></w:body>
      </w:document>
    `),
  })

describe('private document review', () => {
  it('returns only masked findings with stable ids', () => {
    const first = scanDocxBytes(documentBytes(), REVIEW_CONTEXT)
    const second = scanDocxBytes(documentBytes(), REVIEW_CONTEXT)
    expect(first.map(({ type }) => type)).toEqual([
      'email',
      'phone',
      'government-id',
      'payment-card',
    ])
    expect(first).toEqual(second)
    expect(scanDocxBytes(documentBytes(), 'another-version')[0]?.id).not.toBe(first[0]?.id)
    expect(JSON.stringify(first)).not.toContain('alex@example.com')
    expect(JSON.stringify(first)).not.toContain('4111 1111 1111 1111')
  })

  it('removes selected text from the stored DOCX XML', () => {
    const findings = scanDocxBytes(documentBytes(), REVIEW_CONTEXT)
    const selected = findings.filter(({ type }) => type === 'email' || type === 'government-id')
    const redacted = redactDocxBytes(
      documentBytes(),
      selected.map(({ id }) => id),
      REVIEW_CONTEXT,
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
    expect(() => redactDocxBytes(documentBytes(), ['0'.repeat(64)], REVIEW_CONTEXT)).toThrow(
      'One or more selected findings no longer exist',
    )
  })

  it('removes only the selected occurrence when values repeat in one text run', () => {
    const findings = scanDocxBytes(repeatedEmailBytes(), REVIEW_CONTEXT)
    expect(findings).toHaveLength(2)
    expect(findings[0]?.id).not.toBe(findings[1]?.id)

    const redacted = redactDocxBytes(repeatedEmailBytes(), [findings[1]!.id], REVIEW_CONTEXT)
    const xml = new TextDecoder().decode(unzipSync(redacted.bytes)['word/document.xml'])
    expect(xml.match(/same@example\.com/g)).toHaveLength(1)
    expect(xml.indexOf('same@example.com')).toBeLessThan(xml.indexOf('████'))
  })
})
