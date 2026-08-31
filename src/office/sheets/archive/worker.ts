import { XMLParser } from 'fast-xml-parser'

import {
  extractRawZipEntry,
  readRawZip,
  saveRawZip,
  type RawZipArchive,
  type ZipContent,
} from './zip-raw'

const MAX_RANGE_CELLS = 20_000
const MAX_FORMULA_CELLS = 100_000
const CHUNK_ROW_COUNT = 256
const xml = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  removeNSPrefix: true,
})

export type ArchiveCommand =
  | { readonly command: 'open'; readonly bytes: Uint8Array; readonly name?: string }
  | {
      readonly command: 'read_range'
      readonly sessionId: string
      readonly sheetId: string
      readonly range: CellRange
    }
  | { readonly command: 'read_formula_cells'; readonly sessionId: string; readonly sheetId: string }
  | { readonly command: 'read_media'; readonly sessionId: string; readonly visualId: string }
  | { readonly command: 'close'; readonly sessionId: string }
  | { readonly command: 'archive_manifest'; readonly bytes: Uint8Array }
  | {
      readonly command: 'read_entries'
      readonly bytes: Uint8Array
      readonly entries: readonly string[]
    }
  | {
      readonly command: 'scan_entries'
      readonly bytes: Uint8Array
      readonly entries: readonly string[]
      readonly needle: string
    }
  | {
      readonly command: 'save_archive'
      readonly sourceBytes: Uint8Array
      readonly replacements: readonly ZipContent[]
      readonly removals: readonly string[]
      readonly additions: readonly ZipContent[]
    }

export type ArchiveRequestEnvelope = {
  readonly version: 1
  readonly requestId: string
} & ArchiveCommand

export interface ArchiveResponseEnvelope {
  readonly version: 1
  readonly requestId: string
  readonly ok: boolean
  readonly result?: unknown
  readonly error?: { readonly code: string; readonly message: string }
}

interface CellRange {
  readonly startRow: number
  readonly endRow: number
  readonly startColumn: number
  readonly endColumn: number
}

interface CellRecord {
  readonly row: number
  readonly column: number
  readonly value: string | number | boolean | null
  readonly formula?: string
  readonly arrayRef?: string
  readonly styleIndex?: number
}

interface SheetSession {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly rowCount: number
  readonly columnCount: number
  readonly showGridLines: boolean
  readonly showFormulas: boolean
  readonly cells: readonly CellRecord[]
  readonly cellChunks: ReadonlyMap<number, readonly CellRecord[]>
  readonly rows: readonly {
    row: number
    height?: number
    hidden: boolean
    outlineLevel?: number
    collapsed?: boolean
  }[]
  readonly merges: readonly CellArea[]
}

interface Session {
  readonly archive: RawZipArchive
  readonly name: string
  readonly sheets: readonly SheetSession[]
  readonly styles: readonly Record<string, unknown>[]
  readonly media: ReadonlyMap<string, string>
}

interface CellArea {
  readonly startRow: number
  readonly startColumn: number
  readonly endRow: number
  readonly endColumn: number
}

const sessions = new Map<string, Session>()

export async function processArchiveRequest(
  request: ArchiveRequestEnvelope,
): Promise<ArchiveResponseEnvelope> {
  if (request.version !== 1)
    return failure(
      request.requestId,
      'unsupported_version',
      'Unsupported archive protocol version.',
    )
  try {
    return {
      version: 1,
      requestId: request.requestId,
      ok: true,
      result: processCommand(request),
    }
  } catch (error: unknown) {
    return failure(
      request.requestId,
      'workbook_error',
      error instanceof Error ? error.message : 'Archive request failed.',
    )
  }
}

function processCommand(command: ArchiveCommand): unknown {
  switch (command.command) {
    case 'open':
      return openWorkbook(command.bytes, command.name)
    case 'read_range':
      return readRange(command)
    case 'read_formula_cells':
      return readFormulaCells(command)
    case 'read_media':
      return readMedia(command)
    case 'close':
      if (!sessions.delete(command.sessionId)) throw new Error('Unknown workbook session.')
      return { closed: true }
    case 'archive_manifest':
      return { entries: readRawZip(command.bytes).entries.map(toManifest).sort(byName) }
    case 'read_entries': {
      const archive = readRawZip(command.bytes)
      return {
        entries: command.entries.map((name) => ({
          name,
          content: extractRawZipEntry(archive, name),
        })),
      }
    }
    case 'scan_entries': {
      if (!command.needle) throw new Error('Scan needle must not be empty.')
      const archive = readRawZip(command.bytes)
      return {
        matches: command.entries.filter((name) =>
          new TextDecoder().decode(extractRawZipEntry(archive, name)).includes(command.needle),
        ),
      }
    }
    case 'save_archive':
      return saveRawZip(
        readRawZip(command.sourceBytes),
        command.replacements,
        command.removals,
        command.additions,
      )
  }
}

