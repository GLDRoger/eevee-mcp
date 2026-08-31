import 'server-only'
import { Inflate } from 'fflate'
import { RequestFailure } from './http'
import {
  validateOfficeFileName,
  type OfficeFileMedium,
} from '@/domain/office-file'

export const MAX_OFFICE_FILE_BYTES = 25 * 1024 * 1024

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const LOCAL_FILE_SIGNATURE = 0x04034b50
const MAX_ARCHIVE_ENTRIES = 10_000
const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024

const requiredEntries = {
  document: ['[Content_Types].xml', 'word/document.xml'],
  spreadsheet: ['[Content_Types].xml', 'xl/workbook.xml'],
  presentation: ['[Content_Types].xml', 'ppt/presentation.xml'],
} satisfies Record<Exclude<OfficeFileMedium, 'pdf'>, readonly string[]>

interface ArchiveEntry {
  name: string
  compressedSize: number
  uncompressedSize: number
  compressionMethod: number
  dataStart: number
  encrypted: boolean
}

const readU16 = (bytes: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 2 > bytes.length) throw new Error('The ZIP archive is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}

const readU32 = (bytes: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error('The ZIP archive is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

const endOfCentralDirectory = (bytes: Uint8Array): number => {
  const start = Math.max(0, bytes.length - 0xffff - 22)
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (readU32(bytes, offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue
    if (offset + 22 + readU16(bytes, offset + 20) === bytes.length) return offset
  }
  throw new Error('The file is not a valid ZIP archive')
}

const safeArchiveName = (name: string): boolean =>
  !name.startsWith('/') &&
  !name.includes('\\') &&
  name.split('/').every((part, index, parts) =>
    part === '' ? index === parts.length - 1 : part !== '.' && part !== '..',
  )

const readArchiveEntries = (bytes: Uint8Array): ArchiveEntry[] => {
  const endOffset = endOfCentralDirectory(bytes)
  const disk = readU16(bytes, endOffset + 4)
  const centralDisk = readU16(bytes, endOffset + 6)
  const diskEntries = readU16(bytes, endOffset + 8)
  const entryCount = readU16(bytes, endOffset + 10)
  const centralSize = readU32(bytes, endOffset + 12)
  const centralOffset = readU32(bytes, endOffset + 16)
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
    throw new Error('Multi-disk ZIP archives are not supported')
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 files are not supported')
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error('The archive contains too many entries')
  if (centralOffset + centralSize > endOffset) {
    throw new Error('The ZIP central directory exceeds the archive bounds')
  }

  const decoder = new TextDecoder('utf-8', { fatal: true })
  const entries: ArchiveEntry[] = []
  const names = new Set<string>()
  const localOffsets = new Set<number>()
  let totalUncompressed = 0
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(bytes, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('The ZIP central directory is malformed')
    }
    const flags = readU16(bytes, offset + 8)
    const compressionMethod = readU16(bytes, offset + 10)
    const compressedSize = readU32(bytes, offset + 20)
    const uncompressedSize = readU32(bytes, offset + 24)
    const nameLength = readU16(bytes, offset + 28)
    const extraLength = readU16(bytes, offset + 30)
    const commentLength = readU16(bytes, offset + 32)
    const end = offset + 46 + nameLength + extraLength + commentLength
    if (end > centralOffset + centralSize) throw new Error('The ZIP entry is truncated')
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    if (!name || !safeArchiveName(name)) throw new Error('The archive contains an unsafe path')
    const normalized = name.toLocaleLowerCase('en-US')
    if (!names.add(normalized)) throw new Error('The archive contains duplicate file names')
    if (normalized.endsWith('/vbaproject.bin') || normalized.endsWith('/vbadata.xml')) {
      throw new Error('Macro-enabled Office files are not supported')
    }
    totalUncompressed += uncompressedSize
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('The expanded Office file is too large')
    }
    if (compressedSize === 0 && uncompressedSize > 0) {
      throw new Error('The archive contains an invalid compressed entry')
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > 1_000) {
      throw new Error('The archive compression ratio is unsafe')
    }
    const localOffset = readU32(bytes, offset + 42)
    if (!localOffsets.add(localOffset) || readU32(bytes, localOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new Error('The archive contains an invalid local file record')
    }
    const localNameLength = readU16(bytes, localOffset + 26)
    const localExtraLength = readU16(bytes, localOffset + 28)
    const localFlags = readU16(bytes, localOffset + 6)
    const localCompressionMethod = readU16(bytes, localOffset + 8)
    const localNameStart = localOffset + 30
    const localName = decoder.decode(
      bytes.subarray(localNameStart, localNameStart + localNameLength),
    )
    const dataStart = localNameStart + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (
      localName !== name ||
      localFlags !== flags ||
      localCompressionMethod !== compressionMethod ||
      dataEnd > centralOffset
    ) {
      throw new Error('The archive local file record does not match its directory entry')
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error(`The archive uses unsupported compression method ${compressionMethod}`)
    }
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      dataStart,
      encrypted: (flags & 1) === 1,
    })
    offset = end
  }
  if (offset !== centralOffset + centralSize) {
    throw new Error('The ZIP central directory has an invalid size')
  }
  return entries
}

const INFLATE_INPUT_CHUNK_BYTES = 1_024

const validateExpandedBytes = (bytes: Uint8Array, entries: readonly ArchiveEntry[]): void => {
  let totalExpanded = 0
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize)
    let expanded = 0
    const record = (chunk: Uint8Array): void => {
      expanded += chunk.length
      if (expanded > entry.uncompressedSize) {
        throw new Error(`${entry.name} expands beyond its declared uncompressed size`)
      }
      totalExpanded += chunk.length
      if (totalExpanded > MAX_UNCOMPRESSED_BYTES) {
        throw new Error('The expanded Office file is too large')
      }
    }

    if (entry.compressionMethod === 0) {
      record(compressed)
    } else {
      const inflater = new Inflate((chunk) => record(chunk))
      if (compressed.length === 0) inflater.push(compressed, true)
      for (let offset = 0; offset < compressed.length; offset += INFLATE_INPUT_CHUNK_BYTES) {
        const end = Math.min(offset + INFLATE_INPUT_CHUNK_BYTES, compressed.length)
        inflater.push(compressed.subarray(offset, end), end === compressed.length)
      }
    }
    if (expanded !== entry.uncompressedSize) {
      throw new Error(`${entry.name} does not match its declared uncompressed size`)
    }
  }
}

