import { z } from 'zod'
import { officeFileVersionIdSchema } from './office-file'

export const sensitiveFindingTypeSchema = z.enum([
  'email',
  'phone',
  'government-id',
  'payment-card',
])

export const sensitiveFindingIdSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const sensitiveFindingIdsSchema = z
  .array(sensitiveFindingIdSchema)
  .min(1)
  .max(250)
  .refine((ids) => new Set(ids).size === ids.length, 'Finding ids must be unique')

export const sensitiveFindingSchema = z.strictObject({
  id: sensitiveFindingIdSchema,
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
  findingIds: sensitiveFindingIdsSchema,
})

export const documentReviewResponseSchema = z.strictObject({ review: documentReviewSchema })

export type SensitiveFinding = z.infer<typeof sensitiveFindingSchema>
export type DocumentReview = z.infer<typeof documentReviewSchema>
export type ApplyDocumentRedactionsInput = z.infer<typeof applyDocumentRedactionsSchema>
