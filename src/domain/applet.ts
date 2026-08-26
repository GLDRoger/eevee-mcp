import { z } from 'zod'
import { inputDefinitionSchema } from './input'
import { jsonObjectSchema, jsonValueSchema } from './json'
import { qualityReportSchema } from './quality'

export const appletMediumSchema = z.enum([
  'web-app',
  'document',
  'spreadsheet',
  'presentation',
  'pdf',
  'workflow',
  'image',
  'video',
])

export const appletStateSchema = z.enum(['active', 'archived'])
export const versionStateSchema = z.enum(['draft', 'approved', 'rejected'])
export const runStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed'])
export const correctionStateSchema = z.enum(['proposed', 'applied', 'dismissed'])

export const webAppDefinitionSchema = z.strictObject({
  kind: z.literal('web-app'),
  html: z.string().min(1).max(1_500_000),
})

export const appletVersionDefinitionSchema = z.discriminatedUnion('kind', [
  webAppDefinitionSchema,
])

export const createAppletSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  medium: appletMediumSchema,
})

export const createVersionSchema = z.strictObject({
  note: z.string().trim().min(1).max(240),
  inputs: inputDefinitionSchema,
  definition: appletVersionDefinitionSchema,
})

export const createRunSchema = z.strictObject({ input: jsonObjectSchema })
export const completeRunSchema = z.strictObject({ channel: z.uuid() })
export const failRunSchema = z.strictObject({
  channel: z.uuid(),
  error: z.string().trim().min(1).max(500),
})

export const createCorrectionSchema = z.strictObject({
  instruction: z.string().trim().min(1).max(2_000),
  observedIssue: z.string().trim().min(1).max(2_000),
  desiredOutcome: z.string().trim().min(1).max(2_000),
})

export const writeAppletValueSchema = z.strictObject({
  key: z.string().min(1).max(128),
  value: jsonValueSchema,
})

export const appletSchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  description: z.string(),
  medium: appletMediumSchema,
  state: appletStateSchema,
  activeVersionId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const appletVersionSchema = z.strictObject({
  id: z.uuid(),
  appletId: z.uuid(),
  version: z.number().int().positive(),
  state: versionStateSchema,
  note: z.string(),
  inputs: inputDefinitionSchema,
  definition: appletVersionDefinitionSchema,
  qualityReport: qualityReportSchema,
  createdAt: z.iso.datetime({ offset: true }),
})

export const webAppRunOutputSchema = z.strictObject({
  kind: z.literal('web-app'),
  html: z.string(),
  channel: z.uuid(),
})

export const appletRunSchema = z.strictObject({
  id: z.uuid(),
  appletId: z.uuid(),
  appletVersionId: z.uuid(),
  state: runStateSchema,
  input: jsonObjectSchema,
  output: webAppRunOutputSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
})

export const correctionSchema = z.strictObject({
  id: z.uuid(),
  appletId: z.uuid(),
  runId: z.uuid(),
  state: correctionStateSchema,
  instruction: z.string(),
  observedIssue: z.string(),
  desiredOutcome: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
})

export type AppletMedium = z.infer<typeof appletMediumSchema>
export type AppletVersionDefinition = z.infer<typeof appletVersionDefinitionSchema>
export type CreateAppletInput = z.infer<typeof createAppletSchema>
export type CreateVersionInput = z.infer<typeof createVersionSchema>
export type CreateRunInput = z.infer<typeof createRunSchema>
export type CompleteRunInput = z.infer<typeof completeRunSchema>
export type FailRunInput = z.infer<typeof failRunSchema>
export type CreateCorrectionInput = z.infer<typeof createCorrectionSchema>
export type Applet = z.infer<typeof appletSchema>
export type AppletVersion = z.infer<typeof appletVersionSchema>
export type AppletRun = z.infer<typeof appletRunSchema>
export type Correction = z.infer<typeof correctionSchema>
export type WebAppRunOutput = z.infer<typeof webAppRunOutputSchema>