const validatePdf = (bytes: Uint8Array): void => {
  const start = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1_024)))
  const end = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 1_024)))
  if (!start.includes('%PDF-') || !end.includes('%%EOF')) {
    throw new Error('The file is not a complete PDF document')
  }
}

const validateOpenXml = (
  medium: Exclude<OfficeFileMedium, 'pdf'>,
  bytes: Uint8Array,
): void => {
  const entries = readArchiveEntries(bytes)
  if (entries.some(({ encrypted }) => encrypted)) {
    throw new Error('Encrypted Office files are not supported')
  }
  validateExpandedBytes(bytes, entries)
  const names = new Set(entries.map(({ name }) => name.toLocaleLowerCase('en-US')))
  const missing = requiredEntries[medium].find(
    (name) => !names.has(name.toLocaleLowerCase('en-US')),
  )
  if (missing) throw new Error(`The Office file is missing ${missing}`)
}

export const validateOfficeFile = (
  unsafeName: string,
  bytes: Uint8Array,
): { name: string; medium: OfficeFileMedium } => {
  if (bytes.length === 0) throw new RequestFailure(400, 'empty_file', 'The file is empty')
  if (bytes.length > MAX_OFFICE_FILE_BYTES) {
    throw new RequestFailure(413, 'file_too_large', 'Office files must be 25 MB or smaller')
  }
  let identity: ReturnType<typeof validateOfficeFileName>
  try {
    identity = validateOfficeFileName(unsafeName)
    if (identity.medium === 'pdf') validatePdf(bytes)
    else validateOpenXml(identity.medium, bytes)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Office file is invalid'
    throw new RequestFailure(400, 'invalid_office_file', message)
  }
  return identity
}
