import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import {
  createApplet,
  createCorrection,
  createVersion,
  ensureWorkspace,
  getApplet,
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

const runIntegration = Boolean(process.env.DATABASE_URL)
const workspaceId = crypto.randomUUID()
const otherWorkspaceId = crypto.randomUUID()
const appHtml = `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Persistent task register</title>
  </head>
  <body>
    <main>
      <h1>Persistent task register</h1>
      <button type="button">Add task</button>
    </main>
    <script>document.querySelector('h1').textContent = window.eevee.inputs.title;</script>
  </body>
</html>`

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
      definition: { kind: 'web-app', html: appHtml },
    })
    expect(created.publishable).toBe(true)
    expect(created.version.qualityReport.score).toBe(100)
    expect((await previewVersion(workspaceId, applet.id, created.version.id)).html).toContain(
      'Persistent task register',
    )

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
      definition: {
        kind: 'web-app',
        html: appHtml.replace('<main>', '<div>').replace('</main>', '</div>'),
      },
    })
    expect(blocked.publishable).toBe(false)
    await expect(
      publishVersion(workspaceId, applet.id, blocked.version.id),
    ).rejects.toMatchObject({ status: 409, code: 'quality_gate_failed' })

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
        versionCount: 2,
        runCount: 2,
        correctionCount: 1,
      }),
    ])
    expect((await getApplet(workspaceId, applet.id)).corrections).toHaveLength(1)

    await expect(getApplet(otherWorkspaceId, applet.id)).rejects.toMatchObject({
      status: 404,
      code: 'applet_not_found',
    } satisfies Partial<RequestFailure>)
    await expect(getRun(otherWorkspaceId, run.id)).rejects.toMatchObject({
      status: 404,
      code: 'run_not_found',
    } satisfies Partial<RequestFailure>)
  })

  it('rejects undeclared run inputs at the boundary', async () => {
    const [applet] = await listApplets(workspaceId)
    if (!applet) throw new Error('The lifecycle test did not create its applet')
    await expect(
      runApplet(workspaceId, applet.id, { input: { title: 'August', hidden: true } }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_run_input' })
  })
})
