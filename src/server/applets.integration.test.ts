import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import {
  createApplet,
  createCorrection,
  createVersion,
  reviseVersion,
  ensureWorkspace,
  getApplet,
  getAppletVersion,
  listApplets,
  previewVersion,
  publishVersion,
  readAppletValues,
  writeAppletValue,
} from './applets'
import { completeRun, failRun, getRun, runApplet } from './applet-runs'
import { getDatabase } from './db/client'
import { appletValue, workspace } from './db/schema'
import { RequestFailure } from './http'
import type { ReactAppDefinition } from '@/domain/react-app'
import type { EvaluationSuite, EvaluationVersionEvidenceInput } from '@/domain/evaluation'
import {
  completeEvaluation,
  getEvaluationRun,
  startEvaluation,
} from './evaluations'
import { createEvaluationSuite } from './evaluation-suites'

const runIntegration = Boolean(process.env.DATABASE_URL)
const workspaceId = crypto.randomUUID()
const otherWorkspaceId = crypto.randomUUID()
const appSource = `
import { useEffect, useState } from 'react'
import './app.css'

export default function App({ inputs, store }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    void store.get('task-count').then((saved) => {
      if (typeof saved === 'number') setCount(saved)
    })
  }, [store])
  const addTask = () => {
    const next = count + 1
    setCount(next)
    void store.set('task-count', next)
  }
  return <main className="register">
    <h1>{String(inputs.title)}</h1>
    <p>{count} tasks</p>
    <button type="button" onClick={addTask}>Add task</button>
  </main>
}
`

const definition = (source = appSource): ReactAppDefinition => ({
  kind: 'react-app',
  entry: 'src/App.tsx',
  actions: [],
  files: [
    { path: 'src/App.tsx', content: source },
    {
      path: 'src/app.css',
      content: 'body { margin: 0; } .register { max-width: 42rem; margin: auto; padding: 2rem; }',
    },
  ],
})

const passingEvidence = (
  versionId: string,
  suite: EvaluationSuite,
): EvaluationVersionEvidenceInput => ({
  versionId,
  cases: suite.cases.map((evaluationCase) => ({
    caseId: evaluationCase.id,
    steps: evaluationCase.steps.map((step, index) => ({
      index,
      action: step.action,
      verdict: 'pass',
      detail: 'The deterministic browser step passed.',
      durationMs: 10,
    })),
  })),
})

