import { z } from 'zod'

export const referenceAppletSlugSchema = z.enum(['sparkbench'])

export type ReferenceAppletSlug = z.infer<typeof referenceAppletSlugSchema>
