import { z } from 'zod'

export const qualityCheckSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  label: z.string().trim().min(1).max(100),
  verdict: z.enum(['pass', 'fail']),
  criticality: z.enum(['required', 'informational']),
  detail: z.string().trim().min(1).max(500),
})

export const qualityReportSchema = z.strictObject({
  evaluator: z.string().trim().min(1).max(100),
  verdict: z.enum(['pass', 'fail']),
  score: z.number().int().min(0).max(100),
  checks: z.array(qualityCheckSchema).min(1).max(100),
  evaluatedAt: z.iso.datetime({ offset: true }),
})

export type QualityCheck = z.infer<typeof qualityCheckSchema>
export type QualityReport = z.infer<typeof qualityReportSchema>

export const aggregateEvaluationVerdict = (
  checks: readonly QualityCheck[],
): QualityReport['verdict'] =>
  checks.some(({ criticality, verdict }) => criticality === 'required' && verdict === 'fail')
    ? 'fail'
    : 'pass'

export const isPublishableQuality = (report: QualityReport): boolean =>
  report.verdict === aggregateEvaluationVerdict(report.checks) && report.verdict === 'pass'
