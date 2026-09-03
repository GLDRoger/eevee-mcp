import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createApplet, createVersion, ensureWorkspace } from './applets'
import {
  approveAppletActionRequest,
  completeAppletActionRequest,
  createAppletActionRequest,
  getAppletActionRequest,
  rejectAppletActionRequest,
  spendHumanAuthorityLease,
  startAppletActionRequest,
} from './applet-actions'
import { supersedeOpenActionRequests } from './applet-runs'
import { revokeHumanAuthorityLease } from './human-authority'
import { getDatabase } from './db/client'
import { appletRun, humanAuthorityLease, workspace } from './db/schema'

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

  it('spends an exact bounded autonomy lease once', async () => {
    const first = await createAppletActionRequest(workspaceId, runId, {
      actionName: 'add',
      input: { amount: 1 },
    })
    const [lease] = await getDatabase()
      .insert(humanAuthorityLease)
      .values({
        workspaceId,
        appletId: first.appletId,
        runId,
        grantedWrites: 1,
        remainingWrites: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning()
    if (!lease) throw new Error('The action test did not create its lease')
    const spent = await spendHumanAuthorityLease(workspaceId, lease.id, first.id)
    expect(spent.request.state).toBe('approved')
    expect(spent.lease.remainingWrites).toBe(0)

    const second = await createAppletActionRequest(workspaceId, runId, {
      actionName: 'add',
      input: { amount: 1 },
    })
    await expect(spendHumanAuthorityLease(workspaceId, lease.id, second.id)).rejects.toMatchObject({
      status: 409,
      code: 'human_authority_lease_inactive',
    })
  })

  it('spends a lease exactly once under concurrent requests', async () => {
    const requests = await Promise.all(
      [1, 2, 3].map((amount) =>
        createAppletActionRequest(workspaceId, runId, { actionName: 'add', input: { amount } }),
      ),
    )
    const [lease] = await getDatabase()
      .insert(humanAuthorityLease)
      .values({
        workspaceId,
        appletId: requests[0]!.appletId,
        runId,
        grantedWrites: 1,
        remainingWrites: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning()
    if (!lease) throw new Error('The action test did not create its lease')
    const outcomes = await Promise.allSettled(
      requests.map((request) => spendHumanAuthorityLease(workspaceId, lease.id, request.id)),
    )
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(
      outcomes
        .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
        .every(({ reason }) => reason.code === 'human_authority_lease_inactive'),
    ).toBe(true)
  })

  it('refuses to spend a revoked lease', async () => {
    const created = await createAppletActionRequest(workspaceId, runId, {
      actionName: 'add',
      input: { amount: 1 },
    })
    const [lease] = await getDatabase()
      .insert(humanAuthorityLease)
      .values({
        workspaceId,
        appletId: created.appletId,
        runId,
        grantedWrites: 3,
        remainingWrites: 3,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning()
    if (!lease) throw new Error('The action test did not create its lease')
    await revokeHumanAuthorityLease(workspaceId, lease.id)
    await expect(spendHumanAuthorityLease(workspaceId, lease.id, created.id)).rejects.toMatchObject({
      status: 409,
      code: 'human_authority_lease_inactive',
    })
    expect((await getAppletActionRequest(workspaceId, created.id)).state).toBe('pending')
  })

  it('records the rejection reason for the agent', async () => {
    const created = await createAppletActionRequest(workspaceId, runId, {
      actionName: 'add',
      input: { amount: 1 },
    })
    const rejected = await rejectAppletActionRequest(workspaceId, created.id, 'stock is already counted')
    expect(rejected.state).toBe('rejected')
    expect(rejected.error).toBe('The person rejected this request: stock is already counted')
    expect(rejected.completedAt).not.toBeNull()
  })

  it('supersedes open requests when a newer run starts', async () => {
    const pending = await createAppletActionRequest(workspaceId, runId, {
      actionName: 'add',
      input: { amount: 1 },
    })
    const done = await createAppletActionRequest(workspaceId, runId, {
      actionName: 'inspect',
      input: {},
    })
    await startAppletActionRequest(workspaceId, done.id)
    await completeAppletActionRequest(workspaceId, done.id, { count: 2 })
    const superseded = await getDatabase().transaction((transaction) =>
      supersedeOpenActionRequests(transaction, workspaceId, pending.appletId),
    )
    expect(superseded).toBeGreaterThanOrEqual(1)
    expect(await getAppletActionRequest(workspaceId, pending.id)).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('superseded'),
    })
    expect((await getAppletActionRequest(workspaceId, done.id)).state).toBe('succeeded')
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
