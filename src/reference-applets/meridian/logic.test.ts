import { beforeAll, describe, expect, it } from 'vitest'
import { loadMeridianLib, type MeridianLib, type MeridianState } from './test-support'

let lib: MeridianLib
const seed = (): MeridianState => lib.seedState() as MeridianState
const product = (state: MeridianState, id: string) => state.products.find((item) => item.id === id)!
const order = (state: MeridianState, id: string) => state.orders.find((item) => item.id === id)!

const deliver = (state: MeridianState, orderId: string): MeridianState =>
  lib.deliverOrder(lib.shipOrder(lib.allocateOrder(state, orderId), orderId), orderId) as MeridianState

beforeAll(async () => {
  lib = await loadMeridianLib()
})

describe('Meridian credit exposure', () => {
  it('counts open invoice balances plus committed orders that are not invoiced yet', () => {
    const state = seed()
    // INV-5001 (538, 200 paid) is Harbor Lab's only open invoice; SO-999 is invoiced.
    expect(lib.openBalance(state, 'c100')).toBe(338)
    expect(lib.uninvoicedExposure(state, 'c100')).toBe(0)
    expect(lib.creditExposure(state, 'c100')).toBe(338)

    const allocated = lib.allocateOrder(state, 'o1000') as MeridianState
    expect(lib.uninvoicedExposure(allocated, 'c100')).toBe(496)
    expect(lib.creditExposure(allocated, 'c100')).toBe(834)

    // A 900 limit admits a 100 order against the open balance alone (438),
    // but not once the allocated, uninvoiced SO-1000 is counted (934).
    const limited = lib.updateCustomer(allocated, 'c100', { creditLimit: 900 }) as MeridianState
    const opened = lib.createOrder(limited, 'c100', 'small add-on') as { state: MeridianState; order: { id: string } }
    const withLine = lib.addOrderLine(opened.state, opened.order.id, 'p100', 1, 100) as MeridianState
    expect(() => lib.allocateOrder(withLine, opened.order.id)).toThrow(/would take Harbor Lab Supply to 934 against a 900 limit/)

    const invoiced = lib.issueInvoice(lib.deliverOrder(lib.shipOrder(withLine, 'o1000'), 'o1000'), 'o1000') as { state: MeridianState }
    expect(lib.uninvoicedExposure(invoiced.state, 'c100')).toBe(0)
    expect(lib.creditExposure(invoiced.state, 'c100')).toBe(834)
  })
})

describe('Meridian stock tracking', () => {
  it('values a tracked SKU at stock 950 and never values or decrements services', () => {
    const state = lib.receiveStock(seed(), 'p100', 810) as MeridianState
    expect(product(state, 'p100').stock).toBe(950)
    const valuation = lib.inventoryValuation(state) as { rows: Array<{ sku: string; stock: number; value: number }>; total: number }
    expect(valuation.rows.find((row) => row.sku === 'CBL-2M')).toMatchObject({ stock: 950, value: 4750 })
    expect(valuation.rows.some((row) => row.sku === 'SRV-1H')).toBe(false)
    expect(valuation.total).toBe(4750 + 32 * 41 + 12 * 9 + 76 * 11)

    const opened = lib.createOrder(state, 'c102', '') as { state: MeridianState; order: { id: string } }
    const serviceOrder = lib.addOrderLine(opened.state, opened.order.id, 'p104', 40, undefined) as MeridianState
    const allocated = lib.allocateOrder(serviceOrder, opened.order.id) as MeridianState
    expect(order(allocated, opened.order.id).state).toBe('allocated')
    expect(product(allocated, 'p104')).toMatchObject({ stock: 0, tracked: false })
    expect(() => lib.receiveStock(allocated, 'p104', 5)).toThrow(/services item with no stock to receive/)
  })

  it('rejects non-integer quantities with a visible failure instead of rounding', () => {
    const state = seed()
    expect(() => lib.addOrderLine(state, 'o1000', 'p100', 2.5, undefined)).toThrow('Quantity must be a whole number; got 2.5')
    expect(() => lib.receiveStock(state, 'p100', 2.5)).toThrow(/whole number/)
    expect(() => lib.receiveStock(state, 'p100', 'abc')).toThrow(/whole number/)
    expect(() => lib.adjustStock(state, 'p100', -0.5, 'shrink')).toThrow(/whole number/)
    const received = lib.receiveStock(state, 'p100', 7) as MeridianState
    expect(received.audit.at(-1)?.entry).toBe('Received 7 × CBL-2M (now 147)')
  })

  it('restores reserved stock when an allocated order is cancelled', () => {
    const allocated = lib.allocateOrder(seed(), 'o1000') as MeridianState
    expect(product(allocated, 'p101').stock).toBe(28)
    expect(product(allocated, 'p100').stock).toBe(130)
    const cancelled = lib.cancelOrder(allocated, 'o1000', 'Customer withdrew') as MeridianState
    expect(order(cancelled, 'o1000').state).toBe('cancelled')
    expect(product(cancelled, 'p101').stock).toBe(32)
    expect(product(cancelled, 'p100').stock).toBe(140)
    expect(lib.uninvoicedExposure(cancelled, 'c100')).toBe(0)
  })
})

