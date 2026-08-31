import { describe, expect, it } from 'vitest'
import { aggregateEvaluationVerdict, isPublishableQuality, type QualityReport } from './quality'

const report = (verdict: QualityReport['verdict']): QualityReport => ({
  evaluator: 'test@1',
  verdict,
  score: 100,
  checks: [
    {
      id: 'required-check',
      label: 'Required check',
      verdict: 'fail',
      criticality: 'required',
      detail: 'This required check failed.',
    },
  ],
  evaluatedAt: '2026-08-26T12:00:00.000Z',
})

describe('evaluation verdict aggregation', () => {
  it('fails when any required check fails', () => {
    expect(aggregateEvaluationVerdict(report('fail').checks)).toBe('fail')
  })

  it('does not trust an inconsistent stored report verdict or its score', () => {
    expect(isPublishableQuality(report('pass'))).toBe(false)
  })
})
