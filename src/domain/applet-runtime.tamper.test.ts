import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { prepareAppletRuntime } from './applet-runtime'

/**
 * Hosts the prepared runtime document top-level in jsdom (which cannot load a
 * sandboxed srcdoc frame) and plays the parent: it collects the ready message,
 * then sends evaluator commands with the token that message carried.
 */
const host = (body: string) => {
  const channel = crypto.randomUUID()
  const html = prepareAppletRuntime(
    `<!doctype html><html><head><title>Tamper</title></head><body>${body}</body></html>`,
    channel,
    {},
  )
  const outbox: Array<Record<string, unknown>> = []
  let readyToken: string | null = null
  let readyResolve: (() => void) | null = null
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve
  })
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse: (window) => {
      Object.defineProperty(window, 'TextEncoder', { value: TextEncoder })
      // jsdom has no innerText. Like the native getter, this one never
      // consults the JS-visible textContent accessor.
      const textContent = Object.getOwnPropertyDescriptor(window.Node.prototype, 'textContent')?.get
      Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        configurable: true,
        get(this: HTMLElement) {
          return textContent?.call(this) ?? ''
        },
      })
      window.postMessage = ((message: Record<string, unknown>) => {
        outbox.push(message)
        if (message.source === 'eevee-applet' && message.action === 'ready') {
          readyToken = String(message.evaluationToken)
          readyResolve?.()
        }
      }) as typeof window.postMessage
    },
  })
  const command = async (value: Record<string, unknown>): Promise<Record<string, unknown>> => {
    await ready
    const id = crypto.randomUUID()
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: { source: 'eevee-evaluator', channel, evaluationToken: readyToken, id, command: value },
        source: dom.window as unknown as Window,
      }),
    )
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      const reply = outbox.find((message) => message.source === 'eevee-applet-evaluation' && message.id === id)
      if (reply) return reply
    }
    throw new Error('The evaluator did not answer')
  }
  return { dom, command, html, outbox, channel, token: () => readyToken, ready }
}

describe('applet runtime evaluator hardening', () => {
  it('keeps the evaluation token out of the markup applet code can read', async () => {
    const page = host('<script>window.__eeveeReady()</script>')
    await page.ready
    const token = page.token()
    expect(token).toMatch(/^[0-9a-f-]{36}$/)
    expect(page.html).not.toContain(token as string)
    const scripts = [...page.dom.window.document.scripts].map((script) => script.textContent).join('')
    expect(scripts).not.toContain(token as string)
  })

  it('reads the real DOM when applet code patches query and text accessors after load', async () => {
    const page = host(`
      <p class="total">Real total 42</p>
      <input class="qty" value="7">
      <script>
        const fake = document.createElement('p');
        fake.textContent = 'Forged total 9000';
        document.querySelectorAll = () => [fake];
        document.querySelector = () => fake;
        Document.prototype.querySelectorAll = () => [fake];
        Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get: () => 'Forged getter' });
        Object.defineProperty(Node.prototype, 'textContent', { configurable: true, get: () => 'Forged text' });
        const real = document.getElementsByClassName('total')[0];
        Object.defineProperty(real, 'innerText', { value: 'Forged instance' });
        Object.defineProperty(HTMLInputElement.prototype, 'value', { configurable: true, get: () => '9000' });
        window.__eeveeReady();
      </script>`)
    const totals = await page.command({ action: 'inspect', selector: '.total' })
    expect(totals.ok).toBe(true)
    expect(totals.value).toEqual({ count: 1, text: 'Real total 42', value: null })
    const inputs = await page.command({ action: 'inspect', selector: '.qty' })
    expect(inputs.value).toEqual({ count: 1, text: '', value: '7' })
  })

  it('ignores evaluator commands that carry the wrong token', async () => {
    const page = host('<p class="x">x</p><script>window.__eeveeReady()</script>')
    await page.ready
    const id = crypto.randomUUID()
    page.dom.window.dispatchEvent(
      new page.dom.window.MessageEvent('message', {
        data: {
          source: 'eevee-evaluator',
          channel: page.channel,
          evaluationToken: 'forged',
          id,
          command: { action: 'inspect', selector: '.x' },
        },
        source: page.dom.window as unknown as Window,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(page.outbox.find((message) => message.id === id)).toBeUndefined()
    const answered = await page.command({ action: 'inspect', selector: '.x' })
    expect(answered.ok).toBe(true)
  })
})
