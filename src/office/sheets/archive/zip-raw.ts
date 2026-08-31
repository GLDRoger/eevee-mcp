import { deflateSync, inflateSync } from 'fflate'

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const LOCAL_FILE_SIGNATURE = 0x04034b50
const MAX_ENTRIES = 10_000
const MAX_PATCH_ENTRY_BYTES = 256 * 1024 * 1024

export interface ZipEntryManifest {
  readonly name: string
  readonly crc32: number
  readonly compressedSize: number
  readonly uncompressedSize: number
}

export interface RawZipEntry extends ZipEntryManifest {
  readonly compressionMethod: number
  readonly flags: number
  readonly versionMadeBy: number
  readonly versionNeeded: number
  readonly modifiedTime: number
  readonly modifiedDate: number
  readonly internalAttributes: number
  readonly externalAttributes: number
  readonly localHeaderOffset: number
  readonly localRecord: Uint8Array
  readonly compressedData: Uint8Array
}

export interface RawZipArchive {
  readonly bytes: Uint8Array
  readonly entries: readonly RawZipEntry[]
}

export interface ZipContent {
  readonly name: string
  readonly content: Uint8Array
}

export interface RawZipSaveResult {
  readonly archive: Uint8Array
  readonly beforeEntries: readonly ZipEntryManifest[]
  readonly afterEntries: readonly ZipEntryManifest[]
}

