'use client'

import JSZip from 'jszip'

/**
 * Browser-side blank Office files for the Studio "new file" actions. DOCX and
 * PPTX reuse the engines' template builders; the workbook here is the minimal
 * valid single-sheet XLSX (the gateway's Node-only builder cannot run in the
 * browser).
 */

export type BlankFileKind = 'document' | 'spreadsheet' | 'presentation'

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

const blankXlsx = async (): Promise<Uint8Array> => {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`,
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export const blankFile = async (
  kind: BlankFileKind,
): Promise<{ name: string; bytes: Uint8Array }> => {
  switch (kind) {
    case 'document': {
      const { buildBlankDocx } = await import('@/office/engines/docx/blank')
      return { name: 'Untitled.docx', bytes: await buildBlankDocx() }
    }
    case 'spreadsheet':
      return { name: 'Untitled.xlsx', bytes: await blankXlsx() }
    case 'presentation': {
      const { createBlankPptx } = await import('@/office/engines/pptx/blank')
      return { name: 'Untitled.pptx', bytes: await createBlankPptx() }
    }
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}
