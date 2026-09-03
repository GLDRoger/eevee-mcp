import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as publish } from './applets/[appletId]/versions/[versionId]/publish/route'
import { POST as decideAction } from './action-requests/[requestId]/route'
import { POST as redact } from './files/[fileId]/review/route'
import { DELETE as leaveWorkspace } from './session/route'

const mutation = (url: string, body: unknown) =>
  new NextRequest(url, {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

const describeDatabase = process.env.DATABASE_URL ? describe : describe.skip

describe('workspace leave', () => {
  it('refuses a cross-origin leave and clears the cookie for a same-origin one', async () => {
    const foreign = await leaveWorkspace(
      new NextRequest('http://localhost/api/session', { method: 'DELETE', headers: { origin: 'https://evil.example' } }),
    )
    expect(foreign.status).toBe(403)
    const own = await leaveWorkspace(
      new NextRequest('http://localhost/api/session', {
        method: 'DELETE',
        headers: { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' },
      }),
    )
    expect(own.status).toBe(200)
    await expect(own.json()).resolves.toEqual({ left: true })
    expect(own.headers.get('set-cookie')).toMatch(/eevee_workspace=;.*Max-Age=0/)
  })
})

describeDatabase('human-only route gates', () => {
  it('rejects direct publish without a passkey authorization flow', async () => {
    const appletId = crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const response = await publish(
      mutation(`http://localhost/api/applets/${appletId}/versions/${versionId}/publish`, {}),
      { params: Promise.resolve({ appletId, versionId }) },
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'human_authority_required' },
    })
  })

  it('rejects direct action decisions and redaction', async () => {
    const requestId = crypto.randomUUID()
    const actionResponse = await decideAction(
      mutation(`http://localhost/api/action-requests/${requestId}`, { operation: 'approve' }),
      { params: Promise.resolve({ requestId }) },
    )
    expect(actionResponse.status).toBe(403)

    const fileId = crypto.randomUUID()
    const redactionResponse = await redact(
      mutation(`http://localhost/api/files/${fileId}/review`, {
        baseVersionId: crypto.randomUUID(),
        findingIds: ['a'.repeat(64)],
      }),
      { params: Promise.resolve({ fileId }) },
    )
    expect(redactionResponse.status).toBe(403)
  })
})
