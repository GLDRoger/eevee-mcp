import 'server-only'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { publicOrigin } from './public-origin'

// Twice the 1.5 MB applet source limit plus slack: JSON string escaping can
// roughly double near-limit source bundles, and the advertised source
// headroom must be reachable through this boundary.
const DEFAULT_BODY_LIMIT = 3_200_000

export class RequestFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RequestFailure'
  }
}

export const requireSameOrigin = (request: NextRequest): void => {
  const origin = request.headers.get('origin')
  if (!origin || origin !== publicOrigin(request).origin) {
    throw new RequestFailure(403, 'invalid_origin', 'This request did not come from EEVEE')
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new RequestFailure(403, 'cross_site_request', 'Cross-site requests are not allowed')
  }
}

const concatenate = (chunks: readonly Uint8Array[], length: number): Uint8Array => {
  const joined = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

// Chunked bodies carry no Content-Length, so the declared-length check alone
// would let a client stream past the limit; bytes are counted as they arrive
// and the stream is dropped the moment the budget is exceeded.
const readBody = async (
  request: Request,
  maximumBytes: number,
  message: string,
): Promise<Uint8Array> => {
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RequestFailure(413, 'body_too_large', message)
  }
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maximumBytes) {
      await reader.cancel().catch(() => undefined)
      throw new RequestFailure(413, 'body_too_large', message)
    }
    chunks.push(value)
  }
  return concatenate(chunks, received)
}

export const parseJson = async <Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  maximumBytes = DEFAULT_BODY_LIMIT,
): Promise<z.output<Schema>> => {
  const text = new TextDecoder().decode(
    await readBody(request, maximumBytes, 'The request body is too large'),
  )
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new RequestFailure(400, 'invalid_json', 'The request body is not valid JSON')
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new RequestFailure(400, 'invalid_input', z.prettifyError(parsed.error))
  }
  return parsed.data
}

export const readBodyBytes = async (
  request: Request,
  maximumBytes: number,
  message: string,
): Promise<Uint8Array> => readBody(request, maximumBytes, message)

export const errorResponse = (error: unknown): NextResponse => {
  if (error instanceof RequestFailure) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    )
  }
  console.error('EEVEE request failed', error)
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'EEVEE could not complete this request' } },
    { status: 500 },
  )
}