describe('Meridian receivables and invoicing', () => {
  it('buckets aging at the boundaries', () => {
    const at = '2026-09-02T12:00:00.000Z'
    const dueDaysAgo = (days: number) => new Date(Date.parse(at) - days * 86400000).toISOString()
    const invoices = [0, 1, 15, 16, 30, 31, -5].map((days, index) => ({
      id: `i${index}`, orderId: `o${index}`, customerId: 'c100', total: 100, state: 'open',
      issuedAt: dueDaysAgo(days + 10), dueAt: dueDaysAgo(days), payments: [],
    }))
    const state = lib.cleanState({ ...seed(), invoices }) as MeridianState
    const buckets = lib.arAging(state, at) as Array<{ label: string; invoices: number; amount: number }>
    expect(buckets).toEqual([
      { label: 'current', invoices: 2, amount: 200 },
      { label: '1-15', invoices: 2, amount: 200 },
      { label: '16-30', invoices: 2, amount: 200 },
      { label: '31+', invoices: 1, amount: 100 },
    ])
    expect([0, 1, 15, 16, 30, 31].map((days) => lib.agingBucket(days))).toEqual([0, 1, 1, 2, 2, 3])
  })

  it('renders the seeded ledger: one overdue and one partially paid invoice', () => {
    const state = seed()
    const buckets = lib.arAging(state, '2026-09-02T12:00:00.000Z') as Array<{ label: string; amount: number }>
    expect(buckets.find((bucket) => bucket.label === 'current')?.amount).toBe(338)
    expect(buckets.filter((bucket) => bucket.label !== 'current').reduce((sum, bucket) => sum + bucket.amount, 0)).toBe(670)
    expect(lib.revenueByCategory(state)).toEqual([
      { category: 'apparel', revenue: 560 },
      { category: 'services', revenue: 360 },
      { category: 'hardware', revenue: 178 },
      { category: 'consumables', revenue: 110 },
    ])
    expect((lib.salesByCustomer(state) as Array<{ name: string; billed: number }>)[0]).toEqual(
      expect.objectContaining({ name: 'Foundry North', billed: 670 }),
    )
    expect(lib.companySnapshot(state)).toMatchObject({ openOrders: 1, lowStock: 1, openReceivables: 1008 })
  })

  it('reissues an invoice after a void and refuses a second live invoice', () => {
    const delivered = deliver(seed(), 'o1000')
    const first = lib.issueInvoice(delivered, 'o1000') as { state: MeridianState; invoice: { id: string; number: string; total: number } }
    expect(first.invoice).toMatchObject({ number: 'INV-5002', total: 496 })
    expect(() => lib.issueInvoice(first.state, 'o1000')).toThrow('SO-1000 already has an invoice')
    const voided = lib.voidInvoice(first.state, first.invoice.id, 'Wrong terms') as MeridianState
    expect(voided.invoices.find((invoice) => invoice.id === first.invoice.id)?.state).toBe('void')
    const second = lib.issueInvoice(voided, 'o1000') as { state: MeridianState; invoice: { number: string } }
    expect(second.invoice.number).toBe('INV-5003')
    expect(second.state.invoices.filter((invoice) => invoice.orderId === 'o1000' && invoice.state !== 'void')).toHaveLength(1)
    const paid = lib.recordPayment(second.state, 'i5003', 496, 'Paid in full') as MeridianState
    expect(paid.invoices.find((invoice) => invoice.id === 'i5003')?.state).toBe('paid')
    expect(() => lib.voidInvoice(paid, 'i5003', 'too late')).toThrow(/paid and cannot be voided/)
  })
})

describe('Meridian customers', () => {
  it('sets credit holds idempotently and blocks allocation while held', () => {
    const state = seed()
    const held = lib.setCreditHold(state, 'c100', true) as MeridianState
    const heldAgain = lib.setCreditHold(held, 'c100', true) as MeridianState
    expect(heldAgain).toBe(held)
    expect(heldAgain.audit.length).toBe(state.audit.length + 1)
    expect(() => lib.allocateOrder(held, 'o1000')).toThrow('Harbor Lab Supply is on credit hold')
    const released = lib.setCreditHold(held, 'c100', false) as MeridianState
    expect(released.customers.find((customer) => customer.id === 'c100')?.hold).toBe(false)
    expect(() => lib.setCreditHold(state, 'c100', 'yes')).toThrow('hold must be true or false')
  })

  it('refuses unknown terms and categories instead of falling back silently', () => {
    const state = seed()
    expect(() => lib.createCustomer(state, { name: 'New', terms: 'net45', creditLimit: 0 })).toThrow(/Terms must be one of/)
    expect(() => lib.updateCustomer(state, 'c100', { terms: 'net45' })).toThrow(/Terms must be one of/)
    expect(() => lib.createProduct(state, { name: 'Thing', category: 'misc', price: 1, cost: 0 })).toThrow(/Category must be one of/)
    const created = lib.createProduct(state, { name: 'Tune-up', category: 'services', price: 80, cost: 0 }) as { product: { tracked: boolean; stock: number } }
    expect(created.product).toMatchObject({ tracked: false, stock: 0 })
    const repriced = lib.updateProduct(state, 'p100', { price: 15.5, cost: 6 }) as MeridianState
    expect(product(repriced, 'p100')).toMatchObject({ cost: 6 })
    expect(repriced.audit.at(-1)?.entry).toBe('Updated CBL-2M: price 15.5, cost 6')
  })
})
