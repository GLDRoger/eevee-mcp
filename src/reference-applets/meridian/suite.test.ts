import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { createBoundedMemoryStore, type BoundedMemoryStore } from '@/domain/applet-store'
import { createVersionSchema } from '@/domain/applet'
import { prepareAppletRuntime } from '@/domain/applet-runtime'
import { createEvaluationSuiteSchema, type EvaluationStep } from '@/domain/evaluation'
import type { JsonValue } from '@/domain/json'
import { isPublishableQuality } from '@/domain/quality'
import { executeStep, type EvaluationCaseTransport } from '@/client/evaluation-worker'
import { compileReactApp } from '@/server/react-compiler'
import { evaluateReactApp } from '@/server/react-app-quality'
import { meridianEvaluation, meridianVersion } from './index'

/**
 * Runs the Meridian behavioral suite through the evaluation worker's step
 * executor. The browser worker hosts applets in a sandboxed iframe, which
 * jsdom cannot emulate (no srcdoc loading, no event.source on postMessage),
 * so this transport hosts the prepared runtime document at top level and
 * carries the same bridge, evaluator, and action messages over MessageEvents
 * with an explicit source. The runtime script, the compiled applet, and the
 * worker's step semantics are the production ones.
 */

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

const createJsdomTransport = (html: string, channel: string, memory: BoundedMemoryStore) => {
  let dom: JSDOM | null = null
  let token: string | null = null
  let sequence = 0
  const pending = new Map<string, Pending>()
  const actionPending = new Map<string, Pending>()
  let ready: Pending | null = null

  const deliver = (window: JSDOM['window'], data: unknown) => {
    setTimeout(() => {
      window.dispatchEvent(new window.MessageEvent('message', { data, source: window as unknown as Window }))
    }, 0)
  }

  const respond = (window: JSDOM['window'], id: string, result: { ok: true; value: unknown } | { ok: false; error: string }) =>
    deliver(window, { source: 'eevee-harness', channel, id, ...result })

  const receive = (window: JSDOM['window'], message: Record<string, unknown>) => {
    if (message.channel !== channel) return
    if (message.source === 'eevee-applet') {
      if (message.action === 'ready') {
        token = String(message.evaluationToken)
        ready?.resolve(undefined)
        return
      }
      if (message.action === 'revoke') {
        ready?.reject(new Error(String(message.reason)))
        return
      }
      const id = String(message.id)
      const payload = (message.payload ?? {}) as { key?: string; value?: JsonValue }
      try {
        if (message.action === 'all') respond(window, id, { ok: true, value: memory.all() })
        else if (message.action === 'get') respond(window, id, { ok: true, value: memory.get(payload.key ?? '') })
        else if (message.action === 'set') respond(window, id, { ok: true, value: memory.set(payload.key ?? '', payload.value ?? null) })
        else respond(window, id, { ok: false, error: 'Library files are not available during behavioral evaluation' })
      } catch (error) {
        respond(window, id, { ok: false, error: error instanceof Error ? error.message : 'failed' })
      }
      return
    }
    if (message.source === 'eevee-applet-evaluation') {
      const item = pending.get(String(message.id))
      if (!item) return
      pending.delete(String(message.id))
      if (message.ok) item.resolve(message.value)
      else item.reject(new Error(String(message.error)))
      return
    }
    if (message.source === 'eevee-applet-action') {
      const item = actionPending.get(String(message.requestId))
      if (!item) return
      actionPending.delete(String(message.requestId))
      if (message.ok) item.resolve(message.value)
      else item.reject(new Error(String(message.error)))
    }
  }

  const start = () =>
    new Promise<void>((resolve, reject) => {
      ready = { resolve: () => resolve(), reject }
      const timer = setTimeout(() => reject(new Error('The applet did not become ready in time')), 8_000)
      ready = { resolve: () => { clearTimeout(timer); resolve() }, reject: (error) => { clearTimeout(timer); reject(error) } }
      dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        beforeParse: (window) => {
          Object.defineProperty(window, 'TextEncoder', { value: TextEncoder })
          Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
            configurable: true,
            get(this: HTMLElement) { return this.textContent ?? '' },
          })
          window.postMessage = ((message: unknown) => {
            if (message && typeof message === 'object') receive(window, message as Record<string, unknown>)
          }) as typeof window.postMessage
          window.addEventListener('error', (event) => reject(new Error(event.message)))
        },
      })
    })

  const command = (value: Parameters<EvaluationCaseTransport['command']>[0]) =>
    new Promise<unknown>((resolve, reject) => {
      if (!dom || !token) {
        reject(new Error('The applet evaluator is not ready'))
        return
      }
      const id = String(++sequence)
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('The applet evaluation command timed out'))
      }, 3_000)
      pending.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      deliver(dom.window, { source: 'eevee-evaluator', channel, evaluationToken: token, id, command: value })
    })

  const action = (name: string, input: Record<string, JsonValue> = {}) =>
    new Promise<unknown>((resolve, reject) => {
      if (!dom) {
        reject(new Error('The applet is not running'))
        return
      }
      const requestId = crypto.randomUUID()
      actionPending.set(requestId, { resolve, reject })
      deliver(dom.window, { source: 'eevee-action', channel, requestId, name, input })
    })

  const stop = () => {
    dom?.window.close()
    dom = null
    token = null
  }

  const restart = async () => {
    stop()
    await start()
  }

  return { start, stop, restart, command, action }
}

