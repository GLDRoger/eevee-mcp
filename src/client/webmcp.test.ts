import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  api: {
    createApplet: vi.fn(),
    createCorrection: vi.fn(),
    createVersion: vi.fn(),
    inspectApplet: vi.fn(),
    listApplets: vi.fn(),
    runApplet: vi.fn(),
  },
}))

import { registerEeveeTools } from './webmcp'
import { api } from './api'

describe('registerEeveeTools', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('registers the bounded lifecycle without an agent publish tool', async () => {
    const tools: WebMcpTool[] = []
    const signals: AbortSignal[] = []
    const modelContext: WebMcpModelContext = {
      registerTool: (tool, options) => {
        tools.push(tool)
        if (options?.signal) signals.push(options.signal)
        return Promise.resolve()
      },
    }
    vi.stubGlobal('document', { modelContext })
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })

    const registration = registerEeveeTools()

    await expect(registration.ready).resolves.toBe(true)
    expect(tools.map(({ name }) => name)).toEqual([
      'list_applets',
      'inspect_applet',
      'create_applet',
      'create_web_app_version',
      'request_version_review',
      'run_applet',
      'record_correction',
    ])
    expect(tools.some(({ name }) => name.includes('publish'))).toBe(false)
    expect(signals).toHaveLength(tools.length)
    expect(signals.every(({ aborted }) => !aborted)).toBe(true)

    const runTool = tools.find(({ name }) => name === 'run_applet')
    if (!runTool) throw new Error('run_applet was not registered')
    const appletId = crypto.randomUUID()
    const channel = crypto.randomUUID()
    vi.mocked(api.runApplet).mockResolvedValue({
      run: {
        id: crypto.randomUUID(),
        appletId,
        appletVersionId: crypto.randomUUID(),
        state: 'running',
        input: {},
        output: { kind: 'web-app', channel, html: '<script>untrusted()</script>' },
        error: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      },
    })
    const result = await runTool.execute(
      { appletId, input: {} },
      { signal: new AbortController().signal },
    )
    expect(JSON.stringify(result)).not.toContain(channel)
    expect(JSON.stringify(result)).not.toContain('untrusted')

    registration.unregister()
    expect(signals.every(({ aborted }) => aborted)).toBe(true)
  })
})
