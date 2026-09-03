import { z } from 'zod'
import { appletRunOutputSchema } from './applet'
import { jsonObjectSchema, jsonValueSchema } from './json'
import { qualityCheckSchema } from './quality'

const evaluationIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const selectorSchema = z.string().trim().min(1).max(240).refine((value) => !value.includes('\0'), {
  message: 'Selectors cannot contain null bytes',
})

const clickStepSchema = z
  .strictObject({
    action: z.literal('click'),
    selector: selectorSchema,
  })
  .describe('Click the first element matching a CSS selector.')

const fillStepSchema = z
  .strictObject({
    action: z.literal('fill'),
    selector: selectorSchema,
    value: z.string().max(10_000),
  })
  .describe('Type a value into an input or textarea.')

const pressStepSchema = z
  .strictObject({
    action: z.literal('press'),
    selector: selectorSchema,
    key: z.enum(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'Space']),
  })
  .describe('Press one key on a focused element.')

const waitStepSchema = z
  .strictObject({
    action: z.literal('wait'),
    milliseconds: z.number().int().min(0).max(2_000),
  })
  .describe('Pause; the whole suite may wait at most 20 seconds in total.')

const restartStepSchema = z
  .strictObject({ action: z.literal('restart') })
  .describe('Reload the applet with its stored state kept, to prove persistence.')

const assertTextStepSchema = z
  .strictObject({
    action: z.literal('assert-text'),
    selector: selectorSchema,
    contains: z.string().min(1).max(500),
  })
  .describe('Pass when the matched elements\' text contains the string.')

const assertCountStepSchema = z
  .strictObject({
    action: z.literal('assert-count'),
    selector: selectorSchema,
    count: z.number().int().nonnegative().max(1_000),
  })
  .describe('Pass when exactly count elements match.')

const assertValueStepSchema = z
  .strictObject({
    action: z.literal('assert-value'),
    selector: selectorSchema,
    value: z.string().max(10_000),
  })
  .describe('Pass when the first matched form control has this value.')

const assertStoredValueStepSchema = z
  .strictObject({
    action: z.literal('assert-stored-value'),
    key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/),
    value: jsonValueSchema,
  })
  .describe('Pass when the applet store holds this exact JSON value under key.')

export const evaluationStepSchema = z.discriminatedUnion('action', [
  clickStepSchema,
  fillStepSchema,
  pressStepSchema,
  waitStepSchema,
  restartStepSchema,
  assertTextStepSchema,
  assertCountStepSchema,
  assertValueStepSchema,
  assertStoredValueStepSchema,
])

export const evaluationCaseDefinitionSchema = z
  .strictObject({
    id: evaluationIdSchema.describe('Stable slug such as "order-survives-restart".'),
    name: z.string().trim().min(1).max(100).describe('What the scenario proves, in plain words.'),
    criticality: z
      .enum(['required', 'informational'])
      .describe('required failures block publishing; informational ones are reported only.'),
    input: jsonObjectSchema.describe('Run inputs for this scenario, keyed by input key.'),
    steps: z.array(evaluationStepSchema).min(1).max(40).describe('Actions and assertions in order; at least one assertion.'),
  })
  .superRefine(({ steps }, context) => {
    if (!steps.some(({ action }) => action.startsWith('assert-'))) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Every evaluation case needs at least one assertion',
      })
    }
  })

export const createEvaluationSuiteSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    cases: z.array(evaluationCaseDefinitionSchema).min(1).max(10),
  })
  .superRefine(({ cases }, context) => {
    const ids = cases.map(({ id }) => id)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['cases'], message: 'Case IDs must be unique' })
    }
    if (!cases.some(({ criticality }) => criticality === 'required')) {
      context.addIssue({
        code: 'custom',
        path: ['cases'],
        message: 'Every evaluation suite needs at least one required case',
      })
    }
    if (cases.reduce((total, item) => total + item.steps.length, 0) > 100) {
      context.addIssue({
        code: 'custom',
        path: ['cases'],
        message: 'One evaluation suite cannot exceed 100 total steps',
      })
    }
    if (
      cases.flatMap(({ steps }) => steps).reduce(
        (total, step) => total + (step.action === 'wait' ? step.milliseconds : 0),
        0,
      ) > 20_000
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cases'],
        message: 'One evaluation suite cannot wait for more than 20 seconds in total',
      })
    }
  })

export const startEvaluationSchema = z.strictObject({
  versionId: z.uuid(),
  suiteId: z.uuid().optional(),
})

