import { z } from 'zod'
import {
  appletMediumSchema,
  appletRunSchema,
  webAppRunOutputSchema,
  appletStateSchema,
  correctionSchema,
  runStateSchema,
  versionStateSchema,
} from './applet'
import { inputDefinitionSchema } from './input'
import { qualityReportSchema } from './quality'

export const appletSummarySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  medium: appletMediumSchema,
  state: appletStateSchema,
  activeVersionId: z.uuid().nullable(),
  versionCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
  correctionCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const appletVersionSummarySchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
  state: versionStateSchema,
  note: z.string(),
  inputs: inputDefinitionSchema,
  definitionKind: z.literal('web-app'),
  qualityReport: qualityReportSchema,
  createdAt: z.iso.datetime({ offset: true }),
})

export const runSummarySchema = z.strictObject({
  id: z.uuid(),
  appletVersionId: z.uuid(),
  state: runStateSchema,
  createdAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
})

export const appletDetailSchema = z.strictObject({
  applet: appletSummarySchema,
  versions: z.array(appletVersionSummarySchema),
  runs: z.array(runSummarySchema),
  corrections: z.array(correctionSchema),
})

export const appletListResponseSchema = z.strictObject({
  applets: z.array(appletSummarySchema),
})

export const appletResponseSchema = z.strictObject({ applet: appletSummarySchema })
export const appletDetailResponseSchema = z.strictObject({ detail: appletDetailSchema })
export const appletVersionResponseSchema = z.strictObject({
  version: appletVersionSummarySchema,
  publishable: z.boolean(),
})
export const appletRunResponseSchema = z.strictObject({ run: appletRunSchema })
export const appletPreviewResponseSchema = z.strictObject({ preview: webAppRunOutputSchema })
export const correctionResponseSchema = z.strictObject({ correction: correctionSchema })
export const workspaceSessionResponseSchema = z.strictObject({ workspaceId: z.uuid() })

export type AppletSummary = z.infer<typeof appletSummarySchema>
export type AppletVersionSummary = z.infer<typeof appletVersionSummarySchema>
export type RunSummary = z.infer<typeof runSummarySchema>
export type AppletDetail = z.infer<typeof appletDetailSchema>
