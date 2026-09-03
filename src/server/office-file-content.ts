import 'server-only'
import { unzipSync } from 'fflate'
import type { OfficeFileMedium } from '@/domain/office-file'
import { RequestFailure } from './http'
import { decodeXmlText } from './xml-text'

/**
 * Read-only content extraction for the applet files bridge and agents:
 * typed table rows for spreadsheets and plain text for documents and
 * presentations. Formula cells contribute their cached <v> result, so a
 * reader without a formula engine still sees the numbers the file shows.
 */

export type TableScalar = string | number | boolean | null

export interface SheetTable {
  readonly name: string
  readonly rows: readonly (readonly TableScalar[])[]
}

const MAX_TABLE_CELLS = 200_000

const decoder = new TextDecoder()

const attribute = (attributes: string, name: string): string | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attributes)
  return match?.[1] ?? null
}

const innerTexts = (xml: string, tag: string): string[] => {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*[^/>])?>([\\s\\S]*?)</${tag}>`, 'g')
  const texts: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) texts.push(match[1] ?? '')
  return texts
}

const stripTags = (xml: string): string => xml.replaceAll(/<[^>]*>/g, '')

const columnIndex = (address: string): number => {
  let column = 0
  for (const character of address) {
    if (character < 'A' || character > 'Z') break
    column = column * 26 + character.charCodeAt(0) - 64
  }
  return column - 1
}

const rowIndex = (address: string): number => Number(/\d+/.exec(address)?.[0] ?? 0) - 1

const archiveOf = (bytes: Uint8Array): Record<string, Uint8Array> => {
  try {
    return unzipSync(bytes)
  } catch {
    throw new RequestFailure(409, 'file_unreadable', 'This file is not a readable Office archive')
  }
}

const sharedStringsOf = (archive: Record<string, Uint8Array>): string[] => {
  const bytes = archive['xl/sharedStrings.xml']
  if (!bytes) return []
  return innerTexts(decoder.decode(bytes), 'si').map((item) =>
    decodeXmlText(innerTexts(item, 't').map(stripTags).join('')),
  )
}

const scalarOf = (
  type: string | null,
  body: string,
  cachedValue: string | undefined,
  sharedStrings: readonly string[],
): TableScalar => {
  if (type === 'inlineStr') return decodeXmlText(stripTags(innerTexts(body, 'is').join('')))
  if (cachedValue === undefined) return null
  const raw = decodeXmlText(cachedValue)
  if (type === 's') return sharedStrings[Number(raw)] ?? null
  if (type === 'b') return raw === '1'
  if (type === 'str' || type === 'e') return raw
  const numeric = Number(raw)
  return Number.isFinite(numeric) ? numeric : raw
}

export const xlsxTable = (bytes: Uint8Array): SheetTable[] => {
  const archive = archiveOf(bytes)
  const workbookXml = archive['xl/workbook.xml']
  if (!workbookXml) {
    throw new RequestFailure(409, 'file_unreadable', 'This spreadsheet has no workbook part')
  }
  const sharedStrings = sharedStringsOf(archive)
  const sheetNames: string[] = []
  const namePattern = /<sheet\b([^>]*?)\/?>/g
  const workbook = decoder.decode(workbookXml)
  let nameMatch: RegExpExecArray | null
  while ((nameMatch = namePattern.exec(workbook)) !== null) {
    const name = attribute(nameMatch[1] ?? '', 'name')
    if (name !== null) sheetNames.push(decodeXmlText(name))
  }
  const sheetPaths = Object.keys(archive)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .sort(
      (left, right) =>
        Number(/(\d+)\.xml$/.exec(left)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(right)?.[1] ?? 0),
    )
  let totalCells = 0
  return sheetPaths.map((path, index) => {
    const xml = decoder.decode(archive[path] ?? new Uint8Array())
    const cells = new Map<string, TableScalar>()
    let maxRow = -1
    let maxColumn = -1
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let match: RegExpExecArray | null
    while ((match = cellPattern.exec(xml)) !== null) {
      const attributes = match[1] ?? ''
      const address = attribute(attributes, 'r')
      if (!address || !/^[A-Z]{1,3}\d{1,7}$/.test(address)) continue
      const body = match[2] ?? ''
      const cached = /<v(?:\s[^>]*[^/>])?>([\s\S]*?)<\/v>/.exec(body)?.[1]
      const value = scalarOf(attribute(attributes, 't'), body, cached, sharedStrings)
      if (value === null) continue
      totalCells += 1
      if (totalCells > MAX_TABLE_CELLS) {
        throw new RequestFailure(
          413,
          'table_too_large',
          `This workbook exceeds the ${MAX_TABLE_CELLS}-cell table budget`,
        )
      }
      cells.set(address, value)
      maxRow = Math.max(maxRow, rowIndex(address))
      maxColumn = Math.max(maxColumn, columnIndex(address))
      // The dense grid below spans the used range, so one far-away cell must
      // not be allowed to allocate billions of empty slots.
      if ((maxRow + 1) * (maxColumn + 1) > MAX_TABLE_CELLS) {
        throw new RequestFailure(
          413,
          'table_too_large',
          `This workbook's used range exceeds the ${MAX_TABLE_CELLS}-cell table budget`,
        )
      }
    }
    const rows: TableScalar[][] = Array.from({ length: maxRow + 1 }, () =>
      Array.from({ length: maxColumn + 1 }, () => null),
    )
    for (const [address, value] of cells) {
      const row = rows[rowIndex(address)]
      if (row) row[columnIndex(address)] = value
    }
    return { name: sheetNames[index] ?? `Sheet ${index + 1}`, rows }
  })
}

const docxText = async (bytes: Uint8Array): Promise<string> => {
  const { default: mammoth } = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  return result.value.trim()
}

const pptxText = (bytes: Uint8Array): string => {
  const archive = archiveOf(bytes)
  return Object.keys(archive)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort(
      (left, right) =>
        Number(/(\d+)\.xml$/.exec(left)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(right)?.[1] ?? 0),
    )
    .map((path, index) => {
      const xml = decoder.decode(archive[path] ?? new Uint8Array())
      const lines = innerTexts(xml, 'a:p')
        .map((paragraph) => decodeXmlText(innerTexts(paragraph, 'a:t').map(stripTags).join('')))
        .filter((line) => line.trim().length > 0)
      return [`## Slide ${index + 1}`, ...lines].join('\n')
    })
    .join('\n\n')
}

const xlsxText = (bytes: Uint8Array): string =>
  xlsxTable(bytes)
    .map(
      ({ name, rows }) =>
        `# ${name}\n${rows
          .map((row) => row.map((value) => (value === null ? '' : String(value))).join(' | '))
          .filter((line) => line.replaceAll('|', '').trim().length > 0)
          .join('\n')}`,
    )
    .join('\n\n')

export const officeFileText = async (
  medium: OfficeFileMedium,
  bytes: Uint8Array,
): Promise<string> => {
  switch (medium) {
    case 'document':
      return docxText(bytes)
    case 'presentation':
      return pptxText(bytes)
    case 'spreadsheet':
      return xlsxText(bytes)
    case 'pdf':
      throw new RequestFailure(
        409,
        'text_unsupported',
        'PDF text extraction is not available yet; read the PDF bytes instead',
      )
    default: {
      const unreachable: never = medium
      return unreachable
    }
  }
}
