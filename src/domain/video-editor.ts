import { z } from 'zod'
import { appletActionDefinitionsSchema } from './applet-action'
import {
  MAX_REACT_APP_FILES,
  REACT_APP_ENTRY,
  reactAppFileSchema,
  validateReactSourceFiles,
} from './react-app'

const videoClipSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  label: z.string().trim().min(1).max(80),
  startMs: z.number().int().nonnegative().max(600_000),
  durationMs: z.number().int().min(100).max(120_000),
  track: z.number().int().min(0).max(7),
  tone: z.enum(['pine', 'vermilion', 'ochre', 'slate', 'paper']),
})

export const videoProjectSchema = z
  .strictObject({
    width: z.number().int().min(320).max(3840),
    height: z.number().int().min(180).max(2160),
    fps: z.number().int().min(12).max(60),
    durationMs: z.number().int().min(1_000).max(600_000),
    clips: z.array(videoClipSchema).min(1).max(64),
  })
  .superRefine((project, context) => {
    const ids = project.clips.map(({ id }) => id)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['clips'], message: 'Video clip ids must be unique' })
    }
    project.clips.forEach((clip, index) => {
      if (clip.startMs + clip.durationMs > project.durationMs) {
        context.addIssue({
          code: 'custom',
          path: ['clips', index, 'durationMs'],
          message: 'Every clip must end within the project duration',
        })
      }
    })
  })

export const videoEditorDefinitionSchema = z
  .strictObject({
    kind: z.literal('video-editor'),
    entry: z.literal(REACT_APP_ENTRY),
    files: z.array(reactAppFileSchema).min(1).max(MAX_REACT_APP_FILES),
    actions: appletActionDefinitionsSchema.default([]),
    project: videoProjectSchema,
  })
  .superRefine(({ files }, context) => validateReactSourceFiles(files, context))

export type VideoProject = z.infer<typeof videoProjectSchema>
export type VideoEditorDefinition = z.infer<typeof videoEditorDefinitionSchema>
