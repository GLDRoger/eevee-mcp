import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBoundedMemoryStore, type BoundedMemoryStore } from '@/domain/applet-store'
import type { JsonValue } from '@/domain/json'
import { bundleMeridian, type MeridianState } from './test-support'

type Persist = {
  loadState: () => Promise<MeridianState>
  commit: (transform: (state: MeridianState) => MeridianState) => Promise<MeridianState>
  currentState: () => MeridianState | null
  subscribe: (listener: (state: MeridianState) => void) => () => void
  allocateOrder: (state: MeridianState, orderId: string) => MeridianState
  receiveStock: (state: MeridianState, productId: string, qty: number) => MeridianState
}

/**
 * Runs the applet's persist module against the same bounded memory store the
 * evaluation worker uses, with a fake window.eevee.store bridge that records
 * every write and can be told to refuse the next one.
 */
const createBridge = (memory: BoundedMemoryStore) => {
  const writes: string[] = []
  let refuse: string | null = null
  const store = {
    get: async (key: string) => memory.get(key),
    all: async () => memory.all(),
    set: async (key: string, value: JsonValue) => {
      if (refuse) {
        const message = refuse
        refuse = null
        throw new Error(message)
      }
      writes.push(key)
      return memory.set(key, value)
    },
  }
  return { store, writes, refuseNext: (message: string) => { refuse = message } }
}

describe('Meridian paged persistence', () => {
  let memory: BoundedMemoryStore
  let bridge: ReturnType<typeof createBridge>
  let persist: Persist

  beforeEach(async () => {
    memory = createBoundedMemoryStore()
    bridge = createBridge(memory)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { eevee: { store: bridge.store } },
    })
    persist = (await bundleMeridian("export * from './lib/persist'; export * from './lib/logic'")) as unknown as Persist
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('seeds only the pages with content, then writes only the pages a change touched', async () => {
    const loaded = await persist.loadState()
    expect(loaded.orders.map(({ number }) => number)).toEqual(['SO-998', 'SO-999', 'SO-1000'])
    expect(bridge.writes).toEqual(['products.0', 'customers.0', 'orders.0', 'invoices.0', 'audit.0', 'seq'])
    expect(Object.keys(memory.all())).toHaveLength(6)

    bridge.writes.length = 0
    const seen: MeridianState[] = []
    const unsubscribe = persist.subscribe((state) => seen.push(state))
    const next = await persist.commit((state) => persist.allocateOrder(state, 'o1000'))
    unsubscribe()
    expect(next.orders.find(({ id }) => id === 'o1000')?.state).toBe('allocated')
    // Allocation touches products (stock), orders (state), and the audit trail; nothing else.
    expect(bridge.writes).toEqual(['products.0', 'orders.0', 'audit.0'])
    expect(seen).toHaveLength(1)
    expect((memory.get('orders.0') as Array<{ state: string }>)[2]?.state).toBe('allocated')

    bridge.writes.length = 0
    await persist.commit((state) => persist.receiveStock(state, 'p100', 5))
    expect(bridge.writes).toEqual(['products.0', 'audit.0'])
  })

  it('serializes back-to-back commits so the second sees the first', async () => {
    await persist.loadState()
    const first = persist.commit((state) => persist.receiveStock(state, 'p102', 3))
    const second = persist.commit((state) => persist.receiveStock(state, 'p102', 4))
    await Promise.all([first, second])
    expect(persist.currentState()?.products.find(({ id }) => id === 'p102')?.stock).toBe(12 + 3 + 4)
    expect((memory.get('products.0') as Array<{ id: string; stock: number }>).find(({ id }) => id === 'p102')?.stock).toBe(19)
  })

  it('restores the previous state on screen and in storage when a write is refused', async () => {
    const base = await persist.loadState()
    expect(base.products.find(({ id }) => id === 'p100')?.stock).toBe(140)
    const seen: number[] = []
    const unsubscribe = persist.subscribe((state) => seen.push(state.products.find(({ id }) => id === 'p100')?.stock ?? -1))
    bridge.refuseNext('One stored value cannot exceed 64 KB')
    await expect(persist.commit((state) => persist.receiveStock(state, 'p100', 9))).rejects.toThrow(
      'Not saved: One stored value cannot exceed 64 KB. The screen was restored to the last saved state.',
    )
    unsubscribe()
    // The optimistic state (149) showed first, then the restore (140).
    expect(seen).toEqual([149, 140])
    expect(persist.currentState()).toBe(base)
    expect((memory.get('products.0') as Array<{ id: string; stock: number }>).find(({ id }) => id === 'p100')?.stock).toBe(140)

    // A refused business rule leaves state untouched and does not notify.
    await expect(persist.commit((state) => persist.allocateOrder(state, 'o998'))).rejects.toThrow('SO-998 is already delivered')
    expect(persist.currentState()).toBe(base)
  })

  it('reassembles a saved company from its pages after a restart', async () => {
    await persist.loadState()
    await persist.commit((state) => persist.allocateOrder(state, 'o1000'))
    const restarted = (await bundleMeridian("export * from './lib/persist'")) as unknown as Persist
    expect(restarted.currentState()).toBeNull()
    const loaded = await restarted.loadState()
    expect(loaded.orders.find(({ id }) => id === 'o1000')?.state).toBe('allocated')
    expect(loaded.products.find(({ id }) => id === 'p101')?.stock).toBe(28)
    expect(loaded.seq).toEqual({ order: 1001, invoice: 5002, product: 105, customer: 103 })
  })
})
