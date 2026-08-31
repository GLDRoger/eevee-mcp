import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createApplet, createVersion, ensureWorkspace } from './applets'
import {
  approveAppletActionRequest,
  completeAppletActionRequest,
  createAppletActionRequest,
  getAppletActionRequest,
  rejectAppletActionRequest,
  startAppletActionRequest,
} from './applet-actions'
import { getDatabase } from './db/client'
import { appletRun, workspace } from './db/schema'

const databaseEnabled = Boolean(process.env.DATABASE_URL)
const describeDatabase = databaseEnabled ? describe : describe.skip

describeDatabase('governed applet actions', () => {
  const workspaceId = crypto.randomUUID()
  const otherWorkspaceId = crypto.randomUUID()
  let runId = ''

  beforeAll(async () => {
    await Promise.all([ensureWorkspace(workspaceId), ensureWorkspace(otherWorkspaceId)])
    const createdApplet = await createApplet(workspaceId, {
      name: 'Action specimen',
      description: 'Exercises automatic and human-governed actions.',
      medium: 'web-app',
    })
    const version = await createVersion(workspaceId, createdApplet.id, {
      note: 'Action contract',
      inputs: [],
      definition: {
        kind: 'react-app',
        entry: 'src/App.tsx',
        files: [
          {
            path: 'src/App.tsx',
            content:
              'export const actions = { inspect: async () => ({ count: 1 }), add: async ({ amount }) => ({ amount }) }; export default function App() { return <main><h1>Actions</h1></main> }',
          },
        ],
        actions: [
          {
            name: 'inspect',
            title: 'Inspect state',
            description: 'Read the current bounded state.',
            inputs: [],
            effects: ['state:read'],
            authority: 'automatic',
          },
          {
            name: 'add',
            title: 'Add item',
            description: 'Add one item to durable state.',
            inputs: [
              {
                key: 'amount',
                label: 'Amount',
                description: 'Number of items to add.',
                kind: 'number',
                required: true,
                minimum: 1,
                maximum: 10,
              },
            ],
            effects: ['state:read', 'state:write'],
            authority: 'human',
          },
        ],
      },
    })
    const [run] = await getDatabase()
      .insert(appletRun)
      .values({
        workspaceId,
        appletId: createdApplet.id,
        appletVersionId: version.version.id,
        state: 'succeeded',
        input: {},
        output: {
          kind: 'web-app',
          channel: crypto.randomUUID(),
          html: '<!doctype html><html><head></head><body></body></html>',
        },
        completedAt: new Date(),
      })
      .returning({ id: appletRun.id })
    if (!run) throw new Error('The action test did not create its run')
    runId = run.id
  })

  afterAll(async () => {
    if (!databaseEnabled) return
    await getDatabase().delete(workspace).where(eq(workspace.id, workspaceId))
    await getDatabase().delete(workspace).where(eq(workspace.id, otherWorkspaceId))
  })

  it('executes an automatic read through the approved state', async () => {
    const created = await createAppletActionRequest(workspaceId, runId, {
      actionName: 'inspect',
      input: {},
    })
    expect(created.state).toBe('approved')
    expect((await startAppletActionRequest(workspaceId, created.id)).state).toBe('running')
    const completed = await completeAppletActionRequest(workspaceId, created.id, { count: 1 })
    expect(completed).toMatchObject({ state: 'succeeded', result: { count: 1 } })
  })

  it('requires a human decision before a durable write', async () => {
    const created = await createAppletActionRequest(workspaceId, runId, {
      actionName: 'add',
      input: { amount: 2 },
    })
    expect(created.state).toBe('pending')
    await expect(startAppletActionRequest(workspaceId, created.id)).rejects.toMatchObject({
      status: 409,
      code: 'applet_action_not_approved',
    })
    expect((await approveAppletActionRequest(workspaceId, created.id)).state).toBe('approved')
    expect((await startAppletActionRequest(workspaceId, created.id)).state).toBe('running')
    expect((await completeAppletActionRequest(workspaceId, created.id, { amount: 2 })).state).toBe(
      'succeeded',
    )
  })

  it('records refusal and enforces workspace isolation', async () => {
    const created = await createAppletActionRequest(workspaceId, runId, {
      actionName: 'add',
      input: { amount: 1 },
    })
    expect((await rejectAppletActionRequest(workspaceId, created.id)).state).toBe('rejected')
    await expect(getAppletActionRequest(otherWorkspaceId, created.id)).rejects.toMatchObject({
      status: 404,
    })
    await expect(approveAppletActionRequest(otherWorkspaceId, created.id)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('rejects undeclared and invalid action input', async () => {
    await expect(
      createAppletActionRequest(workspaceId, runId, { actionName: 'missing', input: {} }),
    ).rejects.toMatchObject({ status: 404, code: 'applet_action_not_found' })
    await expect(
      createAppletActionRequest(workspaceId, runId, { actionName: 'add', input: { amount: 0 } }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_applet_action_input' })
  })
})
