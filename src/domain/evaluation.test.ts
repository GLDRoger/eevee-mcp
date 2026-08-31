import { describe, expect, it } from 'vitest'
import { createEvaluationSuiteSchema, type EvaluationCaseDefinition } from './evaluation'

const requiredCase: EvaluationCaseDefinition = {
  id: 'add-task',
  name: 'Add one task',
  criticality: 'required',
  input: { project_name: 'Launch' },
  steps: [
    { action: 'fill', selector: '#task', value: 'Ship' },
    { action: 'click', selector: 'button[type="submit"]' },
    { action: 'assert-text', selector: 'main', contains: 'Ship' },
  ],
}

describe('evaluation suite schema', () => {
  it('accepts a bounded behavioral case with an assertion', () => {
    expect(createEvaluationSuiteSchema.parse({ name: 'Task behavior', cases: [requiredCase] }))
      .toMatchObject({ name: 'Task behavior', cases: [{ id: 'add-task' }] })
  })

  it('requires unique case IDs, one required case, and assertions', () => {
    expect(() =>
      createEvaluationSuiteSchema.parse({
        name: 'Invalid suite',
        cases: [
          { ...requiredCase, criticality: 'informational', steps: requiredCase.steps.slice(0, 2) },
          { ...requiredCase, criticality: 'informational' },
        ],
      }),
    ).toThrow()
  })

  it('rejects oversized waits and unsafe selector strings', () => {
    expect(() =>
      createEvaluationSuiteSchema.parse({
        name: 'Invalid actions',
        cases: [
          {
            ...requiredCase,
            steps: [
              { action: 'wait', milliseconds: 2_001 },
              { action: 'assert-count', selector: 'button\0', count: 1 },
            ],
          },
        ],
      }),
    ).toThrow()
  })
})
