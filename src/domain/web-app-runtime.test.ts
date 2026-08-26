import { describe, expect, it } from 'vitest'
import { compileWebAppRun } from './web-app-runtime'

describe('compileWebAppRun', () => {
  it('injects the isolated runtime before author scripts and escapes script-breaking input', () => {
    const compiled = compileWebAppRun(
      '<!doctype html><html><head><title>Test</title></head><body><script>start()</script></body></html>',
      '122c426d-6411-4fa1-9f04-9a4ce74407d7',
      { title: '</script><script>attack()</script>' },
    )
    expect(compiled.indexOf('window.eevee')).toBeLessThan(compiled.indexOf('start()'))
    expect(compiled).toContain('Content-Security-Policy')
    expect(compiled).not.toContain('</script><script>attack()')
    expect(compiled).toContain('\\u003c/script>')
  })

  it('rejects fragments because the harness requires a complete document', () => {
    expect(() => compileWebAppRun('<main>Incomplete</main>', crypto.randomUUID(), {})).toThrow(
      'no explicit head element',
    )
  })

  it('inserts into the parsed head instead of a comment that contains head markup', () => {
    const compiled = compileWebAppRun(
      '<!doctype html><!-- <head> --><html><head><title>Test</title></head><body></body></html>',
      crypto.randomUUID(),
      {},
    )
    expect(compiled.indexOf('<!-- <head> -->')).toBeLessThan(compiled.indexOf('window.eevee'))
    expect(compiled.indexOf('window.eevee')).toBeLessThan(compiled.indexOf('<title>Test</title>'))
  })
})
