import { z } from 'zod'

export const officeFileMediumSchema = z.enum([
  'document',
  'spreadsheet',
  'presentation',
  'pdf',
])

export const officeFileStateSchema = z.enum(['active', 'archived'])

const extensionByMedium = {
  document: '.docx',
  spreadsheet: '.xlsx',
  presentation: '.pptx',
  pdf: '.pdf',
} satisfies Record<OfficeFileMedium, string>

const mediaTypeByMedium = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  spreadsheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
} satisfies Record<OfficeFileMedium, string>

export const officeFileNameSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((name) => name === name.trim(), 'File name cannot start or end with whitespace')
  .refine((name) => !/[\u0000-\u001f\u007f/\\]/u.test(name), 'File name contains unsafe characters')
  .refine((name) => name !== '.' && name !== '..', 'File name is not allowed')
  .refine((name) => !/[. ]$/u.test(name), 'File name cannot end in a dot or space')

export const officeFileIdSchema = z.uuid()
export const officeFileVersionIdSchema = z.uuid()

export const officeFileSummarySchema = z.strictObject({
  id: officeFileIdSchema,
  name: officeFileNameSchema,
  medium: officeFileMediumSchema,
  state: officeFileStateSchema,
  versionId: officeFileVersionIdSchema,
  version: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const officeFileVersionSchema = z.strictObject({
  id: officeFileVersionIdSchema,
  fileId: officeFileIdSchema,
  version: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  note: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
})

export const officeFileSheetSchema = z.strictObject({
  id: z.string().min(1).describe('The sheetId edit_spreadsheet expects.'),
  name: z.string(),
})

export const officeFileDetailSchema = z.strictObject({
  file: officeFileSummarySchema,
  versions: z.array(officeFileVersionSchema),
  sheets: z.array(officeFileSheetSchema).optional(),
})

export const officeFileListResponseSchema = z.strictObject({
  files: z.array(officeFileSummarySchema),
})

export const officeFileResponseSchema = z.strictObject({ file: officeFileSummarySchema })
export const officeFileDetailResponseSchema = z.strictObject({ detail: officeFileDetailSchema })

export const officeFileMediumForName = (name: string): OfficeFileMedium | null => {
  const normalized = name.toLocaleLowerCase('en-US')
  if (normalized.endsWith(extensionByMedium.document)) return 'document'
  if (normalized.endsWith(extensionByMedium.spreadsheet)) return 'spreadsheet'
  if (normalized.endsWith(extensionByMedium.presentation)) return 'presentation'
  if (normalized.endsWith(extensionByMedium.pdf)) return 'pdf'
  return null
}

export const officeFileMediaType = (medium: OfficeFileMedium): string => mediaTypeByMedium[medium]

export const validateOfficeFileName = (name: string): {
  name: string
  medium: OfficeFileMedium
} => {
  const checked = officeFileNameSchema.safeParse(name.normalize('NFC'))
  if (!checked.success) throw new Error(z.prettifyError(checked.error))
  const parsed = checked.data
  const medium = officeFileMediumForName(parsed)
  if (!medium) throw new Error('EEVEE accepts DOCX, XLSX, PPTX, and PDF files')
  return { name: parsed, medium }
}

export type OfficeFileMedium = z.infer<typeof officeFileMediumSchema>
export type OfficeFileSummary = z.infer<typeof officeFileSummarySchema>
export type OfficeFileVersion = z.infer<typeof officeFileVersionSchema>
export type OfficeFileDetail = z.infer<typeof officeFileDetailSchema>
