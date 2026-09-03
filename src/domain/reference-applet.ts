import { z } from 'zod'

export const referenceAppletSlugSchema = z.enum(['meridian'])

export type ReferenceAppletSlug = z.infer<typeof referenceAppletSlugSchema>
