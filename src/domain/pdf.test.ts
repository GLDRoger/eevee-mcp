import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { applyPdfEdit } from './pdf'

const twoPagePdf = async (): Promise<Uint8Array> => {
  const document = await PDFDocument.create()
  document.addPage([300, 400])
  document.addPage([500, 600])
  return document.save()
}

describe('applyPdfEdit', () => {
  it('rotates and removes pages without mutating the source bytes', async () => {
    const source = await twoPagePdf()
    const before = Uint8Array.from(source)
    const rotated = await applyPdfEdit(source, { type: 'rotate', pageIndex: 1, quarterTurns: 1 })
    expect(source).toEqual(before)
    const rotatedDocument = await PDFDocument.load(rotated)
    expect(rotatedDocument.getPage(1).getRotation().angle).toBe(90)

    const reduced = await applyPdfEdit(rotated, { type: 'delete', pageIndex: 0 })
    expect((await PDFDocument.load(reduced)).getPageCount()).toBe(1)
  })

  it('rejects invalid page operations and an empty result', async () => {
    const source = await twoPagePdf()
    await expect(applyPdfEdit(source, { type: 'rotate', pageIndex: 2, quarterTurns: 1 }))
      .rejects.toThrow('does not exist')
    const onePage = await applyPdfEdit(source, { type: 'delete', pageIndex: 1 })
    await expect(applyPdfEdit(onePage, { type: 'delete', pageIndex: 0 }))
      .rejects.toThrow('at least one page')
  })
})
