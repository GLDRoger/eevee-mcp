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

const contentTypes = new TextEncoder().encode(
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
)

const hyperlinkedBytes = (extraParts: Record<string, string> = {}): Uint8Array =>
  zipSync({
    '[Content_Types].xml': contentTypes,
    'word/document.xml': new TextEncoder().encode(`
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <w:body><w:p><w:hyperlink r:id="rId1"><w:r><w:t>alex@example.com</w:t></w:r></w:hyperlink></w:p>
        <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>
        <w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:alex@example.com" </w:instrText></w:r>
        <w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
        <w:p><w:del><w:r><w:delText>Old alex@example.com</w:delText></w:r></w:del></w:p></w:body>
      </w:document>
    `),
    'word/_rels/document.xml.rels': new TextEncoder().encode(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:alex@example.com?subject=Hi" TargetMode="External"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    ),
    'docProps/core.xml': new TextEncoder().encode(
      '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        '<dc:creator>alex@example.com</dc:creator><cp:lastModifiedBy>alex@example.com</cp:lastModifiedBy></cp:coreProperties>',
    ),
    ...Object.fromEntries(
      Object.entries(extraParts).map(([path, xml]) => [path, new TextEncoder().encode(xml)]),
    ),
  })

const partText = (bytes: Uint8Array, path: string): string =>
  new TextDecoder().decode(unzipSync(bytes)[path])

describe('private document review', () => {
  it('tolerates invalid numeric entities inside text runs', () => {
    const bytes = zipSync({
      '[Content_Types].xml': contentTypes,
      'word/document.xml': new TextEncoder().encode(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          '<w:body><w:p><w:r><w:t>&#1114112; alex@example.com</w:t></w:r></w:p></w:body></w:document>',
      ),
    })
    expect(scanDocxBytes(bytes, REVIEW_CONTEXT).map(({ type }) => type)).toEqual(['email'])
  })

  it('removes selected values from hyperlink targets, field codes, tracked deletions, and properties', () => {
    const findings = scanDocxBytes(hyperlinkedBytes(), REVIEW_CONTEXT)
    expect(findings.map(({ type, part }) => [type, part])).toEqual([['email', 'Document body']])

    const redacted = redactDocxBytes(hyperlinkedBytes(), [findings[0]!.id], REVIEW_CONTEXT)
    const document = partText(redacted.bytes, 'word/document.xml')
    expect(document).not.toContain('alex@example.com')
    expect(document).toContain('<w:instrText xml:space="preserve"> HYPERLINK &quot;mailto:██████&quot; </w:instrText>')
    expect(document).toContain('<w:delText>Old ██████</w:delText>')

    const rels = partText(redacted.bytes, 'word/_rels/document.xml.rels')
    expect(rels).not.toContain('alex@example.com')
    expect(rels).toContain('Target="mailto:?subject=Hi" TargetMode="External"')
    expect(rels).toContain('Target="styles.xml"')

    const core = partText(redacted.bytes, 'docProps/core.xml')
    expect(core).not.toContain('alex@example.com')
    expect(core).toContain('<dc:creator>██████</dc:creator>')
  })

  it('refuses to save when a selected value survives in an unreviewed part', () => {
    const bytes = hyperlinkedBytes({
      'word/glossary/document.xml':
        '<w:glossaryDocument xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:p><w:r><w:t>alex@example.com</w:t></w:r></w:p></w:glossaryDocument>',
    })
    const findings = scanDocxBytes(bytes, REVIEW_CONTEXT)
    expect(() => redactDocxBytes(bytes, [findings[0]!.id], REVIEW_CONTEXT)).toThrowError(
      expect.objectContaining({
        status: 409,
        code: 'redaction_incomplete',
        message: expect.stringContaining('word/glossary/document.xml'),
      }),
    )
  })

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

  it('finds and removes a value that Word split across formatting runs', () => {
    const bytes = zipSync({
      '[Content_Types].xml': new TextEncoder().encode(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
      ),
      'word/document.xml': new TextEncoder().encode(`
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t xml:space="preserve">Write to jane.doe@</w:t></w:r><w:proofErr w:type="spellEnd"/><w:r><w:rPr><w:b/></w:rPr><w:t>example.com</w:t></w:r><w:r><w:t xml:space="preserve"> today</w:t></w:r></w:p></w:body>
        </w:document>
      `),
    })
    const findings = scanDocxBytes(bytes, REVIEW_CONTEXT)
    expect(findings.map(({ type }) => type)).toEqual(['email'])

    const redacted = redactDocxBytes(bytes, [findings[0]!.id], REVIEW_CONTEXT)
    const xml = partText(redacted.bytes, 'word/document.xml')
    expect(xml).not.toContain('jane.doe')
    expect(xml).not.toContain('example.com')
    expect(xml.match(/████/g)).toHaveLength(1)
    expect(xml).toContain('<w:t xml:space="preserve">Write to ██████</w:t>')
    expect(xml).toContain('<w:rPr><w:b/></w:rPr><w:t></w:t>')
    expect(xml).toContain('<w:t xml:space="preserve"> today</w:t>')
  })

  it('scans paragraphs nested in text boxes without losing the outer paragraph tail', () => {
    const bytes = zipSync({
      '[Content_Types].xml': new TextEncoder().encode(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
      ),
      'word/document.xml': new TextEncoder().encode(`
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body><w:p><w:r><w:t>Outer outer@example.com</w:t></w:r><w:r><w:txbxContent><w:p><w:r><w:t>Inner inner@example.com</w:t></w:r></w:p></w:txbxContent></w:r><w:r><w:t>Tail tail@example.com</w:t></w:r></w:p></w:body>
        </w:document>
      `),
    })
    const findings = scanDocxBytes(bytes, REVIEW_CONTEXT)
    expect(findings.map(({ masked }) => masked.startsWith('o') || masked.startsWith('i') || masked.startsWith('t'))).toEqual([true, true, true])

    const redacted = redactDocxBytes(bytes, findings.map(({ id }) => id), REVIEW_CONTEXT)
    const xml = partText(redacted.bytes, 'word/document.xml')
    expect(xml).not.toContain('@example.com')
    expect(xml.match(/████/g)).toHaveLength(3)
  })
})