export function readRawZip(bytes: Uint8Array): RawZipArchive {
  const endOffset = findEndOfCentralDirectory(bytes)
  const entryCount = readU16(bytes, endOffset + 10)
  const centralDirectorySize = readU32(bytes, endOffset + 12)
  const centralDirectoryOffset = readU32(bytes, endOffset + 16)
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error('ZIP64 workbooks are not supported by the browser archive layer.')
  }
  if (entryCount > MAX_ENTRIES) throw new Error('Workbook contains too many ZIP entries.')
  if (centralDirectoryOffset + centralDirectorySize > bytes.length) {
    throw new Error('ZIP central directory exceeds the archive bounds.')
  }

  const entries: Omit<RawZipEntry, 'localRecord' | 'compressedData'>[] = []
  let offset = centralDirectoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(bytes, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('ZIP central directory is malformed.')
    }
    const nameLength = readU16(bytes, offset + 28)
    const extraLength = readU16(bytes, offset + 30)
    const commentLength = readU16(bytes, offset + 32)
    const name = decodeName(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
      readU16(bytes, offset + 8),
    )
    validateArchiveName(name)
    entries.push({
      name,
      versionMadeBy: readU16(bytes, offset + 4),
      versionNeeded: readU16(bytes, offset + 6),
      flags: readU16(bytes, offset + 8),
      compressionMethod: readU16(bytes, offset + 10),
      modifiedTime: readU16(bytes, offset + 12),
      modifiedDate: readU16(bytes, offset + 14),
      crc32: readU32(bytes, offset + 16),
      compressedSize: readU32(bytes, offset + 20),
      uncompressedSize: readU32(bytes, offset + 24),
      internalAttributes: readU16(bytes, offset + 36),
      externalAttributes: readU32(bytes, offset + 38),
      localHeaderOffset: readU32(bytes, offset + 42),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new Error('ZIP central directory has an invalid size.')
  }

  const offsets = entries
    .map((entry) => entry.localHeaderOffset)
    .sort((left, right) => left - right)
  const endByOffset = new Map<number, number>()
  offsets.forEach((localOffset, index) => {
    endByOffset.set(localOffset, offsets[index + 1] ?? centralDirectoryOffset)
  })
  return {
    bytes,
    entries: entries.map((entry) => {
      const end = endByOffset.get(entry.localHeaderOffset)
      if (end === undefined || readU32(bytes, entry.localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
        throw new Error(`ZIP entry ${entry.name} has an invalid local header.`)
      }
      const localNameLength = readU16(bytes, entry.localHeaderOffset + 26)
      const localExtraLength = readU16(bytes, entry.localHeaderOffset + 28)
      const dataStart = entry.localHeaderOffset + 30 + localNameLength + localExtraLength
      const dataEnd = dataStart + entry.compressedSize
      if (dataEnd > end || end > centralDirectoryOffset) {
        throw new Error(`ZIP entry ${entry.name} exceeds its local record.`)
      }
      return {
        ...entry,
        localRecord: bytes.slice(entry.localHeaderOffset, end),
        compressedData: bytes.slice(dataStart, dataEnd),
      }
    }),
  }
}

export function listRawZipEntries(bytes: Uint8Array): ZipEntryManifest[] {
  return manifestOf(readRawZip(bytes).entries.filter((entry) => !entry.name.endsWith('/')))
}

export function extractRawZipEntry(archive: RawZipArchive, name: string): Uint8Array {
  const entry = archive.entries.find((candidate) => candidate.name === name)
  if (!entry) throw new Error(`Workbook is missing ${name}.`)
  if (entry.uncompressedSize > MAX_PATCH_ENTRY_BYTES) {
    throw new Error(
      `${name} is ${entry.uncompressedSize} bytes uncompressed, above the patch limit.`,
    )
  }
  if (entry.flags & 1) throw new Error(`Workbook entry ${name} is encrypted.`)
  if (entry.compressionMethod === 0) return entry.compressedData.slice()
  if (entry.compressionMethod === 8) return inflateSync(entry.compressedData)
  throw new Error(
    `Workbook entry ${name} uses unsupported ZIP compression method ${entry.compressionMethod}.`,
  )
}

/**
 * Rebuilds only the central directory. Untouched local records, including
 * compressed payloads and data descriptors, are copied verbatim.
 */
export function saveRawZip(
  archive: RawZipArchive,
  replacements: readonly ZipContent[] = [],
  removals: readonly string[] = [],
  additions: readonly ZipContent[] = [],
): RawZipSaveResult {
  validateEdits(archive.entries, replacements, removals, additions)
  const replacementByName = new Map(replacements.map((entry) => [entry.name, entry.content]))
  const removed = new Set(removals)
  const output: Uint8Array[] = []
  const savedEntries: Array<RawZipEntry | NewZipEntry> = []
  let offset = 0

  for (const entry of archive.entries) {
    if (removed.has(entry.name)) continue
    const replacement = replacementByName.get(entry.name)
    if (replacement === undefined) {
      output.push(entry.localRecord)
      savedEntries.push({ ...entry, localHeaderOffset: offset })
      offset += entry.localRecord.length
      continue
    }
    const next = createNewEntry(entry.name, replacement, offset)
    output.push(next.localRecord)
    savedEntries.push(next)
    offset += next.localRecord.length
  }
  for (const addition of additions) {
    const next = createNewEntry(addition.name, addition.content, offset)
    output.push(next.localRecord)
    savedEntries.push(next)
    offset += next.localRecord.length
  }

  const centralDirectory = concat(savedEntries.map(centralDirectoryRecord))
  const end = endOfCentralDirectory(savedEntries.length, centralDirectory.length, offset)
  const result = concat([...output, centralDirectory, end])
  return {
    archive: result,
    beforeEntries: manifestOf(archive.entries.filter((entry) => !entry.name.endsWith('/'))),
    afterEntries: listRawZipEntries(result),
  }
}

function validateEdits(
  sourceEntries: readonly RawZipEntry[],
  replacements: readonly ZipContent[],
  removals: readonly string[],
  additions: readonly ZipContent[],
): void {
  const names = new Set(sourceEntries.map((entry) => entry.name))
  const edited = new Set<string>()
  for (const entry of [...replacements, ...additions]) {
    validateName(entry.name)
    if (!edited.add(entry.name))
      throw new Error(`Entry ${entry.name} appears in more than one edit set.`)
  }
  for (const name of removals) {
    validateName(name)
    if (!edited.add(name)) throw new Error(`Entry ${name} appears in more than one edit set.`)
  }
  for (const entry of replacements)
    if (!names.has(entry.name)) throw new Error(`Cannot replace missing entry ${entry.name}.`)
  for (const name of removals)
    if (!names.has(name)) throw new Error(`Cannot remove missing entry ${name}.`)
  for (const entry of additions)
    if (names.has(entry.name)) throw new Error(`Cannot add entry ${entry.name}; it already exists.`)
  if (sourceEntries.length - removals.length + additions.length > MAX_ENTRIES) {
    throw new Error('Saving would exceed the archive entry limit.')
  }
}

interface NewZipEntry extends ZipEntryManifest {
  readonly compressionMethod: number
  readonly flags: number
  readonly versionMadeBy: number
  readonly versionNeeded: number
  readonly modifiedTime: number
  readonly modifiedDate: number
  readonly internalAttributes: number
  readonly externalAttributes: number
  readonly localHeaderOffset: number
  readonly localRecord: Uint8Array
  readonly compressedData: Uint8Array
}

function createNewEntry(name: string, content: Uint8Array, localHeaderOffset: number): NewZipEntry {
  const encodedName = new TextEncoder().encode(name)
  const compressedData = deflateSync(content)
  const crc32 = crc32Of(content)
  const header = new Uint8Array(30 + encodedName.length)
  writeU32(header, 0, LOCAL_FILE_SIGNATURE)
  writeU16(header, 4, 20)
  writeU16(header, 6, 0x0800)
  writeU16(header, 8, 8)
  writeU32(header, 14, crc32)
  writeU32(header, 18, compressedData.length)
  writeU32(header, 22, content.length)
  writeU16(header, 26, encodedName.length)
  header.set(encodedName, 30)
  return {
    name,
    crc32,
    compressedSize: compressedData.length,
    uncompressedSize: content.length,
    compressionMethod: 8,
    flags: 0x0800,
    versionMadeBy: 20,
    versionNeeded: 20,
    modifiedTime: 0,
    modifiedDate: 0,
    internalAttributes: 0,
    externalAttributes: 0,
    localHeaderOffset,
    localRecord: concat([header, compressedData]),
    compressedData,
  }
}

function centralDirectoryRecord(entry: RawZipEntry | NewZipEntry): Uint8Array {
  const name = new TextEncoder().encode(entry.name)
  const result = new Uint8Array(46 + name.length)
  writeU32(result, 0, CENTRAL_DIRECTORY_SIGNATURE)
  writeU16(result, 4, entry.versionMadeBy)
  writeU16(result, 6, entry.versionNeeded)
  writeU16(result, 8, entry.flags)
  writeU16(result, 10, entry.compressionMethod)
  writeU16(result, 12, entry.modifiedTime)
  writeU16(result, 14, entry.modifiedDate)
  writeU32(result, 16, entry.crc32)
  writeU32(result, 20, entry.compressedSize)
  writeU32(result, 24, entry.uncompressedSize)
  writeU16(result, 28, name.length)
  writeU16(result, 36, entry.internalAttributes)
  writeU32(result, 38, entry.externalAttributes)
  writeU32(result, 42, entry.localHeaderOffset)
  result.set(name, 46)
  return result
}

function endOfCentralDirectory(entries: number, size: number, offset: number): Uint8Array {
  if (entries > 0xffff || size > 0xffffffff || offset > 0xffffffff)
    throw new Error('Workbook is too large for ZIP32.')
  const result = new Uint8Array(22)
  writeU32(result, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE)
  writeU16(result, 8, entries)
  writeU16(result, 10, entries)
  writeU32(result, 12, size)
  writeU32(result, 16, offset)
  return result
}

function manifestOf(entries: readonly ZipEntryManifest[]): ZipEntryManifest[] {
  return [...entries]
    .map(({ name, crc32, compressedSize, uncompressedSize }) => ({
      name,
      crc32,
      compressedSize,
      uncompressedSize,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const start = Math.max(0, bytes.length - 0xffff - 22)
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (readU32(bytes, offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      const commentLength = readU16(bytes, offset + 20)
      if (offset + 22 + commentLength === bytes.length) return offset
    }
  }
  throw new Error('Workbook is not a valid ZIP archive.')
}

function validateName(name: string): void {
  if (!name || name.endsWith('/') || !isSafePath(name)) {
    throw new Error(`Entry ${name || '(empty)'} has an unsafe archive path.`)
  }
}

function validateArchiveName(name: string): void {
  const path = name.endsWith('/') ? name.slice(0, -1) : name
  if (!path || !isSafePath(path))
    throw new Error(`Entry ${name || '(empty)'} has an unsafe archive path.`)
}

function isSafePath(name: string): boolean {
  return !name.startsWith('/') && !name.split('/').some((part) => !part || part === '..')
}

function decodeName(bytes: Uint8Array, flags: number): string {
  return new TextDecoder(flags & 0x0800 ? 'utf-8' : 'utf-8', { fatal: true }).decode(bytes)
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function readU16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new Error('ZIP archive is truncated.')
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error('ZIP archive is truncated.')
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  )
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32Of(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
