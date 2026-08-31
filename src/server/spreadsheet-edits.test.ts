import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { workbookFileSchema, type WorkbookSaveRequest } from '@/office/sheets/shared/desktop-api'
import { processArchiveRequest } from '@/office/sheets/archive/worker'
import { applyCellEditsToXlsx } from '@/office/sheets/gateway/xlsx-gateway'
import { applySpreadsheetSave } from './spreadsheet-edits'

const workbookBytes = async (): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Invoice" sheetId="1" r:id="rId1"/></sheets></workbook>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Description</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Service</t></is></c><c r="B2"><v>250</v></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>Total</t></is></c><c r="B3"><f>SUM(B2:B2)</f><v>250</v></c></row>' +
      '</sheetData></worksheet>',
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const twoSheetWorkbookBytes = async (): Promise<Uint8Array> => {
  const zip = await JSZip.loadAsync(await workbookBytes())
  zip.file(
    'xl/workbook.xml',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Inputs" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Calc" sheetId="2" r:id="rId2"/></sheets></workbook>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
  )
  zip.file(
    'xl/worksheets/sheet2.xml',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData><row r="1"><c r="A1"><f>Inputs!A1*2</f><v>2</v></c></row>' +
      '</sheetData></worksheet>',
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const saveRequest = (
  patch: Partial<WorkbookSaveRequest>,
): WorkbookSaveRequest => ({
  sessionId: crypto.randomUUID(),
  mode: 'save',
  edits: [],
  structuralOps: [],
  chartEdits: [],
  visualEdits: [],
  visualAdditions: [],
  tableAdditions: [],
  pivotAdditions: [],
  sheetOps: [],
  sheetOrder: [],
  filterStates: [],
  hyperlinkEdits: [],
  cfStates: [],
  dvStates: [],
  pageSetupStates: [],
  noteStates: [],
  formulaValues: [],
  pivotCacheRefreshPaths: [],
  pivotRefreshUpdates: [],
  sheetProtections: [],
  sparklineAdditions: [],
  definedNamesState: null,
  ...patch,
})

describe('spreadsheet save gateway', () => {
  it('persists a style-only ribbon edit and creates the missing stylesheet', async () => {
    const saved = await applySpreadsheetSave(
      await workbookBytes(),
      saveRequest({
        edits: [
          {
            sheetId: 'sheet-1',
            row: 1,
            column: 0,
            writeValue: false,
            value: null,
            style: { bold: true },
          },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(saved.bytes)
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('text')
    const styles = await zip.file('xl/styles.xml')!.async('text')

    expect(sheet).toMatch(/<c\b(?=[^>]*\br="A2")(?=[^>]*\bs="1")[^>]*>/)
    expect(styles).toContain('<b/>')
    expect(saved.touchedEntries).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'xl/_rels/workbook.xml.rels',
        'xl/styles.xml',
        'xl/worksheets/sheet1.xml',
      ]),
    )
  })

  it('persists structural and page-view ribbon edits together', async () => {
    const saved = await applySpreadsheetSave(
      await workbookBytes(),
      saveRequest({
        structuralOps: [{ sheetId: 'sheet-1', kind: 'insert-rows', index: 1, count: 1 }],
        pageSetupStates: [{ sheetId: 'sheet-1', showGridlines: false }],
      }),
    )
    const zip = await JSZip.loadAsync(saved.bytes)
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('text')

    expect(sheet).toMatch(/<sheetView\b(?=[^>]*\bworkbookViewId="0")(?=[^>]*\bshowGridLines="0")[^>]*\/>/)
    expect(sheet).toContain('<row r="3"><c r="A3"')
    expect(sheet).toContain('<row r="4"><c r="A4"')
    expect(sheet).toContain('<f>SUM(B3:B3)</f>')
    const reopened = await processArchiveRequest({
      version: 1,
      requestId: crypto.randomUUID(),
      command: 'open',
      bytes: saved.bytes,
      name: 'edited.xlsx',
    })
    expect(reopened.ok).toBe(true)
    expect(
      workbookFileSchema.omit({ sha256: true }).parse(reopened.result).sheets[0]?.showGridLines,
    ).toBe(false)
  })

  it('updates cached formula values on a sheet with no other edits', async () => {
    const saved = await applySpreadsheetSave(
      await twoSheetWorkbookBytes(),
      saveRequest({
        edits: [
          {
            sheetId: 'sheet-1',
            row: 0,
            column: 0,
            writeValue: true,
            value: 2,
          },
        ],
        formulaValues: [{ sheetId: 'sheet-2', row: 0, column: 0, value: 4 }],
      }),
    )
    const zip = await JSZip.loadAsync(saved.bytes)
    const calc = await zip.file('xl/worksheets/sheet2.xml')!.async('text')

    expect(calc).toContain('<f>Inputs!A1*2</f><v>4</v>')
    expect(saved.touchedEntries).toContain('xl/worksheets/sheet2.xml')
  })

  it('fails when formula values name an unknown sheet', async () => {
    await expect(
      applyCellEditsToXlsx(
        Buffer.from(await workbookBytes()),
        [],
        [],
        [],
        undefined,
        [],
        [],
        [],
        [],
        [],
        null,
        [],
        [],
        [{ sheetName: 'Missing', cells: [{ row: 0, column: 0, value: 1 }] }],
      ),
    ).rejects.toThrow('Sheet "Missing" was not found in workbook.xml.')
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)'])(
    'rejects unsafe external hyperlink target %s',
    async (target) => {
      await expect(
        applySpreadsheetSave(
          await workbookBytes(),
          saveRequest({
            hyperlinkEdits: [{ sheetId: 'sheet-1', row: 0, column: 0, target }],
          }),
        ),
      ).rejects.toThrow('External spreadsheet hyperlinks must use http, https, mailto, or tel')
    },
  )

  it('writes an allowed external hyperlink target', async () => {
    const saved = await applySpreadsheetSave(
      await workbookBytes(),
      saveRequest({
        hyperlinkEdits: [
          { sheetId: 'sheet-1', row: 0, column: 0, target: 'https://example.com/report' },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(saved.bytes)
    const rels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('text')

    expect(rels).toContain('Target="https://example.com/report" TargetMode="External"')
  })

  it('rejects a comments relationship that targets a non-comments part', async () => {
    const source = await JSZip.loadAsync(await workbookBytes())
    source.file(
      'xl/worksheets/_rels/sheet1.xml.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../styles.xml"/>' +
        '</Relationships>',
    )
    source.file(
      'xl/styles.xml',
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
    )

    await expect(
      applySpreadsheetSave(
        await source.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
        saveRequest({
          noteStates: [
            {
              sheetId: 'sheet-1',
              notes: [{ row: 0, column: 0, author: 'Agent', text: 'Hostile target' }],
            },
          ],
        }),
      ),
    ).rejects.toThrow(
      'The comments relationship target must resolve to an xl/comments*.xml part.',
    )
  })
})
