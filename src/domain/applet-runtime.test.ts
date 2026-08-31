import { describe, expect, it } from 'vitest'
import { Script } from 'node:vm'
import { prepareAppletRuntime } from './applet-runtime'

describe('prepareAppletRuntime', () => {
  it('injects the isolated runtime before the compiled app and escapes script-breaking input', () => {
    const compiled = prepareAppletRuntime(
      '<!doctype html><html><head><title>Test</title></head><body><script>start()</script></body></html>',
      '122c426d-6411-4fa1-9f04-9a4ce74407d7',
      { title: '</script><script>attack()</script>' },
    )
    const runtimeMarker = "Object.defineProperty(window, 'eevee'"
    expect(compiled.indexOf(runtimeMarker)).toBeGreaterThan(-1)
    expect(compiled.indexOf(runtimeMarker)).toBeLessThan(compiled.indexOf('start()'))
    expect(compiled).toContain('Content-Security-Policy')
    expect(compiled).not.toContain('</script><script>attack()')
    expect(compiled).toContain('\\u003c/script>')
    expect(compiled).toContain("post({ action: 'ready', evaluationToken })")
    expect(compiled).toContain("message.source === 'eevee-evaluator'")
    expect(compiled).toContain('parent.postMessage.bind(parent)')
    expect(compiled).toContain('event.stopImmediatePropagation()')
    expect(compiled).toContain('message.evaluationToken !== evaluationToken')
    expect(compiled).toContain('waitForMountWork()')
    expect(compiled).not.toContain('new SubmitEvent')
    expect(compiled).toContain("Object.getOwnPropertyDescriptor(prototype, 'value')")
    const scripts = [...compiled.matchAll(/<script>([\s\S]*?)<\/script>/gi)]
    expect(scripts).not.toHaveLength(0)
    expect(() => scripts.forEach((match) => new Script(match[1]))).not.toThrow()
  })

  it('rejects malformed artifacts without a complete document head', () => {
    expect(() => prepareAppletRuntime('<main>Incomplete</main>', crypto.randomUUID(), {})).toThrow(
      'no explicit head element',
    )
  })

  it('inserts into the parsed head instead of a comment that contains head markup', () => {
    const compiled = prepareAppletRuntime(
      '<!doctype html><!-- <head> --><html><head><title>Test</title></head><body></body></html>',
      crypto.randomUUID(),
      {},
    )
    const runtimeMarker = "Object.defineProperty(window, 'eevee'"
    expect(compiled.indexOf('<!-- <head> -->')).toBeLessThan(compiled.indexOf(runtimeMarker))
    expect(compiled.indexOf(runtimeMarker)).toBeLessThan(compiled.indexOf('<title>Test</title>'))
  })
})