describe.runIf(runIntegration)('durable applet lifecycle', () => {
  afterAll(async () => {
    await getDatabase().delete(workspace).where(inArray(workspace.id, [workspaceId, otherWorkspaceId]))
  })

  it('creates, evaluates, publishes, runs, stores state, and proposes a correction', async () => {
    await Promise.all([ensureWorkspace(workspaceId), ensureWorkspace(otherWorkspaceId)])
    const applet = await createApplet(workspaceId, {
      name: 'Task register',
      description: 'Keep a small project task register.',
      medium: 'web-app',
    })
    const created = await createVersion(workspaceId, applet.id, {
      note: 'Initial durable register',
      inputs: [
        {
          key: 'title',
          label: 'Register title',
          description: 'Shown at the top of the register.',
          required: true,
          kind: 'text',
        },
      ],
      definition: definition(),
    })
    expect(created.publishable).toBe(false)
    expect(created.version.qualityReport.score).toBe(100)
    expect(await getAppletVersion(workspaceId, applet.id, created.version.id)).toMatchObject({
      version: { id: created.version.id, definitionKind: 'react-app' },
      definition: { kind: 'react-app', entry: 'src/App.tsx' },
    })
    expect((await previewVersion(workspaceId, applet.id, created.version.id)).html).toContain(
      '<div id="root"></div>',
    )

    await expect(
      publishVersion(workspaceId, applet.id, created.version.id),
    ).rejects.toMatchObject({ status: 409, code: 'behavioral_evaluation_required' })
    const suite = await createEvaluationSuite(workspaceId, applet.id, {
      name: 'Persistent task behavior',
      cases: [
        {
          id: 'add-and-reload',
          name: 'Add and reload one task',
          criticality: 'required',
          input: { title: 'Evaluation register' },
          steps: [
            { action: 'click', selector: 'button' },
            { action: 'assert-text', selector: 'main', contains: '1 tasks' },
            { action: 'restart' },
            { action: 'assert-stored-value', key: 'task-count', value: 1 },
            { action: 'assert-text', selector: 'main', contains: '1 tasks' },
          ],
        },
      ],
    })
    const evaluation = await startEvaluation(workspaceId, applet.id, {
      versionId: created.version.id,
      suiteId: suite.id,
    })
    expect(evaluation.run.baselineVersionId).toBeNull()
    const evaluated = await completeEvaluation(workspaceId, evaluation.run.id, {
      candidate: passingEvidence(created.version.id, suite),
      baseline: null,
    })
    expect(evaluated).toMatchObject({ state: 'passed', report: { verdict: 'pass' } })

    await publishVersion(workspaceId, applet.id, created.version.id)
    const run = await runApplet(workspaceId, applet.id, { input: { title: 'August work' } })
    expect(run.state).toBe('running')
    expect(run.output?.html).toContain('August work')
    if (!run.output) throw new Error('The web run did not produce its runtime payload')
    const completed = await completeRun(workspaceId, run.id, { channel: run.output.channel })
    expect(completed.state).toBe('succeeded')
    await expect(
      completeRun(workspaceId, run.id, { channel: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 403, code: 'invalid_run_channel' })
    expect((await completeRun(workspaceId, run.id, { channel: run.output.channel })).state).toBe(
      'succeeded',
    )
    expect((await getRun(workspaceId, run.id)).completedAt).not.toBeNull()

    const blocked = await createVersion(workspaceId, applet.id, {
      note: 'Missing the required main landmark',
      inputs: [],
      definition: definition(appSource.replace('<main', '<div').replace('</main>', '</div>')),
    })
    expect(blocked.publishable).toBe(false)
    await expect(
      publishVersion(workspaceId, applet.id, blocked.version.id),
    ).rejects.toMatchObject({ status: 409, code: 'quality_gate_failed' })

    const compileFailed = await createVersion(workspaceId, applet.id, {
      note: 'Invalid React source remains visible as evidence',
      inputs: [],
      definition: definition('export default () => <main>'),
    })
    expect(compileFailed.publishable).toBe(false)
    expect(compileFailed.version.qualityReport.verdict).toBe('fail')
    await expect(
      previewVersion(workspaceId, applet.id, compileFailed.version.id),
    ).rejects.toMatchObject({ status: 409, code: 'artifact_unavailable' })

    await writeAppletValue(workspaceId, applet.id, 'tasks', [{ title: 'Ship the demo' }])
    expect(await readAppletValues(workspaceId, applet.id)).toEqual({
      tasks: [{ title: 'Ship the demo' }],
    })
    await writeAppletValue(workspaceId, applet.id, 'nullable', null)
    expect(await readAppletValues(workspaceId, applet.id)).toEqual({
      nullable: null,
      tasks: [{ title: 'Ship the demo' }],
    })
    await getDatabase().insert(appletValue).values(
      Array.from({ length: 126 }, (_, index) => ({
        workspaceId,
        appletId: applet.id,
        key: `quota-${index}`,
        value: false,
      })),
    )
    await expect(
      writeAppletValue(workspaceId, applet.id, 'quota-overflow', true),
    ).rejects.toMatchObject({ status: 409, code: 'state_key_limit_reached' })

    const correction = await createCorrection(workspaceId, run.id, {
      instruction: 'Show the owner beside every task',
      observedIssue: 'The generated register omitted task owners.',
      desiredOutcome: 'Every future task row includes an owner.',
    })
    expect(correction.state).toBe('proposed')

    const revoked = await runApplet(workspaceId, applet.id, { input: { title: 'Revoked run' } })
    if (!revoked.output) throw new Error('The revoked run did not produce its runtime payload')
    const failed = await failRun(workspaceId, revoked.id, {
      channel: revoked.output.channel,
      error: 'The runtime navigated away before completion',
    })
    expect(failed).toMatchObject({
      state: 'failed',
      error: 'The runtime navigated away before completion',
    })
    await expect(
      createCorrection(workspaceId, revoked.id, {
        instruction: 'Ignore this failed run',
        observedIssue: 'It never became ready.',
        desiredOutcome: 'Only successful runs can create corrections.',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'run_not_correctable' })

    expect(await listApplets(workspaceId)).toEqual([
      expect.objectContaining({
        id: applet.id,
        activeVersionId: created.version.id,
        versionCount: 3,
        runCount: 2,
        correctionCount: 1,
        evaluationCount: 1,
      }),
    ])
    const detail = await getApplet(workspaceId, applet.id)
    expect(detail.corrections).toHaveLength(1)
    expect(detail.evaluationSuites).toHaveLength(1)
    expect(detail.evaluationRuns).toHaveLength(1)

    await expect(getApplet(otherWorkspaceId, applet.id)).rejects.toMatchObject({
      status: 404,
      code: 'applet_not_found',
    } satisfies Partial<RequestFailure>)
    await expect(getRun(otherWorkspaceId, run.id)).rejects.toMatchObject({
      status: 404,
      code: 'run_not_found',
    } satisfies Partial<RequestFailure>)
    await expect(
      getAppletVersion(otherWorkspaceId, applet.id, created.version.id),
    ).rejects.toMatchObject({ status: 404, code: 'version_not_found' })
    await expect(getEvaluationRun(otherWorkspaceId, evaluation.run.id)).rejects.toMatchObject({
      status: 404,
      code: 'evaluation_not_found',
    })
  })

  it('revises a version by delta: changed files merge, deletions drop, the rest carry over', async () => {
    const applet = await createApplet(workspaceId, {
      name: 'Delta register',
      description: 'Prove delta revision merges files.',
      medium: 'web-app',
    })
    const base = await createVersion(workspaceId, applet.id, {
      note: 'Base version',
      inputs: [],
      definition: definition(appSource.replace('{String(inputs.title)}', 'Base title')),
    })
    const revised = await reviseVersion(workspaceId, applet.id, {
      baseVersionId: base.version.id,
      note: 'Retitle via delta',
      changedFiles: [
        {
          path: 'src/App.tsx',
          content: appSource.replace('{String(inputs.title)}', 'Revised title'),
        },
      ],
      deletedPaths: [],
    })
    expect(revised.version.version).toBe(2)
    const stored = await getAppletVersion(workspaceId, applet.id, revised.version.id)
    if (stored.definition.kind !== 'react-app') throw new Error('expected react-app definition')
    expect(stored.definition.files).toHaveLength(2)
    const entry = stored.definition.files.find(({ path }) => path === 'src/App.tsx')
    expect(entry?.content).toContain('Revised title')
    const css = stored.definition.files.find(({ path }) => path === 'src/app.css')
    expect(css?.content).toContain('.register')

    await expect(
      reviseVersion(workspaceId, applet.id, {
        baseVersionId: base.version.id,
        note: 'Delete the entry file',
        changedFiles: [],
        deletedPaths: ['src/App.tsx'],
      }),
    ).rejects.toThrow(/src\/App\.tsx is the entry file and must remain/)
    await expect(
      reviseVersion(workspaceId, applet.id, {
        baseVersionId: base.version.id,
        note: 'Delete a file that does not exist',
        changedFiles: [],
        deletedPaths: ['src/ghost.ts'],
      }),
    ).rejects.toThrow(/does not have: src\/ghost\.ts/)
  })

  it('rejects undeclared run inputs at the boundary', async () => {
    const applets = await listApplets(workspaceId)
    const applet = applets.find(({ name }) => name === 'Task register')
    if (!applet) throw new Error('The lifecycle test did not create its applet')
    await expect(
      runApplet(workspaceId, applet.id, { input: { title: 'August', hidden: true } }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_run_input' })
  })
})
