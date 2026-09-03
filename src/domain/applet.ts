import { z } from 'zod'
import { appletActionDefinitionsSchema } from './applet-action'
import { inputDefinitionSchema } from './input'
import { jsonObjectSchema, jsonValueSchema } from './json'
import { qualityReportSchema } from './quality'
import { MAX_REACT_APP_FILES, reactAppDefinitionSchema, reactAppFileSchema } from './react-app'
import { videoEditorDefinitionSchema, videoProjectSchema } from './video-editor'

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

/**
 * Media an agent or person can create an applet for today. The full medium
 * enum above stays for storage and future executors, but creation is limited
 * to media with a working executor so nobody mints a draft that can never
 * run. Widen this list as executors land.
 */
export const creatableAppletMediumSchema = z.enum(['web-app', 'video'])

export const appletStateSchema = z.enum(['active', 'archived'])
export const versionStateSchema = z.enum(['draft', 'approved', 'rejected'])
export const runStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed'])
export const correctionStateSchema = z.enum(['proposed', 'applied', 'dismissed'])

export const appletVersionDefinitionSchema = z.discriminatedUnion('kind', [
  reactAppDefinitionSchema,
  videoEditorDefinitionSchema,
])

export const createAppletSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).describe('Short name shown in the Applet ledger.'),
  description: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe('What the applet is for, in one or two sentences.'),
  medium: creatableAppletMediumSchema.describe('web-app for a React app, video for an edit-decision-list editor.'),
})

export const createVersionSchema = z.strictObject({
  note: z.string().trim().min(1).max(240).describe('Changelog line for this version, shown in the version register.'),
  inputs: inputDefinitionSchema.describe('Typed inputs the person fills in before a run. Use [] when the applet takes none.'),
  definition: appletVersionDefinitionSchema,
  resolvesCorrections: z
    .array(z.uuid())
    .max(25)
    .optional()
    .describe('Ids of open correction proposals this version answers; they are marked applied.'),
})

/**
 * Delta form of version creation: start from an existing version's React
 * definition, replace or add the named files, drop the deleted paths, and
 * compile the merged result as a brand-new immutable version. Inputs and
 * actions default to the base version's values when omitted.
 */
export const reviseVersionSchema = z.strictObject({
  baseVersionId: z.uuid().describe('The version to start from; untouched files carry over.'),
  note: z.string().trim().min(1).max(240).describe('Changelog line for the new version.'),
  inputs: inputDefinitionSchema.optional().describe('Replace the typed inputs; omit to keep the base version\'s.'),
  changedFiles: z
    .array(reactAppFileSchema)
    .max(MAX_REACT_APP_FILES)
    .default([])
    .describe('Files to add or replace, by path.'),
  deletedPaths: z
    .array(z.string().min(1).max(200))
    .max(MAX_REACT_APP_FILES)
    .default([])
    .describe('Paths to drop from the base version.'),
  actions: appletActionDefinitionsSchema.optional().describe('Replace the declared actions; omit to keep the base version\'s.'),
  resolvesCorrections: z.array(z.uuid()).max(25).optional(),
})

export const createRunSchema = z.strictObject({
  input: jsonObjectSchema.describe('Values keyed by the published version\'s input keys.'),
})
export const completeRunSchema = z.strictObject({ channel: z.uuid() })
export const failRunSchema = z.strictObject({
  channel: z.uuid(),
  error: z.string().trim().min(1).max(500),
})

export const createCorrectionSchema = z.strictObject({
  instruction: z.string().trim().min(1).max(2_000).describe('What the person changed or asked for.'),
  observedIssue: z.string().trim().min(1).max(2_000).describe('What was wrong in the run output.'),
  desiredOutcome: z.string().trim().min(1).max(2_000).describe('What future runs should do instead.'),
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

export const videoRunOutputSchema = z.strictObject({
  kind: z.literal('video'),
  html: z.string(),
  channel: z.uuid(),
  project: videoProjectSchema,
})

export const appletRunOutputSchema = z.discriminatedUnion('kind', [
  webAppRunOutputSchema,
  videoRunOutputSchema,
])

export const appletRunSchema = z.strictObject({
  id: z.uuid(),
  appletId: z.uuid(),
  appletVersionId: z.uuid(),
  state: runStateSchema,
  input: jsonObjectSchema,
  output: appletRunOutputSchema.nullable(),
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
export type ReviseVersionInput = z.infer<typeof reviseVersionSchema>
export type CreateRunInput = z.infer<typeof createRunSchema>
export type CompleteRunInput = z.infer<typeof completeRunSchema>
export type FailRunInput = z.infer<typeof failRunSchema>
export type CreateCorrectionInput = z.infer<typeof createCorrectionSchema>
export type Applet = z.infer<typeof appletSchema>
export type AppletVersion = z.infer<typeof appletVersionSchema>
export type AppletRun = z.infer<typeof appletRunSchema>
export type Correction = z.infer<typeof correctionSchema>
export type WebAppRunOutput = z.infer<typeof webAppRunOutputSchema>
export type VideoRunOutput = z.infer<typeof videoRunOutputSchema>
export type AppletRunOutput = z.infer<typeof appletRunOutputSchema>