export const evaluationStepActionSchema = z.enum([
  'click',
  'fill',
  'press',
  'wait',
  'restart',
  'assert-text',
  'assert-count',
  'assert-value',
  'assert-stored-value',
])

export const evaluationStepEvidenceSchema = z.strictObject({
  index: z.number().int().nonnegative().max(39),
  action: evaluationStepActionSchema,
  verdict: z.enum(['pass', 'fail']),
  detail: z.string().trim().min(1).max(500),
  durationMs: z.number().int().nonnegative().max(30_000),
})

export const evaluationCaseEvidenceInputSchema = z.strictObject({
  caseId: evaluationIdSchema,
  steps: z.array(evaluationStepEvidenceSchema).min(1).max(40),
})

export const evaluationVersionEvidenceInputSchema = z.strictObject({
  versionId: z.uuid(),
  cases: z.array(evaluationCaseEvidenceInputSchema).min(1).max(20),
})

export const completeEvaluationSchema = z.strictObject({
  candidate: evaluationVersionEvidenceInputSchema,
  baseline: evaluationVersionEvidenceInputSchema.nullable(),
})

export const failEvaluationSchema = z.strictObject({
  error: z.string().trim().min(1).max(500),
})

export const evaluationCaseResultSchema = z.strictObject({
  caseId: evaluationIdSchema,
  name: z.string(),
  criticality: z.enum(['required', 'informational']),
  verdict: z.enum(['pass', 'fail']),
  steps: z.array(evaluationStepEvidenceSchema),
})

export const evaluationVersionResultSchema = z.strictObject({
  versionId: z.uuid(),
  verdict: z.enum(['pass', 'fail']),
  cases: z.array(evaluationCaseResultSchema),
})

export const evaluationReportSchema = z.strictObject({
  verdict: z.enum(['pass', 'fail']),
  candidate: evaluationVersionResultSchema,
  baseline: evaluationVersionResultSchema.nullable(),
  regressions: z.array(evaluationIdSchema),
  checks: z.array(qualityCheckSchema),
})

export const evaluationRunStateSchema = z.enum(['running', 'passed', 'failed'])

export const evaluationSuiteSchema = z.strictObject({
  id: z.uuid(),
  appletId: z.uuid(),
  revision: z.number().int().positive(),
  name: z.string(),
  cases: z.array(evaluationCaseDefinitionSchema),
  createdAt: z.iso.datetime({ offset: true }),
})

export const evaluationRunSchema = z.strictObject({
  id: z.uuid(),
  appletId: z.uuid(),
  candidateVersionId: z.uuid(),
  baselineVersionId: z.uuid().nullable(),
  suiteId: z.uuid(),
  state: evaluationRunStateSchema,
  report: evaluationReportSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  leaseExpiresAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
})

export const evaluationExecutionSchema = z.strictObject({
  caseId: evaluationIdSchema,
  output: appletRunOutputSchema,
})

export const evaluationTargetSchema = z.enum(['candidate', 'baseline'])

export const evaluationPlanSchema = z.strictObject({
  run: evaluationRunSchema,
  suite: evaluationSuiteSchema,
})

export type EvaluationStep = z.infer<typeof evaluationStepSchema>
export type EvaluationCaseDefinition = z.infer<typeof evaluationCaseDefinitionSchema>
export type CreateEvaluationSuiteInput = z.infer<typeof createEvaluationSuiteSchema>
export type StartEvaluationInput = z.infer<typeof startEvaluationSchema>
export type CompleteEvaluationInput = z.infer<typeof completeEvaluationSchema>
export type EvaluationCaseEvidenceInput = z.infer<typeof evaluationCaseEvidenceInputSchema>
export type EvaluationVersionEvidenceInput = z.infer<typeof evaluationVersionEvidenceInputSchema>
export type EvaluationStepEvidence = z.infer<typeof evaluationStepEvidenceSchema>
export type EvaluationCaseResult = z.infer<typeof evaluationCaseResultSchema>
export type EvaluationVersionResult = z.infer<typeof evaluationVersionResultSchema>
export type EvaluationReport = z.infer<typeof evaluationReportSchema>
export type EvaluationSuite = z.infer<typeof evaluationSuiteSchema>
export type EvaluationRun = z.infer<typeof evaluationRunSchema>
export type EvaluationExecution = z.infer<typeof evaluationExecutionSchema>
export type EvaluationTarget = z.infer<typeof evaluationTargetSchema>
export type EvaluationPlan = z.infer<typeof evaluationPlanSchema>
