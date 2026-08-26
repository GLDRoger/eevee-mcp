import 'server-only'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const DEFAULT_BODY_LIMIT = 1_600_000

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
  if (!origin || origin !== request.nextUrl.origin) {
    throw new RequestFailure(403, 'invalid_origin', 'This request did not come from EEVEE')
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new RequestFailure(403, 'cross_site_request', 'Cross-site requests are not allowed')
  }
}

export const parseJson = async <Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  maximumBytes = DEFAULT_BODY_LIMIT,
): Promise<z.output<Schema>> => {
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RequestFailure(413, 'body_too_large', 'The request body is too large')
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new RequestFailure(413, 'body_too_large', 'The request body is too large')
  }
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
