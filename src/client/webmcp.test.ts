import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  api: {
    createApplet: vi.fn(),
    createCorrection: vi.fn(),
    createEvaluationSuite: vi.fn(),
    createVersion: vi.fn(),
    editPdf: vi.fn(),
    editSpreadsheet: vi.fn(),
    inspectActionRequest: vi.fn(),
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

import { EEVEE_TOOL_COUNT, registerEeveeTools } from './webmcp'
import { api } from './api'
import { publishWorkbenchState, resetWorkbenchState } from './workbench-state'

type Registered = { tools: WebMcpTool[]; signals: AbortSignal[] }

const stubModelContext = (
  reject: (tool: WebMcpTool) => Error | null = () => null,
): Registered => {
  const tools: WebMcpTool[] = []
  const signals: AbortSignal[] = []
  const modelContext: WebMcpModelContext = {
    registerTool: (tool, options) => {
      const failure = reject(tool)
      if (failure) return Promise.reject(failure)
      tools.push(tool)
      if (options?.signal) signals.push(options.signal)
      return Promise.resolve()
    },
  }
  vi.stubGlobal('document', { modelContext })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  return { tools, signals }
}

const actionRequest = (state: 'pending' | 'succeeded' | 'rejected') => ({
  id: '5f2b7c6e-0f1a-4c0e-9d2e-1b2c3d4e5f60',
  appletId: crypto.randomUUID(),
  runId: crypto.randomUUID(),
  appletVersionId: crypto.randomUUID(),
  action: {
    name: 'add',
    title: 'Add',
    description: 'Add one item.',
    inputs: [],
    effects: ['state:write' as const],
    authority: 'human' as const,
  },
  state,
  input: {},
  result: state === 'succeeded' ? { ok: true } : null,
  error: state === 'rejected' ? 'The person rejected this request: not now' : null,
  createdAt: new Date().toISOString(),
  decidedAt: null,
  completedAt: null,
})

describe('registerEeveeTools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    resetWorkbenchState()
  })

  it('registers the bounded lifecycle without an agent publish tool', async () => {
    const { tools, signals } = stubModelContext()

    const registration = registerEeveeTools()

    await expect(registration.ready).resolves.toEqual({
      live: EEVEE_TOOL_COUNT,
      total: EEVEE_TOOL_COUNT,
      failures: [],
    })
    expect(tools.map(({ name }) => name)).toEqual([
      'share_plan',
      'update_plan_step',
      'get_workbench_state',
      'list_files',
      'inspect_file',
      'scan_document_review',
      'request_redaction_review',
      'create_office_file',
      'replace_office_file',
      'edit_spreadsheet',
      'inspect_tool_contract',
      'edit_pdf',
      'list_applets',
      'install_reference_applet',
      'inspect_applet',
      'inspect_applet_version',
      'create_applet',
      'create_react_app_version',
      'revise_react_app_version',
      'create_video_editor_version',
      'create_evaluation_suite',
      'evaluate_applet_version',
      'inspect_evaluation_run',
      'inspect_applet_action',
      'await_action_decision',
      'request_version_review',
      'run_applet',
      'record_correction',
    ])
    expect(tools).toHaveLength(EEVEE_TOOL_COUNT)
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
    // inspect_tool_contract instead of costing every agent ~9,000
    // tokens per page load.
    expect(JSON.stringify(spreadsheetTool.inputSchema).length).toBeLessThan(5_000)
    const contractTool = tools.find(({ name }) => name === 'inspect_tool_contract')
    if (!contractTool) throw new Error('inspect_tool_contract was not registered')
    const contract = (await contractTool.execute(
      { tool: 'edit_spreadsheet' },
      { signal: new AbortController().signal },
    )) as { inputSchema: object }
    expect(JSON.stringify(contract.inputSchema)).toContain('structuralOps')
    expect(JSON.stringify(contract.inputSchema).length).toBeGreaterThan(20_000)
    const videoTool = tools.find(({ name }) => name === 'create_video_editor_version')
    if (!videoTool) throw new Error('create_video_editor_version was not registered')
    expect(JSON.stringify(videoTool.inputSchema).length).toBeLessThan(2_000)
    const videoContract = (await contractTool.execute(
      { tool: 'create_video_editor_version' },
      { signal: new AbortController().signal },
    )) as { inputSchema: object }
    expect(JSON.stringify(videoContract.inputSchema)).toContain('clips')
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

  it('executes when the browser passes no options object', async () => {
    // Chrome 152 calls execute(input) with a single argument. Every tool that
    // destructured { signal } from the second argument used to throw before
    // doing any work.
    const { tools } = stubModelContext()
    await registerEeveeTools().ready
    vi.mocked(api.listApplets).mockResolvedValue({ applets: [] })
    vi.mocked(api.listFiles).mockResolvedValue({ files: [] })
    const listApplets = tools.find(({ name }) => name === 'list_applets')
    const listFiles = tools.find(({ name }) => name === 'list_files')
    if (!listApplets || !listFiles) throw new Error('list tools were not registered')
    await expect(listApplets.execute({})).resolves.toEqual({ applets: [] })
    await expect(listFiles.execute({})).resolves.toEqual({ files: [] })
    const [signal] = vi.mocked(api.listApplets).mock.calls[0] ?? []
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it('falls back to navigator.modelContext when document has none', async () => {
    const tools: WebMcpTool[] = []
    vi.stubGlobal('document', {})
    vi.stubGlobal('navigator', {
      modelContext: {
        registerTool: (tool: WebMcpTool) => {
          tools.push(tool)
          return Promise.resolve()
        },
      },
    })
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
    await expect(registerEeveeTools().ready).resolves.toMatchObject({ live: EEVEE_TOOL_COUNT })
    expect(tools).toHaveLength(EEVEE_TOOL_COUNT)
  })

  it('keeps the other tools live when one registration is rejected', async () => {
    const { tools } = stubModelContext((tool) =>
      tool.name === 'edit_pdf' ? new Error('duplicate name') : null,
    )
    await expect(registerEeveeTools().ready).resolves.toEqual({
      live: EEVEE_TOOL_COUNT - 1,
      total: EEVEE_TOOL_COUNT,
      failures: ['edit_pdf: duplicate name'],
    })
    expect(tools).toHaveLength(EEVEE_TOOL_COUNT - 1)
  })

  it('reports validation failures field by field', async () => {
    const { tools } = stubModelContext()
    await registerEeveeTools().ready
    const inspect = tools.find(({ name }) => name === 'inspect_applet')
    if (!inspect) throw new Error('inspect_applet was not registered')
    await expect(inspect.execute({ appletId: 'nope' })).resolves.toMatchObject({ tool: 'inspect_applet', error: expect.stringMatching(/appletId/) })
    expect(api.inspectApplet).not.toHaveBeenCalled()
  })

  it('reads the published workbench state', async () => {
    const { tools } = stubModelContext()
    await registerEeveeTools().ready
    publishWorkbenchState({ surface: 'library', pendingDecisions: 2, passkeyEnrolled: true })
    const state = tools.find(({ name }) => name === 'get_workbench_state')
    if (!state) throw new Error('get_workbench_state was not registered')
    await expect(state.execute({})).resolves.toMatchObject({
      surface: 'library',
      pendingDecisions: 2,
      passkeyEnrolled: true,
    })
  })

  it('waits for a human decision instead of returning the pending record', async () => {
    vi.useFakeTimers()
    try {
      const { tools } = stubModelContext()
      await registerEeveeTools().ready
      vi.mocked(api.inspectActionRequest)
        .mockResolvedValueOnce({ request: actionRequest('pending') })
        .mockResolvedValueOnce({ request: actionRequest('pending') })
        .mockResolvedValueOnce({ request: actionRequest('rejected') })
      const awaitTool = tools.find(({ name }) => name === 'await_action_decision')
      if (!awaitTool) throw new Error('await_action_decision was not registered')
      const pending = awaitTool.execute({
        requestId: '5f2b7c6e-0f1a-4c0e-9d2e-1b2c3d4e5f60',
        timeoutSeconds: 10,
      })
      await vi.advanceTimersByTimeAsync(2_500)
      const result = (await pending) as { request: { state: string; error: string | null } }
      expect(result.request.state).toBe('rejected')
      expect(result.request.error).toContain('not now')
      expect(api.inspectActionRequest).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('trims inspect responses to what an agent can afford to read', async () => {
    const { tools } = stubModelContext()
    await registerEeveeTools().ready
    const appletId = crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const suiteId = crypto.randomUUID()
    const bigStep = {
      index: 0,
      action: 'click' as const,
      verdict: 'pass' as const,
      detail: 'x'.repeat(400),
      durationMs: 1,
    }
    vi.mocked(api.inspectApplet).mockResolvedValue({
      detail: {
        applet: {
          id: appletId,
          name: 'Big',
          description: 'Big applet',
          medium: 'web-app',
          state: 'active',
          activeVersionId: null,
          versionCount: 1,
          runCount: 0,
          correctionCount: 0,
          evaluationCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        versions: [],
        runs: [],
        corrections: [],
        evaluationSuites: [
          {
            id: suiteId,
            appletId,
            revision: 1,
            name: 'Suite',
            createdAt: new Date().toISOString(),
            cases: [
              {
                id: 'case-a',
                name: 'Case A',
                criticality: 'required',
                input: {},
                steps: Array.from({ length: 30 }, () => ({
                  action: 'click' as const,
                  selector: '#x',
                })),
              },
            ],
          },
        ],
        evaluationRuns: [
          {
            id: crypto.randomUUID(),
            appletId,
            candidateVersionId: versionId,
            baselineVersionId: null,
            suiteId,
            state: 'passed',
            report: {
              verdict: 'pass',
              candidate: {
                versionId,
                verdict: 'pass',
                cases: [
                  {
                    caseId: 'case-a',
                    name: 'Case A',
                    criticality: 'required',
                    verdict: 'pass',
                    steps: Array.from({ length: 30 }, (_, index) => ({ ...bigStep, index })),
                  },
                ],
              },
              baseline: null,
              regressions: [],
              checks: [],
            },
            error: null,
            createdAt: new Date().toISOString(),
            leaseExpiresAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        ],
      },
    })
    const inspect = tools.find(({ name }) => name === 'inspect_applet')
    if (!inspect) throw new Error('inspect_applet was not registered')
    const inspected = await inspect.execute({ appletId })
    const encoded = JSON.stringify(inspected)
    expect(encoded.length).toBeLessThan(2_000)
    expect(encoded).toContain('"stepCount":30')
    expect(encoded).toContain('"verdict":"pass"')
    expect(encoded).not.toContain('x'.repeat(400))

    vi.mocked(api.inspectAppletVersion).mockResolvedValue({
      version: {
        id: versionId,
        version: 1,
        state: 'draft',
        note: 'v1',
        inputs: [],
        definitionKind: 'react-app',
        qualityReport: {
          evaluator: 'test',
          verdict: 'pass',
          score: 100,
          checks: [],
          evaluatedAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      },
      definition: {
        kind: 'react-app',
        entry: 'src/App.tsx',
        actions: [],
        files: [
          { path: 'src/App.tsx', content: 'export default function App(){return null}' },
          { path: 'src/big.ts', content: 'y'.repeat(50_000) },
        ],
      },
    })
    const inspectVersion = tools.find(({ name }) => name === 'inspect_applet_version')
    if (!inspectVersion) throw new Error('inspect_applet_version was not registered')
    const summary = (await inspectVersion.execute({ appletId, versionId })) as {
      definition: { files: Array<{ path: string; bytes: number; content: string | null }> }
      omittedPaths?: string[]
    }
    expect(summary.definition.files.map(({ path, content }) => [path, content !== null])).toEqual([
      ['src/App.tsx', true],
      ['src/big.ts', false],
    ])
    expect(summary.omittedPaths).toEqual(['src/big.ts'])
    const full = (await inspectVersion.execute({ appletId, versionId, paths: ['src/big.ts'] })) as {
      definition: { files: Array<{ path: string; content: string | null }> }
    }
    expect(full.definition.files.find(({ path }) => path === 'src/big.ts')?.content).toHaveLength(
      50_000,
    )
  })
})
