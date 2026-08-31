import { degrees, PDFDocument } from 'pdf-lib'
import { z } from 'zod'
import { officeFileVersionIdSchema } from './office-file'

export const pdfEditSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('rotate'),
    pageIndex: z.number().int().nonnegative().max(10_000),
    quarterTurns: z.union([z.literal(-1), z.literal(1)]),
  }),
  z.strictObject({
    type: z.literal('delete'),
    pageIndex: z.number().int().nonnegative().max(10_000),
  }),
])

export const pdfEditRequestSchema = z.strictObject({
  baseVersionId: officeFileVersionIdSchema,
  edit: pdfEditSchema,
})

const normalizedRotation = (angle: number): number => ((angle % 360) + 360) % 360

const pageAt = (document: PDFDocument, pageIndex: number) => {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= document.getPageCount()) {
    throw new Error('The selected PDF page does not exist')
  }
  return document.getPage(pageIndex)
}

export const applyPdfEdit = async (bytes: Uint8Array, edit: PdfEdit): Promise<Uint8Array> => {
  const document = await PDFDocument.load(bytes, { updateMetadata: false })
  switch (edit.type) {
    case 'rotate': {
      const page = pageAt(document, edit.pageIndex)
      page.setRotation(degrees(normalizedRotation(page.getRotation().angle + edit.quarterTurns * 90)))
      break
    }
    case 'delete':
      pageAt(document, edit.pageIndex)
      if (document.getPageCount() === 1) throw new Error('A PDF must keep at least one page')
      document.removePage(edit.pageIndex)
      break
    default: {
      const unreachable: never = edit
      return unreachable
    }
  }
  return document.save()
}

export type PdfEdit = z.infer<typeof pdfEditSchema>
