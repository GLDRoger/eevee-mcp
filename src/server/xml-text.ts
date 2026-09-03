import 'server-only'

const MAX_CODE_POINT = 0x10ffff

// Invalid numeric references (beyond U+10FFFF or lone surrogates) would make
// String.fromCodePoint throw; they decode to the replacement character
// instead so a malformed part is reported as unreadable content, not a crash.
const characterOf = (codePoint: number): string =>
  codePoint > MAX_CODE_POINT || (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ? '�'
    : String.fromCodePoint(codePoint)

export const decodeXmlText = (value: string): string =>
  value
    .replaceAll(/&lt;/g, '<')
    .replaceAll(/&gt;/g, '>')
    .replaceAll(/&quot;/g, '"')
    .replaceAll(/&apos;/g, "'")
    .replaceAll(/&#x([0-9a-f]+);/gi, (_, hex: string) => characterOf(Number.parseInt(hex, 16)))
    .replaceAll(/&#(\d+);/g, (_, code: string) => characterOf(Number(code)))
    .replaceAll(/&amp;/g, '&')
