import { unzipSync } from 'fflate'

const decoder = new TextDecoder()

const xmlOf = (archive: Record<string, Uint8Array>, path: string): Document => {
  const bytes = archive[path]
  if (!bytes) throw new Error(`Attachment is missing ${path}`)
  const document = new DOMParser().parseFromString(decoder.decode(bytes), 'application/xml')
  if (document.querySelector('parsererror'))
    throw new Error(`Attachment contains invalid XML in ${path}`)
  return document
}

const textOf = (node: Element): string =>
  [...node.getElementsByTagName('*')]
    .filter((child) => child.localName === 't')
    .map((child) => child.textContent ?? '')
    .join('')

const numberedPath = (path: string): number => Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0)

export const pptxText = (bytes: Uint8Array): string => {
  const archive = unzipSync(bytes)
  return Object.keys(archive)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((left, right) => numberedPath(left) - numberedPath(right))
    .map((path) => {
      const document = xmlOf(archive, path)
      const lines = [...document.getElementsByTagName('*')]
        .filter((element) => element.localName === 'p')
        .map(textOf)
        .filter((line) => line.trim().length > 0)
      return [`## Slide ${numberedPath(path)}`, ...lines].join('\n')
    })
    .join('\n\n')
}

const cellReferenceColumn = (reference: string): number => {
  let column = 0
  for (const character of reference.toUpperCase()) {
    if (character < 'A' || character > 'Z') break
    column = column * 26 + character.charCodeAt(0) - 64
  }
  return Math.max(0, column - 1)
}

const directChild = (element: Element, name: string): Element | undefined =>
  [...element.children].find((child) => child.localName === name)

const sharedStringsOf = (archive: Record<string, Uint8Array>): string[] => {
  if (!archive['xl/sharedStrings.xml']) return []
  return [...xmlOf(archive, 'xl/sharedStrings.xml').getElementsByTagName('*')]
    .filter((element) => element.localName === 'si')
    .map(textOf)
}

const sheetNamesOf = (archive: Record<string, Uint8Array>): string[] => {
  if (!archive['xl/workbook.xml']) return []
  return [...xmlOf(archive, 'xl/workbook.xml').getElementsByTagName('*')]
    .filter((element) => element.localName === 'sheet')
    .map((element) => element.getAttribute('name') ?? '')
}

const cellValue = (cell: Element, sharedStrings: readonly string[]): string => {
  const type = cell.getAttribute('t') ?? ''
  if (type === 'inlineStr') return textOf(cell)
  const raw = directChild(cell, 'v')?.textContent ?? ''
  if (type === 's') return sharedStrings[Number(raw)] ?? ''
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE'
  return raw
}

export const xlsxText = (bytes: Uint8Array): string => {
  const archive = unzipSync(bytes)
  const sharedStrings = sharedStringsOf(archive)
  const names = sheetNamesOf(archive)
  return Object.keys(archive)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .sort((left, right) => numberedPath(left) - numberedPath(right))
    .map((path, index) => {
      const document = xmlOf(archive, path)
      const lines = [...document.getElementsByTagName('*')]
        .filter((element) => element.localName === 'row')
        .map((row) => {
          const cells = [...row.children].filter((child) => child.localName === 'c')
          const values: string[] = []
          for (const cell of cells) {
            const column = cellReferenceColumn(cell.getAttribute('r') ?? '')
            while (values.length < column) values.push('')
            values[column] = cellValue(cell, sharedStrings)
          }
          return values.join(' | ').trimEnd()
        })
        .filter(Boolean)
      return [`# ${names[index] || `Sheet ${index + 1}`}`, ...lines].join('\n')
    })
    .join('\n\n')
}

export const pdfText = async (bytes: Uint8Array): Promise<string> => {
  // @ts-expect-error pdf.js worker build has no declarations and registers itself by side effect.
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = getDocument({ data: bytes.slice(), useSystemFonts: true, verbosity: 0 })
  const document = await loading.promise
  try {
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .filter(
            (item): item is (typeof content.items)[number] & { str: string; hasEOL: boolean } =>
              'str' in item,
          )
          .map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`)
          .join('')
          .trim(),
      )
      page.cleanup()
    }
    return pages.join('\n\n')
  } finally {
    await loading.destroy()
  }
}
