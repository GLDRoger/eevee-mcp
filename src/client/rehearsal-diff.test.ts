import { describe, expect, it } from 'vitest'
import { humanize, rehearsalChanges, summarizeChanges } from './rehearsal-diff'

describe('rehearsalChanges', () => {
  it('reads business fields as collection, entity, and field', () => {
    const changes = rehearsalChanges([
      {
        key: 'erp',
        before: {
          products: [{ id: 'p102', sku: 'INK-CY', stock: 12 }],
          audit: [{ at: 'old', entry: 'seeded' }],
        },
        after: {
          products: [{ id: 'p102', sku: 'INK-CY', stock: 20 }],
          audit: [
            { at: 'old', entry: 'seeded' },
            { at: 'new', entry: 'Received 8 × INK-CY' },
          ],
        },
      },
    ])
    expect(changes).toEqual([
      {
        path: 'erp.audit[1]',
        before: null,
        after: { at: 'new', entry: 'Received 8 × INK-CY' },
        kind: 'added',
        group: 'audit',
        subject: 'Received 8 × INK-CY',
        field: null,
      },
      {
        path: 'erp.products[p102].stock',
        before: 12,
        after: 20,
        kind: 'changed',
        group: 'products',
        subject: 'INK-CY',
        field: 'stock',
      },
    ])
    expect(summarizeChanges(changes)).toBe('1 audit added, 1 products field change')
  })

  it('names a paged collection by its collection and an entity by its name', () => {
    const changes = rehearsalChanges([
      {
        key: 'customers.0',
        before: [{ id: 'c101', name: 'Foundry North', hold: false, creditLimit: 2500 }],
        after: [{ id: 'c101', name: 'Foundry North', hold: true, creditLimit: 2500 }],
      },
    ])
    expect(changes).toEqual([
      {
        path: 'customers.0[c101].hold',
        before: false,
        after: true,
        kind: 'changed',
        group: 'customers',
        subject: 'Foundry North',
        field: 'hold',
      },
    ])
  })

  it('humanizes camel and snake case', () => {
    expect(humanize('creditLimit')).toBe('credit limit')
    expect(humanize('reorder_point')).toBe('reorder point')
    expect(humanize('invoices.3')).toBe('invoices')
  })

  it('caps large consequences', () => {
    const changes = rehearsalChanges(
      [{ key: 'state', before: {}, after: { a: 1, b: 2, c: 3 } }],
      2,
    )
    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({ kind: 'changed', group: 'state', subject: null, field: 'a' })
  })
})
