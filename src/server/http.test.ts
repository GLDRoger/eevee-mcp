import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseJson, readBodyBytes, requireSameOrigin } from './http'

// A chunked upload: no Content-Length, bytes arrive over several reads.
const streamed = (chunks: readonly string[], headers: Record<string, string> = {}) =>
  new Request('https://eevee.example/api/files', {
    method: 'POST',
    headers,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    }),
    // Node requires the duplex mode whenever a request body is a stream.
    ...({ duplex: 'half' } as object),
  })

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

describe('body readers', () => {
  it('reads a chunked body that fits the limit', async () => {
    const bytes = await readBodyBytes(streamed(['abc', 'def']), 6, 'too large')
    expect(new TextDecoder().decode(bytes)).toBe('abcdef')
    await expect(
      parseJson(streamed(['{"name":', '"eevee"}']), z.object({ name: z.string() }), 64),
    ).resolves.toEqual({ name: 'eevee' })
  })

  it('rejects a chunked body that grows past the limit without a Content-Length', async () => {
    let produced = 0
    const request = new Request('https://eevee.example/api/files', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          produced += 1
          controller.enqueue(new Uint8Array(1024))
        },
      }),
      ...({ duplex: 'half' } as object),
    })
    expect(request.headers.get('content-length')).toBeNull()
    await expect(readBodyBytes(request, 4096, 'too large')).rejects.toMatchObject({
      status: 413,
      code: 'body_too_large',
      message: 'too large',
    })
    expect(produced).toBeLessThan(16)
    await expect(
      parseJson(streamed(['{"name":"', 'x'.repeat(100), '"}']), z.object({ name: z.string() }), 64),
    ).rejects.toMatchObject({ status: 413, code: 'body_too_large' })
  })

  it('still rejects an oversized declared length before reading', async () => {
    await expect(
      readBodyBytes(streamed(['abc'], { 'content-length': '999' }), 8, 'too large'),
    ).rejects.toMatchObject({ status: 413, code: 'body_too_large' })
  })
})
