import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { requireSameOrigin } from './http'

describe('requireSameOrigin', () => {
  it('accepts the page origin and rejects cross-site mutations', () => {
    expect(() =>
      requireSameOrigin(
        new NextRequest('https://eevee.example/api/applets', {
          method: 'POST',
          headers: { origin: 'https://eevee.example', 'sec-fetch-site': 'same-origin' },
        }),
      ),
    ).not.toThrow()

    expect(() =>
      requireSameOrigin(
        new NextRequest('https://eevee.example/api/applets', {
          method: 'POST',
          headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
        }),
      ),
    ).toThrowError(expect.objectContaining({ status: 403, code: 'invalid_origin' }))
  })
})
