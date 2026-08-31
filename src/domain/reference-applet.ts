import { z } from 'zod'

export const referenceAppletSlugSchema = z.enum(['sparkbench', 'fablecut'])

export type ReferenceAppletSlug = z.infer<typeof referenceAppletSlugSchema>
