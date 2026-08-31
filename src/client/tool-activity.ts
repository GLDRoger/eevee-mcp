import { z } from 'zod'

export const TOOL_ACTIVITY_EVENT = 'eevee:tool-activity'

export const toolActivitySchema = z.strictObject({
  id: z.uuid(),
  tool: z.string().min(1).max(64),
  title: z.string().min(1).max(100),
  phase: z.enum(['started', 'succeeded', 'failed']),
  at: z.iso.datetime({ offset: true }),
  durationMs: z.number().int().min(0).nullable(),
  error: z.string().max(200).nullable(),
})

export type ToolActivity = z.infer<typeof toolActivitySchema>

export const emitToolActivity = (activity: ToolActivity): void => {
  window.dispatchEvent(new CustomEvent(TOOL_ACTIVITY_EVENT, { detail: activity }))
}
