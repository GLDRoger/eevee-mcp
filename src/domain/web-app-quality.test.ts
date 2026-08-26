import { describe, expect, it } from 'vitest'
import { evaluateWebAppHtml } from './web-app-quality'

const completeApp = `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Project register</title>
  </head>
  <body>
    <main>
      <h1>Project register</h1>
      <label for="project">Project</label>
      <input id="project">
      <button type="button">Add project</button>
    </main>
    <script>document.querySelector('h1').textContent = window.eevee.inputs.title;</script>
  </body>
</html>`

describe('evaluateWebAppHtml', () => {
  it('passes a self-contained accessible app', () => {
    const report = evaluateWebAppHtml(completeApp, new Date('2026-08-26T00:00:00Z'))
    expect(report.score).toBe(100)
    expect(report.checks.every(({ status }) => status === 'passed')).toBe(true)
  })

  it('rejects documents whose required tags only exist because the parser inferred them', () => {
    const report = evaluateWebAppHtml(
      '<!doctype html><title>Implicit structure</title><main><h1>Missing tags</h1></main>',
    )

    expect(report.checks.find(({ id }) => id === 'document-structure')?.status).toBe('failed')
  })

  it('blocks external navigation even when the page does not call fetch', () => {
    const report = evaluateWebAppHtml(`<!doctype html>
      <html><head><title>Escape</title></head><body><main><h1>Escape</h1>
      <button>Leave</button><script>location.href = 'https://example.com/leak'</script>
      </main></body></html>`)

    expect(report.checks.find(({ id }) => id === 'self-contained')?.status).toBe('failed')

    const protocolRelative = evaluateWebAppHtml(
      completeApp.replace(
        '</script>',
        `location.href = '//example.com/leak';</script>`,
      ),
    )
    expect(protocolRelative.checks.find(({ id }) => id === 'self-contained')?.status).toBe(
      'failed',
    )
  })

  it('blocks networked or inaccessible sources', () => {
    const report = evaluateWebAppHtml(
      completeApp
        .replace('<button type="button">Add project</button>', '<button></button>')
        .replace('</main>', '<img src="https://example.com/private.png"></main>'),
    )
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: 'self-contained', status: 'failed', blocking: true }),
    )
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: 'accessible-controls', status: 'failed', blocking: true }),
    )
  })
})