function openWorkbook(bytes: Uint8Array, name = 'workbook.xlsx'): unknown {
  const archive = readRawZip(bytes)
  const sharedStrings = archive.entries.some((entry) => entry.name === 'xl/sharedStrings.xml')
    ? stringsOf(readText(archive, 'xl/sharedStrings.xml'))
    : []
  const workbook = parseXml(readText(archive, 'xl/workbook.xml'))
  const relationships = parseRelationships(readText(archive, 'xl/_rels/workbook.xml.rels'))
  const sheets = asArray(objectAt(objectAt(workbook, 'workbook'), 'sheets').sheet).map(
    (sheet, index) => makeSheet(archive, sheet, index, relationships, sharedStrings),
  )
  if (!sheets.length) throw new Error('Workbook has no worksheets.')
  const sessionId = crypto.randomUUID()
  const media = new Map<string, string>()
  archive.entries
    .filter((entry) => entry.name.startsWith('xl/media/'))
    .forEach((entry, index) => media.set(`media:${index}`, entry.name))
  const session: Session = { archive, name, sheets, styles: parseStyles(archive), media }
  sessions.set(sessionId, session)
  return {
    sessionId,
    name,
    entryCount: archive.entries.length,
    sheets: sheets.map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      columnWidths: [],
      defaultRowHeight: null,
      defaultColumnWidth: null,
      freeze: null,
      hidden: false,
      tabColor: null,
      showGridLines: sheet.showGridLines,
      showFormulas: sheet.showFormulas,
      tables: [],
      comments: [],
      pivotRanges: [],
      pivotTables: [],
      sparklines: [],
    })),
    styles: session.styles,
    dxfStyles: [],
    visuals: [...media.entries()].map(([id, mediaPath]) => ({
      id,
      sheetId: sheets[0]!.id,
      kind: 'image',
      anchor: emptyAnchor(),
      mediaPath,
      mediaType: mimeFor(mediaPath),
    })),
    definedNames: [],
    readOnly: false,
  }
}

function makeSheet(
  archive: RawZipArchive,
  sheet: unknown,
  index: number,
  relationships: ReadonlyMap<string, string>,
  sharedStrings: readonly string[],
): SheetSession {
  const attributes = record(sheet)
  const relationshipId = stringAt(attributes, '@_id')
  const target = relationships.get(relationshipId)
  if (!target) throw new Error('Workbook sheet relationship is missing.')
  const path = resolveWorkbookTarget(target)
  const scanned = scanWorksheet(readText(archive, path), sharedStrings)
  return {
    id: `sheet-${stringAt(attributes, '@_sheetId') || String(index + 1)}`,
    name: stringAt(attributes, '@_name') || `Sheet${index + 1}`,
    path,
    ...scanned,
    cellChunks: chunkCells(scanned.cells),
  }
}

function readRange(command: Extract<ArchiveCommand, { command: 'read_range' }>): unknown {
  const sheet = sheetFor(command.sessionId, command.sheetId)
  validateRange(command.range, sheet)
  return {
    cells: rangeCells(sheet, command.range),
    rows: sheet.rows.filter(
      (row) => row.row >= command.range.startRow && row.row <= command.range.endRow,
    ),
    merges: sheet.merges.filter((merge) => overlaps(merge, command.range)),
    hyperlinks: [],
    conditionalRules: [],
    autoFilter: null,
    dataValidations: [],
    sheetProtection: null,
    indexedThroughRow: Math.max(0, sheet.rowCount - 1),
    indexingComplete: true,
  }
}

function readFormulaCells(
  command: Extract<ArchiveCommand, { command: 'read_formula_cells' }>,
): unknown {
  const formulas = sheetFor(command.sessionId, command.sheetId).cells.filter(
    (cell) => cell.formula !== undefined,
  )
  return {
    cells: formulas.slice(0, MAX_FORMULA_CELLS),
    indexingComplete: true,
    truncated: formulas.length > MAX_FORMULA_CELLS,
  }
}

