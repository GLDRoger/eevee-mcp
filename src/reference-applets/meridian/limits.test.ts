import { beforeAll, describe, expect, it } from 'vitest'
import { assertStateValueSize, MAX_STATE_KEYS, MAX_STATE_VALUE_BYTES } from '@/domain/applet-store'
import { loadMeridianLib, type MeridianLib } from './test-support'

/**
 * Proves the storage arithmetic stated in model.ts: a full page of maximal
 * records for every collection stays under the 64 KB per-value limit, and
 * the page layout uses fewer than the 128 keys one applet may hold.
 */
let lib: MeridianLib
const wide = (length: number) => '€'.repeat(length) // U+20AC costs 3 UTF-8 bytes per UTF-16 code unit
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

beforeAll(async () => {
  lib = await loadMeridianLib()
})

describe('Meridian storage pages', () => {
  it('keeps every full page of maximal records under the per-value limit', () => {
    const limits = lib.LIMITS as unknown as Record<string, { pageSize: number; pages: number }>
    const money = 99_999_999.99
    const units = 10_000_000
    const line = { productId: wide(20), qty: units, price: money }
    const payment = { amount: 9_999_999_999_999_999, at: wide(30), memo: wide(80) }
    const maximal = {
      products: lib.cleanProduct({
        id: wide(20), sku: wide(24), name: wide(80), category: 'consumables',
        price: money, cost: money, stock: units, reorderPoint: units, archived: false, tracked: true,
      }),
      customers: lib.cleanCustomer({
        id: wide(20), name: wide(80), region: wide(40), terms: 'prepaid', creditLimit: money, hold: false,
      }),
      orders: lib.cleanOrder({
        id: wide(20), number: wide(16), customerId: wide(20), state: 'allocated',
        lines: Array.from({ length: 24 }, () => line), note: wide(160), placedAt: wide(30),
      }),
      invoices: lib.cleanInvoice({
        id: wide(20), number: wide(16), orderId: wide(20), customerId: wide(20), total: 9_999_999_999_999_999,
        state: 'open', issuedAt: wide(30), dueAt: wide(30), payments: Array.from({ length: 12 }, () => payment),
      }),
      audit: lib.cleanAuditRow({ at: wide(30), entry: wide(200) }),
    }
    // The clean functions must not have shrunk the maximal records.
    expect(maximal.orders.lines).toHaveLength(24)
    expect(maximal.invoices.payments).toHaveLength(12)
    expect(maximal.products.name).toHaveLength(80)

    const sizes: Record<string, number> = {}
    for (const [name, record] of Object.entries(maximal)) {
      const page = Array.from({ length: limits[name]!.pageSize }, () => record)
      sizes[name] = bytes(page)
      expect(() => assertStateValueSize(page)).not.toThrow()
      expect(sizes[name]).toBeLessThan(MAX_STATE_VALUE_BYTES)
    }
    // Figures stated in the model.ts comment.
    expect(sizes).toEqual({ products: 53_801, customers: 50_901, orders: 52_771, invoices: 50_621, audit: 56_881 })

    const keys = Object.values(limits).reduce((total, { pages }) => total + pages, 1)
    expect(keys).toBe(50)
    expect(keys).toBeLessThanOrEqual(MAX_STATE_KEYS)
  })

  it('caps collections at their page budget and strips control characters', () => {
    const cap = lib.capOf as (name: string) => number
    expect(cap('products')).toBe(200)
    expect(cap('orders')).toBe(300)
    expect(cap('invoices')).toBe(200)
    expect(cap('audit')).toBe(400)
    const state = lib.cleanState({
      products: Array.from({ length: 250 }, (_, index) => ({ id: `p${index}`, name: 'a\u0000b\u001fc' })),
      audit: Array.from({ length: 500 }, (_, index) => ({ at: '', entry: `row ${index}` })),
    }) as { products: Array<{ name: string }>; audit: Array<{ entry: string }> }
    expect(state.products).toHaveLength(200)
    expect(state.products[0]?.name).toBe('abc')
    expect(state.audit).toHaveLength(400)
    expect(state.audit[0]?.entry).toBe('row 100')
  })

  it('trims the audit trail one page at a time so a full trail rewrites pages rarely', () => {
    let state = lib.seedState() as { audit: unknown[] }
    for (let index = 0; index < 400; index += 1) state = lib.audited(state, `entry ${index}`)
    expect(state.audit.length).toBeLessThanOrEqual(400)
    expect(state.audit.length).toBeGreaterThan(320)
    const before = state.audit.length
    state = lib.audited(state, 'one more')
    expect(state.audit.length).toBe(before === 400 ? 320 : before + 1)
  })
})
