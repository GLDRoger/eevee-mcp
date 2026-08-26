import { z } from 'zod'

export const qualityCheckSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  label: z.string().trim().min(1).max(100),
  status: z.enum(['passed', 'warning', 'failed']),
  blocking: z.boolean(),
  detail: z.string().trim().min(1).max(500),
})

export const qualityReportSchema = z.strictObject({
  evaluator: z.string().trim().min(1).max(100),
  score: z.number().int().min(0).max(100),
  checks: z.array(qualityCheckSchema).min(1).max(100),
  evaluatedAt: z.iso.datetime({ offset: true }),
})

export type QualityCheck = z.infer<typeof qualityCheckSchema>
export type QualityReport = z.infer<typeof qualityReportSchema>

export const blockingFailureCount = (report: QualityReport): number =>
  report.checks.filter(({ blocking, status }) => blocking && status === 'failed').length

export const isPublishableQuality = (report: QualityReport): boolean =>
  blockingFailureCount(report) === 0 && report.score >= 70
