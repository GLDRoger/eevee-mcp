import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { publicOrigin } from './public-origin'
import { requireSameOrigin } from './http'

const request = (headers: Record<string, string>) =>
  new NextRequest('http://localhost:3000/api/applets', { method: 'POST', headers })

describe('publicOrigin', () => {
  afterEach(() => {
    delete process.env.EEVEE_PUBLIC_ORIGIN
  })

  it('uses the proxy headers a platform sets in front of next start', () => {
    const origin = publicOrigin(
      request({ host: '10.0.0.4:3000', 'x-forwarded-host': 'eevee.example.com', 'x-forwarded-proto': 'https' }),
    )
    expect(origin.origin).toBe('https://eevee.example.com')
    expect(origin.hostname).toBe('eevee.example.com')
  })

  it('falls back to Host with the request protocol', () => {
    expect(publicOrigin(request({ host: '127.0.0.1:3100' })).origin).toBe('http://127.0.0.1:3100')
  })

  it('prefers EEVEE_PUBLIC_ORIGIN over every header', () => {
    process.env.EEVEE_PUBLIC_ORIGIN = 'https://eevee.example.com/'
    expect(publicOrigin(request({ host: 'evil.example', 'x-forwarded-host': 'evil.example' })).origin).toBe(
      'https://eevee.example.com',
    )
  })

  it('same-origin check accepts the deployed hostname and rejects others', () => {
    const deployed = { host: 'eevee.example.com', 'x-forwarded-proto': 'https', 'sec-fetch-site': 'same-origin' }
    expect(() => requireSameOrigin(request({ ...deployed, origin: 'https://eevee.example.com' }))).not.toThrow()
    expect(() => requireSameOrigin(request({ ...deployed, origin: 'https://attacker.example' }))).toThrow(
      'did not come from EEVEE',
    )
    expect(() => requireSameOrigin(request({ ...deployed, origin: 'http://eevee.example.com' }))).toThrow(
      'did not come from EEVEE',
    )
  })
})
