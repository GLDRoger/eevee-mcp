import { z } from 'zod'
import { inputDefinitionSchema, validateAppletInputs } from './input'
import { jsonObjectSchema, jsonValueSchema } from './json'

export const APPLET_ACTION_TOOL_PREFIX = 'applet_'
export const MAX_APPLET_ACTIONS = 32

export const appletActionNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,22}$/, 'Use 1 to 23 lowercase letters, numbers, and underscores')

export const appletActionEffectSchema = z.enum([
  'state:read',
  'state:write',
  'files:list',
  'files:read',
])

export const appletActionAuthoritySchema = z.enum(['automatic', 'human'])

export const appletActionDefinitionSchema = z
  .strictObject({
    name: appletActionNameSchema.describe('Tool name suffix; registered as applet_<name>.'),
    title: z.string().trim().min(1).max(80).describe('Label shown to the person.'),
    description: z.string().trim().min(1).max(500).describe('What it does and returns; for writes, what changes.'),
    inputs: inputDefinitionSchema.describe('Typed parameters; [] when none.'),
    effects: z
      .array(appletActionEffectSchema)
      .max(4)
      .describe('Bridge capabilities the handler may use. state:write requires authority "human".'),
    authority: appletActionAuthoritySchema.describe('automatic runs at once; human waits for the person\'s passkey.'),
  })
  .superRefine((action, context) => {
    if (new Set(action.effects).size !== action.effects.length) {
      context.addIssue({ code: 'custom', path: ['effects'], message: 'Action effects must be unique' })
    }
    if (action.effects.includes('state:write') && action.authority !== 'human') {
      context.addIssue({
        code: 'custom',
        path: ['authority'],
        message: 'Durable state changes require human authority',
      })
    }
  })

export const appletActionDefinitionsSchema = z
  .array(appletActionDefinitionSchema)
  .max(MAX_APPLET_ACTIONS)
  .superRefine((actions, context) => {
    const names = actions.map(({ name }) => name)
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: 'custom', message: 'Applet action names must be unique' })
    }
  })

export const appletActionRequestStateSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'running',
  'succeeded',
  'failed',
])

export const createAppletActionRequestSchema = z.strictObject({
  actionName: appletActionNameSchema,
  input: jsonObjectSchema,
})

export const completeAppletActionRequestSchema = z.strictObject({ result: jsonValueSchema })
export const failAppletActionRequestSchema = z.strictObject({
  error: z.string().trim().min(1).max(500),
})
export const appletActionRequestOperationSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('approve') }),
  z.strictObject({ operation: z.literal('reject') }),
  z.strictObject({ operation: z.literal('start') }),
  z.strictObject({ operation: z.literal('complete'), result: jsonValueSchema }),
  z.strictObject({
    operation: z.literal('fail'),
    error: z.string().trim().min(1).max(500),
  }),
])

export const appletActionRequestSchema = z.strictObject({
  id: z.uuid(),
  appletId: z.uuid(),
  runId: z.uuid(),
  appletVersionId: z.uuid(),
  action: appletActionDefinitionSchema,
  state: appletActionRequestStateSchema,
  input: jsonObjectSchema,
  result: jsonValueSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
})

const inputFieldJsonSchema = (
  field: z.infer<typeof inputDefinitionSchema>[number],
): Record<string, unknown> => {
  const description = field.description
  switch (field.kind) {
    case 'text':
      return {
        type: 'string',
        description,
        ...(field.minLength === undefined ? {} : { minLength: field.minLength }),
        ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
        ...(field.defaultValue === undefined ? {} : { default: field.defaultValue }),
      }
    case 'number':
      return {
        type: 'number',
        description,
        ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
        ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
        ...(field.step === undefined ? {} : { multipleOf: field.step }),
        ...(field.defaultValue === undefined ? {} : { default: field.defaultValue }),
      }
    case 'boolean':
      return {
        type: 'boolean',
        description,
        ...(field.defaultValue === undefined ? {} : { default: field.defaultValue }),
      }
    case 'choice':
      return {
        type: 'string',
        description,
        enum: field.options.map(({ value }) => value),
        ...(field.defaultValue === undefined ? {} : { default: field.defaultValue }),
      }
    default: {
      const unreachable: never = field
      return unreachable
    }
  }
}

export const appletActionInputSchema = (action: AppletActionDefinition): object => ({
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(
    action.inputs.map((field) => [field.key, inputFieldJsonSchema(field)]),
  ),
  required: action.inputs.filter(({ required }) => required).map(({ key }) => key),
})

export const validateAppletActionInput = (
  action: AppletActionDefinition,
  input: Readonly<Record<string, unknown>>,
) => validateAppletInputs(action.inputs, input)

export type AppletActionDefinition = z.infer<typeof appletActionDefinitionSchema>
export type AppletActionEffect = z.infer<typeof appletActionEffectSchema>
export type AppletActionRequest = z.infer<typeof appletActionRequestSchema>
export type CreateAppletActionRequestInput = z.infer<typeof createAppletActionRequestSchema>
