import { describe, expect, it } from 'vitest'
import { GET } from './route'

const describeDatabase = process.env.DATABASE_URL ? describe : describe.skip

describeDatabase('health route', () => {
  it('reports ok without minting a workspace session', async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    await expect(response.json()).resolves.toEqual({ ok: true })
  })
})
