/**
 * CFB (OLE2 compound document) sniffing: legacy .ppt and encrypted OOXML share
 * the same magic number. EncryptedPackage in the directory marks a passworded pptx.
 */
const CFB_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const ENCRYPTED_STREAM_UTF16 = new TextEncoder().encode('EncryptedPackage').length
  ? (() => {
      const s = 'EncryptedPackage'
      const out = new Uint8Array(s.length * 2)
      for (let i = 0; i < s.length; i++) {
        out[i * 2] = s.charCodeAt(i) & 0xff
        out[i * 2 + 1] = 0
      }
      return out
    })()
  : new Uint8Array()

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false
  return true
}

function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

export function isCfbHeader(head: Uint8Array): boolean {
  return startsWith(head, CFB_MAGIC)
}

export function cfbKind(bytes: Uint8Array): 'legacy' | 'encrypted' | null {
  if (!isCfbHeader(bytes)) return null
  return includesBytes(bytes, ENCRYPTED_STREAM_UTF16) ? 'encrypted' : 'legacy'
}
