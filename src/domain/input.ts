import { z } from 'zod'
import type { JsonObject, JsonValue } from './json'

const inputKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const followsStep = (value: number, step: number, minimum = 0): boolean => {
  const position = (value - minimum) / step
  return Math.abs(position - Math.round(position)) <= 1e-9 * Math.max(1, Math.abs(position))
}
const inputBaseSchema = z.strictObject({
  key: inputKeySchema.describe('snake_case identifier used in run input and action input objects.'),
  label: z.string().trim().min(1).max(80).describe('Field label shown to the person.'),
  description: z.string().trim().min(1).max(240).describe('Help text under the field.'),
  required: z.boolean(),
})

const textInputSchema = inputBaseSchema
  .extend({
    kind: z.literal('text'),
    defaultValue: z.string().max(10_000).optional(),
    minLength: z.number().int().nonnegative().max(10_000).optional(),
    maxLength: z.number().int().positive().max(10_000).optional(),
  })
  .superRefine((field, context) => {
    if (
      field.minLength !== undefined &&
      field.maxLength !== undefined &&
      field.minLength > field.maxLength
    ) {
      context.addIssue({
        code: 'custom',
        path: ['maxLength'],
        message: 'Maximum length must be at least the minimum length',
      })
    }
    if (field.defaultValue !== undefined && field.minLength !== undefined && field.defaultValue.length < field.minLength) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Default text is shorter than the minimum length',
      })
    }
    if (field.defaultValue !== undefined && field.maxLength !== undefined && field.defaultValue.length > field.maxLength) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Default text is longer than the maximum length',
      })
    }
  })

const numberInputSchema = inputBaseSchema
  .extend({
    kind: z.literal('number'),
    defaultValue: z.number().finite().optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    step: z.number().positive().finite().optional(),
  })
  .superRefine((field, context) => {
    if (
      field.minimum !== undefined &&
      field.maximum !== undefined &&
      field.minimum > field.maximum
    ) {
      context.addIssue({
        code: 'custom',
        path: ['maximum'],
        message: 'Maximum must be at least the minimum',
      })
    }
    if (field.defaultValue !== undefined && field.minimum !== undefined && field.defaultValue < field.minimum) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Default number is below the minimum',
      })
    }
    if (field.defaultValue !== undefined && field.maximum !== undefined && field.defaultValue > field.maximum) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Default number is above the maximum',
      })
    }
    if (
      field.defaultValue !== undefined &&
      field.step !== undefined &&
      !followsStep(field.defaultValue, field.step, field.minimum)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'Default number does not follow the declared step',
      })
    }
  })

const booleanInputSchema = inputBaseSchema.extend({
  kind: z.literal('boolean'),
  defaultValue: z.boolean().optional(),
})

const choiceOptionSchema = z.strictObject({
  value: z.string().min(1).max(120),
  label: z.string().trim().min(1).max(120),
})

const choiceInputSchema = inputBaseSchema
  .extend({
    kind: z.literal('choice'),
    options: z.array(choiceOptionSchema).min(1).max(100),
    defaultValue: z.string().min(1).max(120).optional(),
  })
  .superRefine((field, context) => {
    const values = field.options.map(({ value }) => value)
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', path: ['options'], message: 'Choice values must be unique' })
    }
    if (field.defaultValue !== undefined && !values.includes(field.defaultValue)) {
      context.addIssue({
        code: 'custom',
        path: ['defaultValue'],
        message: 'The default choice must be one of the declared options',
      })
    }
  })

export const inputFieldSchema = z.discriminatedUnion('kind', [
  textInputSchema,
  numberInputSchema,
  booleanInputSchema,
  choiceInputSchema,
])

export const inputDefinitionSchema = z
  .array(inputFieldSchema)
  .max(24)
  .superRefine((fields, context) => {
    const keys = fields.map(({ key }) => key)
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', message: 'Input keys must be unique' })
    }
  })

export type InputField = z.infer<typeof inputFieldSchema>
export type InputDefinition = z.infer<typeof inputDefinitionSchema>

export interface InputIssue {
  key: string
  message: string
}

export type InputValidation =
  | { ok: true; values: JsonObject }
  | { ok: false; issues: readonly InputIssue[] }

type FieldValidation =
  | { ok: true; entry?: readonly [string, JsonValue] }
  | { ok: false; issue: InputIssue }

const missingValue = (field: InputField): FieldValidation => {
  if (field.defaultValue !== undefined) return { ok: true, entry: [field.key, field.defaultValue] }
  if (field.required) return { ok: false, issue: { key: field.key, message: 'This input is required' } }
  return { ok: true }
}

const validateField = (field: InputField, value: unknown): FieldValidation => {
  if (value === undefined || value === '') return missingValue(field)
  switch (field.kind) {
    case 'text': {
      if (typeof value !== 'string') {
        return { ok: false, issue: { key: field.key, message: 'Enter text' } }
      }
      if (field.minLength !== undefined && value.length < field.minLength) {
        return {
          ok: false,
          issue: { key: field.key, message: `Use at least ${field.minLength} characters` },
        }
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return {
          ok: false,
          issue: { key: field.key, message: `Use no more than ${field.maxLength} characters` },
        }
      }
      return { ok: true, entry: [field.key, value] }
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, issue: { key: field.key, message: 'Enter a number' } }
      }
      if (field.minimum !== undefined && value < field.minimum) {
        return { ok: false, issue: { key: field.key, message: `Use ${field.minimum} or more` } }
      }
      if (field.maximum !== undefined && value > field.maximum) {
        return { ok: false, issue: { key: field.key, message: `Use ${field.maximum} or less` } }
      }
      if (field.step !== undefined && !followsStep(value, field.step, field.minimum)) {
        return {
          ok: false,
          issue: { key: field.key, message: `Use increments of ${field.step}` },
        }
      }
      return { ok: true, entry: [field.key, value] }
    }
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true, entry: [field.key, value] }
        : { ok: false, issue: { key: field.key, message: 'Choose yes or no' } }
    case 'choice':
      return typeof value === 'string' && field.options.some((option) => option.value === value)
        ? { ok: true, entry: [field.key, value] }
        : { ok: false, issue: { key: field.key, message: 'Choose one of the offered values' } }
    default: {
      const unreachable: never = field
      return unreachable
    }
  }
}

export const validateAppletInputs = (
  definitionInput: InputDefinition,
  values: Readonly<Record<string, unknown>>,
): InputValidation => {
  const definition = inputDefinitionSchema.parse(definitionInput)
  const declaredKeys = new Set(definition.map(({ key }) => key))
  const unknownIssues = Object.keys(values)
    .filter((key) => !declaredKeys.has(key))
    .map((key): InputIssue => ({ key, message: 'This input is not declared by the applet' }))
  const validated = definition.map((field) => validateField(field, values[field.key]))
  const issues = [
    ...unknownIssues,
    ...validated.flatMap((result) => (result.ok ? [] : [result.issue])),
  ]
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    values: Object.fromEntries(
      validated.flatMap((result) => (result.ok && result.entry ? [result.entry] : [])),
    ),
  }
}
