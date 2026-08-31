import { describe, expect, it } from 'vitest'
import {
  officeFileMediaType,
  officeFileMediumForName,
  validateOfficeFileName,
} from './office-file'

describe('office file identity', () => {
  it('maps the four supported file formats', () => {
    expect(officeFileMediumForName('Board.PPTX')).toBe('presentation')
    expect(officeFileMediumForName('Model.xlsx')).toBe('spreadsheet')
    expect(officeFileMediumForName('Brief.docx')).toBe('document')
    expect(officeFileMediumForName('Signed.pdf')).toBe('pdf')
    expect(officeFileMediaType('document')).toContain('wordprocessingml')
  })

  it('rejects path-like, ambiguous, and unsupported names', () => {
    expect(() => validateOfficeFileName('../private.docx')).toThrow('unsafe')
    expect(() => validateOfficeFileName('report.docx ')).toThrow('whitespace')
    expect(() => validateOfficeFileName('report.doc')).toThrow('DOCX, XLSX, PPTX, and PDF')
  })
})
