'use client'

import { useEffect, useState } from 'react'
import {
  MISSION_PLAN_EVENT,
  missionPlanSchema,
  type MissionPlan,
} from '@/domain/mission-plan'

export function MissionPlanStrip() {
  const [plan, setPlan] = useState<MissionPlan | null>(null)

  useEffect(() => {
    const listen = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      if (event.detail === null) {
        setPlan(null)
        return
      }
      const parsed = missionPlanSchema.safeParse(event.detail)
      if (parsed.success) setPlan(parsed.data)
    }
    window.addEventListener(MISSION_PLAN_EVENT, listen)
    return () => window.removeEventListener(MISSION_PLAN_EVENT, listen)
  }, [])

  if (!plan) return null

  const done = plan.steps.filter(({ status }) => status === 'done').length

  return (
    <section className="mission-plan" aria-label="Agent plan">
      <header>
        <strong>{plan.goal}</strong>
        <span>
          {done}/{plan.steps.length}
        </span>
      </header>
      <ol>
        {plan.steps.map((step) => (
          <li key={step.id} className={`is-${step.status}`}>
            <span className="mission-mark" aria-hidden="true" />
            <div>
              <span className="mission-title">{step.title}</span>
              {step.note ? <span className="mission-note">{step.note}</span> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
