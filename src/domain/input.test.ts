import { describe, expect, it } from 'vitest'
import { inputDefinitionSchema, validateAppletInputs, type InputDefinition } from './input'

const definition: InputDefinition = [
  {
    key: 'project_name',
    label: 'Project name',
    description: 'Shown at the top of the app.',
    required: true,
    kind: 'text',
    minLength: 2,
  },
  {
    key: 'budget',
    label: 'Budget',
    description: 'Maximum approved spend.',
    required: false,
    kind: 'number',
    defaultValue: 500,
    minimum: 0,
  },
]

describe('validateAppletInputs', () => {
  it('applies declared defaults and rejects undeclared values', () => {
    expect(validateAppletInputs(definition, { project_name: 'Atlas' })).toEqual({
      ok: true,
      values: { project_name: 'Atlas', budget: 500 },
    })
    expect(validateAppletInputs(definition, { project_name: 'Atlas', secret: true })).toEqual({
      ok: false,
      issues: [{ key: 'secret', message: 'This input is not declared by the applet' }],
    })
  })

  it('reports required and bounded inputs without coercion', () => {
    expect(validateAppletInputs(definition, { project_name: 'A' })).toEqual({
      ok: false,
      issues: [{ key: 'project_name', message: 'Use at least 2 characters' }],
    })
    expect(validateAppletInputs(definition, { project_name: 42 })).toEqual({
      ok: false,
      issues: [{ key: 'project_name', message: 'Enter text' }],
    })
  })

  it('rejects contradictory bounds and defaults before a form is generated', () => {
    expect(() =>
      inputDefinitionSchema.parse([
        {
          key: 'code',
          label: 'Code',
          description: 'A bounded code.',
          required: true,
          kind: 'text',
          minLength: 5,
          maxLength: 3,
          defaultValue: 'AB',
        },
        {
          key: 'amount',
          label: 'Amount',
          description: 'A bounded amount.',
          required: true,
          kind: 'number',
          minimum: 10,
          maximum: 5,
          defaultValue: 2,
        },
      ]),
    ).toThrow()
  })

  it('enforces number steps from the declared minimum', () => {
    const stepped: InputDefinition = [
      {
        key: 'quantity',
        label: 'Quantity',
        description: 'Sold in quarter units after one.',
        required: true,
        kind: 'number',
        minimum: 1,
        step: 0.25,
      },
    ]

    expect(validateAppletInputs(stepped, { quantity: 1.5 })).toEqual({
      ok: true,
      values: { quantity: 1.5 },
    })
    expect(validateAppletInputs(stepped, { quantity: 1.4 })).toEqual({
      ok: false,
      issues: [{ key: 'quantity', message: 'Use increments of 0.25' }],
    })
  })
})