function rangeCells(sheet: SheetSession, range: CellRange): CellRecord[] {
  const firstChunk = Math.floor(range.startRow / CHUNK_ROW_COUNT)
  const lastChunk = Math.floor(range.endRow / CHUNK_ROW_COUNT)
  const cells: CellRecord[] = []
  for (let chunk = firstChunk; chunk <= lastChunk; chunk += 1) {
    for (const cell of sheet.cellChunks.get(chunk) ?? []) {
      if (inRange(cell.row, cell.column, range)) cells.push(cell)
    }
  }
  return cells
}

function chunkCells(cells: readonly CellRecord[]): ReadonlyMap<number, readonly CellRecord[]> {
  const chunks = new Map<number, CellRecord[]>()
  for (const cell of cells) {
    const index = Math.floor(cell.row / CHUNK_ROW_COUNT)
    const chunk = chunks.get(index)
    if (chunk) chunk.push(cell)
    else chunks.set(index, [cell])
  }
  return chunks
}

function readMedia(command: Extract<ArchiveCommand, { command: 'read_media' }>): unknown {
  const session = sessionFor(command.sessionId)
  const path = session.media.get(command.visualId)
  if (!path) throw new Error('Unknown workbook image.')
  const bytes = extractRawZipEntry(session.archive, path)
  return { mediaType: mimeFor(path), base64: toBase64(bytes) }
}

function scanWorksheet(
  source: string,
  sharedStrings: readonly string[],
): Pick<
  SheetSession,
  'rowCount' | 'columnCount' | 'showGridLines' | 'showFormulas' | 'cells' | 'rows' | 'merges'
