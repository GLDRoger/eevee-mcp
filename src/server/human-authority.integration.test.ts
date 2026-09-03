import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { ensureWorkspace } from './applets'
import { getDatabase } from './db/client'
import { humanAuthorityChallenge, workspace } from './db/schema'
import {
  beginHumanAuthorityRegistration,
  getHumanAuthorityStatus,
} from './human-authority'

const databaseEnabled = Boolean(process.env.DATABASE_URL)
const describeDatabase = databaseEnabled ? describe : describe.skip

describeDatabase('human authority', () => {
  const workspaceId = crypto.randomUUID()

  beforeAll(async () => ensureWorkspace(workspaceId))

  afterAll(async () => {
    if (!databaseEnabled) return
    await getDatabase().delete(workspace).where(eq(workspace.id, workspaceId))
  })

  it('creates a short-lived user-verifying passkey registration challenge', async () => {
    expect(await getHumanAuthorityStatus(workspaceId)).toEqual({ enrolled: false, createdAt: null })
    const started = await beginHumanAuthorityRegistration(
      workspaceId,
      'localhost',
      'http://localhost:3000',
    )
    expect(started).toMatchObject({
      summary: 'Create the human passkey for this workspace',
      options: {
        rp: { id: 'localhost' },
        authenticatorSelection: { userVerification: 'required' },
      },
    })
    const [stored] = await getDatabase()
      .select()
      .from(humanAuthorityChallenge)
      .where(eq(humanAuthorityChallenge.id, started.challengeId))
    expect(stored).toMatchObject({
      workspaceId,
      kind: 'registration',
      rpId: 'localhost',
      origin: 'http://localhost:3000',
    })
    expect(stored?.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })
})
