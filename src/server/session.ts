import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const COOKIE_NAME = 'eevee_workspace'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365
const workspaceIdSchema = z.uuid()

export interface WorkspaceSession {
  workspaceId: string
  fresh: boolean
}

const sessionSecret = (): string => {
  const value = process.env.EEVEE_SESSION_SECRET
  if (value && value.length >= 32) return value
  if (process.env.NODE_ENV !== 'production') return 'eevee-mcp-local-session-secret-2026'
  throw new Error('EEVEE_SESSION_SECRET must contain at least 32 characters')
}

/** Throws the same error the first API call would; the health probe uses it so a deploy without a secret reports unhealthy instead of 500ing on every request. */
export const assertSessionSecret = (): void => {
  sessionSecret()
}

const signature = (workspaceId: string): string =>
  createHmac('sha256', sessionSecret()).update(workspaceId).digest('base64url')

export const privateDigest = (scope: string, value: string): string =>
  createHmac('sha256', sessionSecret()).update(scope).update('\0').update(value).digest('hex')

const validSignature = (workspaceId: string, candidate: string): boolean => {
  const expected = Buffer.from(signature(workspaceId))
  const received = Buffer.from(candidate)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

const readToken = (value: string | undefined): string | null => {
  const [workspaceId, candidate, extra] = value?.split('.') ?? []
  if (extra !== undefined || !workspaceId || !candidate) return null
  if (!workspaceIdSchema.safeParse(workspaceId).success) return null
  return validSignature(workspaceId, candidate) ? workspaceId : null
}

export const workspaceSession = (request: NextRequest): WorkspaceSession => {
  const existing = readToken(request.cookies.get(COOKIE_NAME)?.value)
  return existing
    ? { workspaceId: existing, fresh: false }
    : { workspaceId: crypto.randomUUID(), fresh: true }
}

/** Forget the browser's workspace cookie. The workspace row and its data stay; nothing points at them any more. */
export const clearWorkspaceSession = (response: NextResponse): NextResponse => {
  response.cookies.set(COOKIE_NAME, '', { httpOnly: true, maxAge: 0, path: '/', sameSite: 'strict' })
  return response
}

export const attachWorkspaceSession = (
  response: NextResponse,
  session: WorkspaceSession,
): NextResponse => {
  if (!session.fresh) return response
  response.cookies.set(COOKIE_NAME, `${session.workspaceId}.${signature(session.workspaceId)}`, {
    httpOnly: true,
    maxAge: MAX_AGE_SECONDS,
    path: '/',
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    priority: 'high',
  })
  return response
}
