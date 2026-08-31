import type {
  CompleteEvaluationInput,
  EvaluationCaseDefinition,
  EvaluationCaseEvidenceInput,
  EvaluationCaseResult,
  EvaluationReport,
  EvaluationVersionEvidenceInput,
  EvaluationVersionResult,
} from '@/domain/evaluation'
import { RequestFailure } from './http'

const evidenceByCase = (
  versionId: string,
  cases: readonly EvaluationCaseDefinition[],
  evidence: EvaluationVersionEvidenceInput,
): EvaluationVersionResult => {
  if (evidence.versionId !== versionId) {
    throw new RequestFailure(
      400,
      'evaluation_version_mismatch',
      'Evaluation evidence names the wrong version',
    )
  }
  const byId = new Map(evidence.cases.map((item) => [item.caseId, item]))
  if (byId.size !== evidence.cases.length || byId.size !== cases.length) {
    throw new RequestFailure(
      400,
      'evaluation_case_mismatch',
      'Evaluation evidence must cover every case once',
    )
  }
  const results = cases.map((definition): EvaluationCaseResult => {
    const item: EvaluationCaseEvidenceInput | undefined = byId.get(definition.id)
    if (!item || item.steps.length !== definition.steps.length) {
      throw new RequestFailure(
        400,
        'evaluation_step_mismatch',
        `${definition.id}: evidence must cover every step once`,
      )
    }
    item.steps.forEach((step, index) => {
      if (step.index !== index || step.action !== definition.steps[index]?.action) {
        throw new RequestFailure(
          400,
          'evaluation_step_mismatch',
          `${definition.id}: step ${index + 1} does not match the suite`,
        )
      }
    })
    return {
      caseId: definition.id,
      name: definition.name,
      criticality: definition.criticality,
      verdict: item.steps.every(({ verdict }) => verdict === 'pass') ? 'pass' : 'fail',
      steps: item.steps,
    }
  })
  return {
    versionId,
    verdict: results.some(
      ({ criticality, verdict }) => criticality === 'required' && verdict === 'fail',
    )
      ? 'fail'
      : 'pass',
    cases: results,
  }
}

export const buildEvaluationReport = (
  candidateVersionId: string,
  baselineVersionId: string | null,
  cases: readonly EvaluationCaseDefinition[],
  input: CompleteEvaluationInput,
): EvaluationReport => {
  const candidate = evidenceByCase(candidateVersionId, cases, input.candidate)
  let baseline: EvaluationVersionResult | null = null
  if (baselineVersionId) {
    if (!input.baseline) {
      throw new RequestFailure(
        400,
        'baseline_evidence_missing',
        'Baseline evidence is required',
      )
    }
    baseline = evidenceByCase(baselineVersionId, cases, input.baseline)
  } else if (input.baseline) {
    throw new RequestFailure(
      400,
      'baseline_evidence_unexpected',
      'This evaluation has no baseline',
    )
  }
  const baselineCases = new Map(baseline?.cases.map((item) => [item.caseId, item.verdict]) ?? [])
  const regressions = candidate.cases
    .filter(({ caseId, verdict }) => baselineCases.get(caseId) === 'pass' && verdict === 'fail')
    .map(({ caseId }) => caseId)
  return {
    verdict: candidate.verdict,
    candidate,
    baseline,
    regressions,
    checks: candidate.cases.map((item) => ({
      id: item.caseId,
      label: item.name,
      verdict: item.verdict,
      criticality: item.criticality,
      detail: `${item.steps.filter(({ verdict }) => verdict === 'pass').length} of ${item.steps.length} scenario steps passed.`,
    })),
  }
}