const version = createVersionSchema.parse(meridianVersion)
const suite = createEvaluationSuiteSchema.parse(meridianEvaluation)
const channel = crypto.randomUUID()
let html = ''
let transport: ReturnType<typeof createJsdomTransport> | null = null

beforeAll(async () => {
  // esbuild refuses to run under the jsdom environment, so this file runs in
  // node and hosts the applet in an explicit JSDOM; the worker's timers only
  // need a window-shaped global.
  if (!('window' in globalThis)) Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  const compilation = await compileReactApp(version.definition)
  expect(compilation.diagnostics).toEqual([])
  const quality = await evaluateReactApp(version.definition, compilation)
  expect(quality.checks.filter(({ criticality, verdict }) => criticality === 'required' && verdict === 'fail')).toEqual([])
  expect(isPublishableQuality(quality)).toBe(true)
  html = prepareAppletRuntime(compilation.artifact!.html, channel, { company_name: 'Meridian Ops' }, version.definition.actions)
}, 60_000)

afterEach(() => {
  transport?.stop()
  transport = null
})

describe('Meridian behavioral suite', () => {
  for (const definition of suite.cases) {
    it(`passes "${definition.name}"`, async () => {
      const memory = createBoundedMemoryStore()
      transport = createJsdomTransport(html, channel, memory)
      await transport.start()
      const evidence: string[] = []
      for (const [index, step] of definition.steps.entries()) {
        const detail = await executeStep(transport, memory, step as EvaluationStep, new AbortController().signal).catch((error: Error) => {
          throw new Error(`Step ${index} (${step.action} ${'selector' in step ? step.selector : ''}) failed: ${error.message}\nPrevious: ${evidence.join(' | ')}`)
        })
        evidence.push(detail)
      }
      const interactions = evidence.filter((detail) => /^(click|fill|press) completed/.test(detail))
      expect(interactions.every((detail) => detail.includes('bridge requests settled'))).toBe(true)
    }, 30_000)
  }
})

describe('Meridian governed actions', () => {
  it('registers a handler for every declared action and answers reads within the result budget', async () => {
    const memory = createBoundedMemoryStore()
    transport = createJsdomTransport(html, channel, memory)
    // The runtime refuses to become ready when any declared action lacks a handler.
    await transport.start()
    expect(version.definition.actions).toHaveLength(32)

    const orders = (await transport.action('list_orders', { limit: 2 })) as { matched: number; hasMore: boolean; orders: Array<{ number: string; lineCount: number; lines?: unknown }> }
    expect(orders).toMatchObject({ matched: 3, hasMore: true })
    expect(orders.orders.map(({ number }) => number)).toEqual(['SO-1000', 'SO-999'])
    expect(orders.orders[0]).not.toHaveProperty('lines')

    const order = (await transport.action('get_order', { order_id: 'o1000' })) as { lines: Array<{ sku: string }>; total: number }
    expect(order.total).toBe(496)
    expect(order.lines.map(({ sku }) => sku)).toEqual(['HUB-8P', 'CBL-2M'])

    const invoice = (await transport.action('get_invoice', { invoice_id: 'i5001' })) as { balance: number; payments: unknown[] }
    expect(invoice).toMatchObject({ balance: 338 })
    expect(invoice.payments).toHaveLength(1)

    const audit = (await transport.action('audit_trail', { limit: 2 })) as { total: number; returned: number; truncated: boolean }
    expect(audit).toMatchObject({ total: 5, returned: 2, truncated: false })

    await expect(transport.action('add_order_line', { order_id: 'o1000', product_id: 'p100', qty: 2.5 })).rejects.toThrow('whole number')
    const held = (await transport.action('set_credit_hold', { customer_id: 'c101', hold: true })) as { hold: boolean }
    expect(held.hold).toBe(true)
    await transport.action('set_credit_hold', { customer_id: 'c101', hold: true })
    expect((memory.get('customers.0') as Array<{ id: string; hold: boolean }>).find(({ id }) => id === 'c101')?.hold).toBe(true)
    expect(Object.keys(memory.all()).sort()).toEqual(['audit.0', 'customers.0', 'invoices.0', 'orders.0', 'products.0', 'seq'])
  }, 30_000)
})
