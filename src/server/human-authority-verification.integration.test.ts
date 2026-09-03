import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/server')>()
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(async () => ({
      verified: true as const,
      registrationInfo: {
        fmt: 'none' as const,
        aaguid: '00000000-0000-0000-0000-000000000000',
        credential: {
          id: 'test-passkey',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal' as const],
        },
        credentialType: 'public-key' as const,
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'singleDevice' as const,
        credentialBackedUp: false,
        origin: 'http://localhost:3000',
        rpID: 'localhost',
      },
    })),
    verifyAuthenticationResponse: vi.fn(async () => ({
      verified: true,
      authenticationInfo: {
        credentialID: 'test-passkey',
        newCounter: 1,
        userVerified: true,
        credentialDeviceType: 'singleDevice' as const,
        credentialBackedUp: false,
        origin: 'http://localhost:3000',
        rpID: 'localhost',
      },
    })),
  }
})

import { createApplet, createVersion, ensureWorkspace } from './applets'
import { getDatabase } from './db/client'
import { appletRun, workspace } from './db/schema'
import {
  beginHumanAuthorityRegistration,
  beginHumanAuthorization,
  completeHumanAuthorityRegistration,
  completeHumanAuthorization,
} from './human-authority'

const databaseEnabled = Boolean(process.env.DATABASE_URL)
const describeDatabase = databaseEnabled ? describe : describe.skip

describeDatabase('verified human authority', () => {
  const workspaceId = crypto.randomUUID()
  let appletId = ''
  let runId = ''

  beforeAll(async () => {
    await ensureWorkspace(workspaceId)
    const applet = await createApplet(workspaceId, {
      name: 'Authority specimen',
      description: 'Proves an exact passkey-bound lease.',
      medium: 'web-app',
    })
    appletId = applet.id
    const version = await createVersion(workspaceId, applet.id, {
      note: 'Authority specimen',
      inputs: [],
      definition: {
        kind: 'react-app',
        entry: 'src/App.tsx',
        files: [{ path: 'src/App.tsx', content: 'export default function App(){return <main><h1>Authority</h1></main>}' }],
        actions: [],
      },
    })
    const [run] = await getDatabase()
      .insert(appletRun)
      .values({
        workspaceId,
        appletId,
        appletVersionId: version.version.id,
        state: 'succeeded',
        input: {},
        output: { kind: 'web-app', channel: crypto.randomUUID(), html: '<!doctype html><html><head></head><body></body></html>' },
        completedAt: new Date(),
      })
      .returning({ id: appletRun.id })
    if (!run) throw new Error('The authority test did not create its run')
    runId = run.id
  })

  afterAll(async () => {
    if (!databaseEnabled) return
    await getDatabase().delete(workspace).where(eq(workspace.id, workspaceId))
  })

  it('registers user verification, issues one exact lease, and consumes the challenge', async () => {
    const registration = await beginHumanAuthorityRegistration(
      workspaceId,
      'localhost',
      'http://localhost:3000',
    )
    await expect(
      completeHumanAuthorityRegistration(workspaceId, registration.challengeId, { id: 'new' }),
    ).resolves.toMatchObject({ enrolled: true })

    const authorization = await beginHumanAuthorization(
      workspaceId,
      'localhost',
      'http://localhost:3000',
      { kind: 'autonomy-lease', appletId, runId, writes: 3, minutes: 5 },
    )
    const result = await completeHumanAuthorization(workspaceId, authorization.challengeId, {
      id: 'test-passkey',
    })
    expect(result).toMatchObject({
      kind: 'autonomy-lease',
      lease: { appletId, runId, grantedWrites: 3, remainingWrites: 3 },
    })
    await expect(
      completeHumanAuthorization(workspaceId, authorization.challengeId, { id: 'test-passkey' }),
    ).rejects.toMatchObject({ code: 'human_authority_challenge_expired' })
  })
})
