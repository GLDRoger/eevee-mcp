import { z } from 'zod'

export const MISSION_PLAN_EVENT = 'eevee:plan'

const stepIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)

export const missionStepStatusSchema = z.enum(['pending', 'active', 'done', 'failed'])

export const missionPlanSchema = z.strictObject({
  goal: z.string().trim().min(1).max(200),
  steps: z
    .array(
      z.strictObject({
        id: stepIdSchema,
        title: z.string().trim().min(1).max(120),
        status: missionStepStatusSchema,
        note: z.string().trim().max(200).nullable(),
      }),
    )
    .min(1)
    .max(12)
    .superRefine((steps, context) => {
      const ids = steps.map(({ id }) => id)
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: 'custom', message: 'Plan step ids must be unique' })
      }
    }),
  updatedAt: z.iso.datetime({ offset: true }),
})

export const shareMissionPlanSchema = z.strictObject({
  goal: z.string().trim().min(1).max(200),
  steps: z
    .array(z.strictObject({ id: stepIdSchema, title: z.string().trim().min(1).max(120) }))
    .min(1)
    .max(12),
})

export const updateMissionStepSchema = z.strictObject({
  stepId: stepIdSchema,
  status: missionStepStatusSchema,
  note: z.string().trim().max(200).optional(),
})

export type MissionPlan = z.infer<typeof missionPlanSchema>
export type MissionStepStatus = z.infer<typeof missionStepStatusSchema>
