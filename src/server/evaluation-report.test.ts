import { describe, expect, it } from 'vitest'
import type {
  CompleteEvaluationInput,
  EvaluationCaseDefinition,
} from '@/domain/evaluation'
import { buildEvaluationReport } from './evaluation-report'

const cases: EvaluationCaseDefinition[] = [
  {
    id: 'required-case',
    name: 'Required behavior',
    criticality: 'required',
    input: {},
    steps: [{ action: 'assert-count', selector: 'button', count: 1 }],
  },
  {
    id: 'informational-case',
    name: 'Informational behavior',
    criticality: 'informational',
    input: {},
    steps: [{ action: 'assert-text', selector: 'main', contains: 'Optional' }],
  },
]

const evidence = (
  versionId: string,
  informationalVerdict: 'pass' | 'fail',
): CompleteEvaluationInput['candidate'] => ({
  versionId,
  cases: cases.map((item) => ({
    caseId: item.id,
    steps: item.steps.map((step, index) => ({
      index,
      action: step.action,
      verdict: item.id === 'informational-case' ? informationalVerdict : 'pass',
      detail: 'Stored deterministic evidence.',
      durationMs: 5,
    })),
  })),
})

describe('buildEvaluationReport', () => {
  it('records informational regressions without failing the required verdict', () => {
    const candidateId = crypto.randomUUID()
    const baselineId = crypto.randomUUID()
    const report = buildEvaluationReport(candidateId, baselineId, cases, {
      candidate: evidence(candidateId, 'fail'),
      baseline: evidence(baselineId, 'pass'),
    })
    expect(report).toMatchObject({
      verdict: 'pass',
      regressions: ['informational-case'],
      candidate: { verdict: 'pass' },
      baseline: { verdict: 'pass' },
    })
  })

  it('rejects missing, duplicated, or reordered evidence', () => {
    const candidateId = crypto.randomUUID()
    expect(() =>
      buildEvaluationReport(candidateId, null, cases, {
        candidate: { versionId: candidateId, cases: [] },
        baseline: null,
      }),
    ).toThrow('cover every case once')

    const reordered = evidence(candidateId, 'pass')
    reordered.cases[0]?.steps.splice(0, 1, {
      index: 1,
      action: 'assert-count',
      verdict: 'pass',
      detail: 'Wrong step order.',
      durationMs: 1,
    })
    expect(() =>
      buildEvaluationReport(candidateId, null, cases, { candidate: reordered, baseline: null }),
    ).toThrow('does not match the suite')
  })
})
