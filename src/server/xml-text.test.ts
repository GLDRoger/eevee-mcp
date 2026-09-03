import { describe, expect, it } from 'vitest'
import { decodeXmlText } from './xml-text'

describe('decodeXmlText', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeXmlText('a &lt;b&gt; &quot;c&quot; &apos;d&apos; &#65;&#x42; &amp;amp;')).toBe(
      'a <b> "c" \'d\' AB &amp;',
    )
  })

  it('substitutes U+FFFD for code points outside Unicode or in the surrogate range', () => {
    expect(decodeXmlText('&#1114112;')).toBe('�')
    expect(decodeXmlText('&#x110000;')).toBe('�')
    expect(decodeXmlText('&#xD800;')).toBe('�')
    expect(decodeXmlText('&#x10FFFF;')).toBe('\u{10FFFF}')
  })
})