> {
  const cells: CellRecord[] = []
  const rows: Array<{
    row: number
    height?: number
    hidden: boolean
    outlineLevel?: number
    collapsed?: boolean
  }> = []
  let rowCount = 1
  let columnCount = 1
  const sheetView = attributes(/<sheetView\b([^>]*)/.exec(source)?.[1] ?? '')
  const showGridLines = sheetView.showGridLines !== '0' && sheetView.showGridLines !== 'false'
  const showFormulas = truthy(sheetView.showFormulas)
  const rowPattern = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
  for (const match of source.matchAll(rowPattern)) {
    const rowAttributes = attributes(match[1] ?? '')
    const row = Math.max(0, numericAttribute(rowAttributes, 'r', 1) - 1)
    rowCount = Math.max(rowCount, row + 1)
    const height = optionalNumber(rowAttributes.ht)
    const outlineLevel = optionalNumber(rowAttributes.outlineLevel)
    if (
      height !== undefined ||
      truthy(rowAttributes.hidden) ||
      outlineLevel !== undefined ||
      truthy(rowAttributes.collapsed)
    ) {
      rows.push({
        row,
        ...(height === undefined ? {} : { height }),
        hidden: truthy(rowAttributes.hidden),
        ...(outlineLevel === undefined ? {} : { outlineLevel }),
        ...(truthy(rowAttributes.collapsed) ? { collapsed: true } : {}),
      })
    }
    for (const cellMatch of (match[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttributes = attributes(cellMatch[1] ?? '')
      const reference = cellAttributes.r
      if (!reference) continue
      const position = cellAddress(reference)
      if (!position) continue
      rowCount = Math.max(rowCount, position.row + 1)
      columnCount = Math.max(columnCount, position.column + 1)
      const styleIndex = optionalNumber(cellAttributes.s)
      const body = cellMatch[2] ?? ''
      const formulaMatch = /<f\b([^>]*)>([\s\S]*?)<\/f>|<f\b([^>]*)\/>/.exec(body)
      const formula = formulaMatch ? `=${decodeXml(formulaMatch[2] ?? '')}` : undefined
      const arrayRef = formulaMatch
        ? attributes(formulaMatch[1] ?? formulaMatch[3] ?? '').ref
        : undefined
      const rawValue = tagText(body, 'v')
      const inline = tagText(body, 't')
      const value = cellValue(cellAttributes.t, rawValue, inline, sharedStrings)
      if (value !== null || formula !== undefined || styleIndex !== undefined) {
        cells.push({
          row: position.row,
          column: position.column,
          value,
          ...(formula ? { formula } : {}),
          ...(arrayRef ? { arrayRef } : {}),
          ...(styleIndex === undefined ? {} : { styleIndex }),
        })
      }
    }
  }
  const merges = [...source.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"[^>]*\/>/g)]
    .map((match) => rangeAddress(match[1] ?? ''))
    .filter((range): range is CellArea => range !== null)
  return { rowCount, columnCount, showGridLines, showFormulas, cells, rows, merges }
}

function parseStyles(archive: RawZipArchive): readonly Record<string, unknown>[] {
  if (!archive.entries.some((entry) => entry.name === 'xl/styles.xml')) return [defaultStyle()]
  const styleSheet = objectAt(parseXml(readText(archive, 'xl/styles.xml')), 'styleSheet')
  const borders = asArray(objectAt(styleSheet, 'borders').border)
  const fills = asArray(objectAt(styleSheet, 'fills').fill)
  return asArray(objectAt(styleSheet, 'cellXfs').xf).map((xf) => {
    const attributes = record(xf)
    const border = record(borders[Number(stringAt(attributes, '@_borderId'))] ?? {})
    const fill = record(fills[Number(stringAt(attributes, '@_fillId'))] ?? {})
    return {
      ...defaultStyle(),
      ...edgeStyle(border, 'top', 'borderTop'),
      ...edgeStyle(border, 'bottom', 'borderBottom'),
      ...edgeStyle(border, 'left', 'borderLeft'),
      ...edgeStyle(border, 'right', 'borderRight'),
      ...(fillColor(fill) ? { fillColor: fillColor(fill) } : {}),
    }
  })
}

function defaultStyle(): Record<string, unknown> {
  return {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    wrapText: false,
    diagonalUp: false,
    diagonalDown: false,
  }
}

function edgeStyle(
  border: Record<string, unknown>,
  tag: string,
  field: string,
): Record<string, unknown> {
  const edge = record(border[tag])
  const style = stringAt(edge, '@_style')
  return style ? { [field]: { style } } : {}
}

function fillColor(fill: Record<string, unknown>): string | undefined {
  const rgb = stringAt(record(record(fill.patternFill).fgColor), '@_rgb')
  return rgb ? `#${rgb.slice(-6)}` : undefined
}

function parseRelationships(source: string): ReadonlyMap<string, string> {
  const root = objectAt(parseXml(source), 'Relationships')
  return new Map(
    asArray(root.Relationship).map((relationship) => [
      stringAt(record(relationship), '@_Id'),
      stringAt(record(relationship), '@_Target'),
    ]),
  )
}

function stringsOf(source: string): string[] {
  const root = objectAt(parseXml(source), 'sst')
  return asArray(root.si).map((item) => textContent(item))
}

function readText(archive: RawZipArchive, path: string): string {
  return new TextDecoder().decode(extractRawZipEntry(archive, path))
}

function parseXml(source: string): unknown {
  return xml.parse(source)
}

function sheetFor(sessionId: string, sheetId: string): SheetSession {
  const sheet = sessionFor(sessionId).sheets.find((candidate) => candidate.id === sheetId)
  if (!sheet) throw new Error('Unknown worksheet.')
  return sheet
}

function sessionFor(sessionId: string): Session {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Unknown workbook session.')
  return session
}

function validateRange(range: CellRange, sheet: SheetSession): void {
  if (
    !Number.isInteger(range.startRow) ||
    !Number.isInteger(range.endRow) ||
    !Number.isInteger(range.startColumn) ||
    !Number.isInteger(range.endColumn) ||
    range.startRow < 0 ||
    range.startColumn < 0 ||
    range.startRow > range.endRow ||
    range.startColumn > range.endColumn
  )
    throw new Error('Range boundaries are invalid.')
  if (
    (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) >
    MAX_RANGE_CELLS
  )
    throw new Error(`Range exceeds ${MAX_RANGE_CELLS} cells.`)
  if (range.endRow >= sheet.rowCount || range.endColumn >= sheet.columnCount)
    throw new Error('Range is outside the worksheet.')
}

function resolveWorkbookTarget(target: string): string {
  if (target.startsWith('/') || target.includes('..'))
    throw new Error('Workbook contains an unsafe worksheet path.')
  return `xl/${target.replace(/^\.\//, '')}`
}

function cellValue(
  type: string,
  rawValue: string | undefined,
  inline: string | undefined,
  sharedStrings: readonly string[],
): string | number | boolean | null {
  if (type === 'inlineStr') return inline === undefined ? '' : decodeXml(inline)
  if (type === 's') return sharedStrings[Number(rawValue)] ?? ''
  if (type === 'b') return rawValue === '1'
  if (rawValue === undefined) return null
  if (type === 'str' || type === 'e') return decodeXml(rawValue)
  const numeric = Number(rawValue)
  return Number.isFinite(numeric) ? numeric : decodeXml(rawValue)
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textContent).join('')
  if (!value || typeof value !== 'object') return ''
  return Object.entries(value)
    .filter(([key]) => !key.startsWith('@_'))
    .map(([, child]) => textContent(child))
    .join('')
}

function tagText(source: string, tag: string): string | undefined {
  const matched = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(source)
  return matched?.[1] === undefined ? undefined : matched[1].replace(/<[^>]+>/g, '')
}

function attributes(source: string): Record<string, string> {
  return Object.fromEntries(
    [...source.matchAll(/([:\w-]+)="([^"]*)"/g)].map((match) => [match[1]!, decodeXml(match[2]!)]),
  )
}

function cellAddress(reference: string): { row: number; column: number } | null {
  const match = /^\$?([A-Z]+)\$?(\d+)$/.exec(reference)
  if (!match) return null
  const column =
    [...match[1]!].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1
  return { row: Number(match[2]) - 1, column }
}

function rangeAddress(reference: string): CellArea | null {
  const [start, end = start] = reference.split(':')
  const startCell = start ? cellAddress(start) : null
  const endCell = end ? cellAddress(end) : null
  return startCell && endCell
    ? {
        startRow: startCell.row,
        startColumn: startCell.column,
        endRow: endCell.row,
        endColumn: endCell.column,
      }
    : null
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function objectAt(value: unknown, key: string): Record<string, unknown> {
  return record(record(value)[key])
}
function stringAt(value: Record<string, unknown>, key: string): string {
  const found = value[key]
  return typeof found === 'string' || typeof found === 'number' ? String(found) : ''
}
function asArray(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}
function optionalNumber(value: string | undefined): number | undefined {
  const number = Number(value)
  return value !== undefined && Number.isFinite(number) ? number : undefined
}
function numericAttribute(
  attributes: Record<string, string>,
  name: string,
  fallback: number,
): number {
  return optionalNumber(attributes[name]) ?? fallback
}
function truthy(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}
function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}
function inRange(row: number, column: number, range: CellRange): boolean {
  return (
    row >= range.startRow &&
    row <= range.endRow &&
    column >= range.startColumn &&
    column <= range.endColumn
  )
}
function overlaps(area: CellArea, range: CellRange): boolean {
  return (
    area.startRow <= range.endRow &&
    area.endRow >= range.startRow &&
    area.startColumn <= range.endColumn &&
    area.endColumn >= range.startColumn
  )
}
function toManifest(entry: RawZipArchive['entries'][number]): {
  name: string
  crc32: number
  compressedSize: number
  uncompressedSize: number
} {
  return {
    name: entry.name,
    crc32: entry.crc32,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
  }
}
function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name)
}
function emptyAnchor(): {
  fromRow: number
  fromColumn: number
  toRow: number
  toColumn: number
  fromRowOffset: number
  fromColumnOffset: number
  toRowOffset: number
  toColumnOffset: number
} {
  return {
    fromRow: 0,
    fromColumn: 0,
    toRow: 0,
    toColumn: 0,
    fromRowOffset: 0,
    fromColumnOffset: 0,
    toRowOffset: 0,
    toColumnOffset: 0,
  }
}
function mimeFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  return extension === 'png'
    ? 'image/png'
    : extension === 'jpg' || extension === 'jpeg'
      ? 'image/jpeg'
      : extension === 'gif'
        ? 'image/gif'
        : extension === 'svg'
          ? 'image/svg+xml'
          : 'application/octet-stream'
}
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
function failure(requestId: string, code: string, message: string): ArchiveResponseEnvelope {
  return { version: 1, requestId, ok: false, error: { code, message } }
}

if (typeof document === 'undefined' && typeof self !== 'undefined') {
  self.onmessage = (event: MessageEvent<ArchiveRequestEnvelope>) => {
    void processArchiveRequest(event.data).then((response) => self.postMessage(response))
  }
}
