import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { xlsxTable, officeFileText } from './office-file-content'

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

const workbook = async (
  sheets: ReadonlyArray<{ name: string; xml: string }>,
  sharedStrings?: string,
): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file(
    'xl/workbook.xml',
    `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheets>${sheets
        .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
        .join('')}</sheets></workbook>`,
  )
  sheets.forEach((sheet, index) => {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, `${XML}<worksheet><sheetData>${sheet.xml}</sheetData></worksheet>`)
  })
  if (sharedStrings) zip.file('xl/sharedStrings.xml', sharedStrings)
  return zip.generateAsync({ type: 'uint8array' })
}

describe('xlsxTable', () => {
  it('returns typed rows with shared strings, numbers, booleans, and cached formula results', async () => {
    const bytes = await workbook(
      [
        {
          name: 'Data',
          xml:
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42.5</v></c></row>' +
            '<row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2"><f>B1*2</f><v>85</v></c></row>',
        },
      ],
      `${XML}<sst><si><t>Revenue</t></si></sst>`,
    )
    const sheets = xlsxTable(bytes)
    expect(sheets).toHaveLength(1)
    expect(sheets[0]?.name).toBe('Data')
    expect(sheets[0]?.rows).toEqual([
      ['Revenue', 42.5],
      [true, 85],
    ])
  })

  it('keeps sparse cells as nulls and covers every named sheet', async () => {
    const bytes = await workbook([
      { name: 'First', xml: '<row r="2"><c r="C2"><v>7</v></c></row>' },
      { name: 'Second', xml: '' },
    ])
    const sheets = xlsxTable(bytes)
    expect(sheets.map(({ name }) => name)).toEqual(['First', 'Second'])
    expect(sheets[0]?.rows).toEqual([
      [null, null, null],
      [null, null, 7],
    ])
    expect(sheets[1]?.rows).toEqual([])
  })

  it('rejects bytes that are not a readable archive', () => {
    expect(() => xlsxTable(new Uint8Array([1, 2, 3]))).toThrowError(/readable Office archive/)
  })
})

describe('officeFileText', () => {
  it('renders spreadsheet text from the same table view', async () => {
    const bytes = await workbook(
      [{ name: 'Data', xml: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>3</v></c></row>' }],
      `${XML}<sst><si><t>Total</t></si></sst>`,
    )
    await expect(officeFileText('spreadsheet', bytes)).resolves.toBe('# Data\nTotal | 3')
  })
})
