import { describe, expect, it } from 'vitest'
import {
  appletActionDefinitionSchema,
  appletActionDefinitionsSchema,
  appletActionInputSchema,
  validateAppletActionInput,
} from './applet-action'

const action = () =>
  appletActionDefinitionSchema.parse({
    name: 'add_resistor',
    title: 'Add resistor',
    description: 'Add one resistor to the shared circuit.',
    inputs: [
      {
        key: 'ohms',
        label: 'Resistance',
        description: 'Resistance in ohms.',
        kind: 'number',
        required: true,
        minimum: 1,
        maximum: 1_000_000,
      },
    ],
    effects: ['state:read', 'state:write'],
    authority: 'human',
  })

describe('applet action definitions', () => {
  it('requires human authority for durable writes', () => {
    expect(() =>
      appletActionDefinitionSchema.parse({
        ...action(),
        authority: 'automatic',
      }),
    ).toThrow('Durable state changes require human authority')
  })

  it('rejects duplicate names', () => {
    expect(() => appletActionDefinitionsSchema.parse([action(), action()])).toThrow(
      'Applet action names must be unique',
    )
  })

  it('uses one input contract for WebMCP and execution validation', () => {
    const definition = action()
    expect(appletActionInputSchema(definition)).toMatchObject({
      additionalProperties: false,
      required: ['ohms'],
      properties: { ohms: { type: 'number', minimum: 1, maximum: 1_000_000 } },
    })
    expect(validateAppletActionInput(definition, { ohms: 220 })).toEqual({
      ok: true,
      values: { ohms: 220 },
    })
    expect(validateAppletActionInput(definition, { ohms: 0, hidden: true })).toMatchObject({
      ok: false,
      issues: [
        { key: 'hidden', message: 'This input is not declared by the applet' },
        { key: 'ohms' },
      ],
    })
  })
})
