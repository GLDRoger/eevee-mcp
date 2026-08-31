/**
 * TIFF → PNG transcoding for display. Chromium cannot decode TIFF, so pictures
 * embedded as ppt/media/*.tif(f) would render as blank placeholders. Decode with
 * UTIF and re-encode as PNG; the original TIFF bytes stay in the package.
 */
import { zlibSync } from 'fflate'
import UTIF from 'utif2'

export interface DecodedTiff {
  png: Uint8Array
  width: number
  height: number
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const tag = new TextEncoder().encode(type)
  return concat([u32(data.length), tag, data, u32(crc32(concat([tag, data])))])
}

function rgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4)
    raw[row] = 0
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), row + 1)
  }
  const ihdr = new Uint8Array(13)
  ihdr.set(u32(width), 0)
  ihdr.set(u32(height), 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ])
}

export function tiffToPng(bytes: Uint8Array): DecodedTiff | null {
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const ifds = UTIF.decode(copy)
    if (!ifds.length) return null
    let page = ifds[0]!
    for (const ifd of ifds) {
      UTIF.decodeImage(copy, ifd)
      const cur = (ifd.width || 0) * (ifd.height || 0)
      if (cur > (page.width || 0) * (page.height || 0)) page = ifd
    }
    const width = page.width
    const height = page.height
    if (!width || !height) return null
    const rgba = UTIF.toRGBA8(page)
    return { png: rgbaPng(width, height, rgba), width, height }
  } catch {
    return null
  }
}
