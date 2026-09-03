import {
  MISSION_PLAN_EVENT,
  missionPlanSchema,
  shareMissionPlanSchema,
  updateMissionStepSchema,
  type MissionPlan,
} from '@/domain/mission-plan'

let current: MissionPlan | null = null

const broadcast = (): void => {
  window.dispatchEvent(new CustomEvent(MISSION_PLAN_EVENT, { detail: current }))
}

export const readMissionPlan = (): MissionPlan | null => current

export const shareMissionPlan = (input: unknown): MissionPlan => {
  const parsed = shareMissionPlanSchema.parse(input)
  current = missionPlanSchema.parse({
    goal: parsed.goal,
    steps: parsed.steps.map((step) => ({ ...step, status: 'pending', note: null })),
    updatedAt: new Date().toISOString(),
  })
  broadcast()
  return current
}

export const updateMissionStep = (input: unknown): MissionPlan => {
  const parsed = updateMissionStepSchema.parse(input)
  if (!current) throw new Error('No plan is shared; call share_plan first')
  if (!current.steps.some(({ id }) => id === parsed.stepId)) {
    throw new Error(`The shared plan has no step ${parsed.stepId}`)
  }
  current = missionPlanSchema.parse({
    ...current,
    steps: current.steps.map((step) =>
      step.id === parsed.stepId
        ? {
            ...step,
            status: parsed.status,
            note: parsed.note !== undefined ? parsed.note : step.note,
          }
        : // One step active at a time keeps the strip honest: activating a
          // step demotes any earlier active step to pending.
          parsed.status === 'active' && step.status === 'active'
          ? { ...step, status: 'pending' }
          : step,
    ),
    updatedAt: new Date().toISOString(),
  })
  broadcast()
  return current
}

export const clearMissionPlan = (): void => {
  current = null
  broadcast()
}
