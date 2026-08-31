import { z } from 'zod'
import { officeFileVersionIdSchema } from './office-file'

export const sensitiveFindingTypeSchema = z.enum([
  'email',
  'phone',
  'government-id',
  'payment-card',
])

export const sensitiveFindingSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  type: sensitiveFindingTypeSchema,
  masked: z.string().min(1).max(160),
  part: z.string().min(1).max(160),
  occurrence: z.number().int().positive(),
})

export const documentReviewSchema = z.strictObject({
  fileId: z.uuid(),
  versionId: officeFileVersionIdSchema,
  supported: z.boolean(),
  limitation: z.string().min(1).max(500),
  findings: z.array(sensitiveFindingSchema).max(250),
})

export const applyDocumentRedactionsSchema = z.strictObject({
  baseVersionId: officeFileVersionIdSchema,
  findingIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(250),
})

export const documentReviewResponseSchema = z.strictObject({ review: documentReviewSchema })

export type SensitiveFinding = z.infer<typeof sensitiveFindingSchema>
export type DocumentReview = z.infer<typeof documentReviewSchema>
export type ApplyDocumentRedactionsInput = z.infer<typeof applyDocumentRedactionsSchema>
