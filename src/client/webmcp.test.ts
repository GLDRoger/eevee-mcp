import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  api: {
    createApplet: vi.fn(),
    createCorrection: vi.fn(),
    createEvaluationSuite: vi.fn(),
    createVersion: vi.fn(),
    editPdf: vi.fn(),
    editSpreadsheet: vi.fn(),
    inspectFile: vi.fn(),
    inspectEvaluation: vi.fn(),
    inspectApplet: vi.fn(),
    inspectAppletVersion: vi.fn(),
    listApplets: vi.fn(),
    listFiles: vi.fn(),
    runApplet: vi.fn(),
    saveFile: vi.fn(),
    uploadFile: vi.fn(),
  },
}))

vi.mock('./evaluation-worker', () => ({ evaluateAppletVersion: vi.fn() }))

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
      'list_files',
      'inspect_file',
      'create_office_file',
      'replace_office_file',
      'edit_spreadsheet',
      'inspect_spreadsheet_contract',
      'edit_pdf',
      'list_applets',
      'inspect_applet',
      'inspect_applet_version',
      'create_applet',
      'create_react_app_version',
      'create_evaluation_suite',
      'evaluate_applet_version',
      'inspect_evaluation_run',
      'inspect_applet_action',
      'request_version_review',
      'run_applet',
      'record_correction',
    ])
    expect(tools.some(({ name }) => name.includes('publish'))).toBe(false)
    const createVersionTool = tools.find(({ name }) => name === 'create_react_app_version')
    if (!createVersionTool) throw new Error('create_react_app_version was not registered')
    expect(JSON.stringify(createVersionTool.inputSchema)).toContain('react-app')
    expect(JSON.stringify(createVersionTool.inputSchema)).toContain('src/App.tsx')
    expect(JSON.stringify(createVersionTool.inputSchema)).not.toContain('"html"')
    const spreadsheetTool = tools.find(({ name }) => name === 'edit_spreadsheet')
    if (!spreadsheetTool) throw new Error('edit_spreadsheet was not registered')
    expect(JSON.stringify(spreadsheetTool.inputSchema)).toContain('structuralOps')
    expect(JSON.stringify(spreadsheetTool.inputSchema)).toContain('pivotAdditions')
    // The advertised schema must stay compact; the full contract lives behind
    // inspect_spreadsheet_contract instead of costing every agent ~9,000
    // tokens per page load.
    expect(JSON.stringify(spreadsheetTool.inputSchema).length).toBeLessThan(5_000)
    const contractTool = tools.find(({ name }) => name === 'inspect_spreadsheet_contract')
    if (!contractTool) throw new Error('inspect_spreadsheet_contract was not registered')
    const contract = (await contractTool.execute(
      {},
      { signal: new AbortController().signal },
    )) as { inputSchema: object }
    expect(JSON.stringify(contract.inputSchema)).toContain('structuralOps')
    expect(JSON.stringify(contract.inputSchema).length).toBeGreaterThan(20_000)
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

    const dispatched = vi
      .mocked(window.dispatchEvent)
      .mock.calls.map(([event]) => event as CustomEvent)
    const activity = dispatched.filter(
      ({ type, detail }) =>
        type === 'eevee:tool-activity' && (detail as { tool: string }).tool === 'run_applet',
    )
    expect(activity.map(({ detail }) => (detail as { phase: string }).phase)).toEqual([
      'started',
      'succeeded',
    ])

    registration.unregister()
    expect(signals.every(({ aborted }) => aborted)).toBe(true)
  })
})
