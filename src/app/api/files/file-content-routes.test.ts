import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as table } from './[fileId]/table/route'
import { GET as text } from './[fileId]/text/route'

// Same-origin GET fetches carry no Origin header, so these reads must not be
// gated by the mutation-only same-origin check.
const read = (url: string) => new NextRequest(url, { method: 'GET' })

const describeDatabase = process.env.DATABASE_URL ? describe : describe.skip

describeDatabase('file content GET routes', () => {
  it('serves table reads without an Origin header', async () => {
    const fileId = crypto.randomUUID()
    const response = await table(read(`http://localhost/api/files/${fileId}/table`), {
      params: Promise.resolve({ fileId }),
    })
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'file_not_found' } })
  })

  it('serves text reads without an Origin header', async () => {
    const fileId = crypto.randomUUID()
    const response = await text(read(`http://localhost/api/files/${fileId}/text`), {
      params: Promise.resolve({ fileId }),
    })
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'file_not_found' } })
  })
})
