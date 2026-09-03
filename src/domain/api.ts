import { z } from 'zod'
import {
  appletVersionDefinitionSchema,
  appletMediumSchema,
  appletRunSchema,
  appletRunOutputSchema,
  appletStateSchema,
  correctionSchema,
  runStateSchema,
  versionStateSchema,
} from './applet'
import { inputDefinitionSchema } from './input'
import { qualityReportSchema } from './quality'
import { appletActionRequestSchema } from './applet-action'
import {
  evaluationExecutionSchema,
  evaluationPlanSchema,
  evaluationRunSchema,
  evaluationSuiteSchema,
} from './evaluation'

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
  evaluationCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const appletVersionSummarySchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
  state: versionStateSchema,
  note: z.string(),
  inputs: inputDefinitionSchema,
  definitionKind: z.enum(['react-app', 'video-editor']),
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
  evaluationSuites: z.array(evaluationSuiteSchema),
  evaluationRuns: z.array(evaluationRunSchema),
})

export const appletListResponseSchema = z.strictObject({
  applets: z.array(appletSummarySchema),
})

export const appletResponseSchema = z.strictObject({ applet: appletSummarySchema })
export const appletDetailResponseSchema = z.strictObject({ detail: appletDetailSchema })
export const appletVersionDetailResponseSchema = z.strictObject({
  version: appletVersionSummarySchema,
  definition: appletVersionDefinitionSchema,
})
export const appletVersionResponseSchema = z.strictObject({
  version: appletVersionSummarySchema,
  publishable: z.boolean(),
})
export const appletRunResponseSchema = z.strictObject({ run: appletRunSchema })
export const appletActionRequestResponseSchema = z.strictObject({
  request: appletActionRequestSchema,
})
export const appletActionRequestListResponseSchema = z.strictObject({
  requests: z.array(appletActionRequestSchema),
})
export const appletPreviewResponseSchema = z.strictObject({ preview: appletRunOutputSchema })
export const correctionResponseSchema = z.strictObject({ correction: correctionSchema })
export const evaluationSuiteResponseSchema = z.strictObject({ suite: evaluationSuiteSchema })
export const evaluationPlanResponseSchema = z.strictObject({ plan: evaluationPlanSchema })
export const evaluationExecutionResponseSchema = z.strictObject({
  execution: evaluationExecutionSchema,
})
export const evaluationRunResponseSchema = z.strictObject({ run: evaluationRunSchema })
export const workspaceSessionResponseSchema = z.strictObject({ workspaceId: z.uuid() })
export const workspaceLeaveResponseSchema = z.strictObject({ left: z.literal(true) })

export type AppletSummary = z.infer<typeof appletSummarySchema>
export type AppletVersionSummary = z.infer<typeof appletVersionSummarySchema>
export type AppletVersionDetail = z.infer<typeof appletVersionDetailResponseSchema>
export type RunSummary = z.infer<typeof runSummarySchema>
export type AppletDetail = z.infer<typeof appletDetailSchema>
