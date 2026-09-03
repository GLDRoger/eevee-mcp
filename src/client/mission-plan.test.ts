// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MISSION_PLAN_EVENT } from '@/domain/mission-plan'
import {
  clearMissionPlan,
  readMissionPlan,
  shareMissionPlan,
  updateMissionStep,
} from './mission-plan'

describe('mission plan', () => {
  afterEach(() => {
    clearMissionPlan()
    vi.restoreAllMocks()
  })

  it('shares a plan, tracks one active step, and broadcasts every change', () => {
    const events: unknown[] = []
    const listen = (event: Event) => events.push((event as CustomEvent).detail)
    window.addEventListener(MISSION_PLAN_EVENT, listen)

    const shared = shareMissionPlan({
      goal: 'Close August',
      steps: [
        { id: 'import', title: 'Import the statement' },
        { id: 'resolve', title: 'Resolve findings' },
      ],
    })
    expect(shared.steps.map(({ status }) => status)).toEqual(['pending', 'pending'])

    updateMissionStep({ stepId: 'import', status: 'active' })
    const moved = updateMissionStep({ stepId: 'resolve', status: 'active', note: 'two open' })
    expect(moved.steps).toMatchObject([
      { id: 'import', status: 'pending' },
      { id: 'resolve', status: 'active', note: 'two open' },
    ])

    updateMissionStep({ stepId: 'resolve', status: 'done' })
    expect(readMissionPlan()?.steps[1]).toMatchObject({ status: 'done', note: 'two open' })
    expect(events).toHaveLength(4)
    window.removeEventListener(MISSION_PLAN_EVENT, listen)
  })

  it('rejects updates without a plan or against unknown steps', () => {
    expect(() => updateMissionStep({ stepId: 'x', status: 'done' })).toThrow(
      'No plan is shared',
    )
    shareMissionPlan({ goal: 'g', steps: [{ id: 'a', title: 'A' }] })
    expect(() => updateMissionStep({ stepId: 'b', status: 'done' })).toThrow(
      'has no step b',
    )
    expect(() =>
      shareMissionPlan({
        goal: 'g',
        steps: [
          { id: 'a', title: 'A' },
          { id: 'a', title: 'B' },
        ],
      }),
    ).toThrow('unique')
  })
})
