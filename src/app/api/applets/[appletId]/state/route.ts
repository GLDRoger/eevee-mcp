import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { writeAppletValueSchema } from '@/domain/applet'
import {
  ensureWorkspace,
  readAppletValues,
  writeAppletValue,
} from '@/server/applets'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/applets/[appletId]/state'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    const { appletId } = await context.params
    const values = await readAppletValues(session.workspaceId, appletId)
    return attachWorkspaceSession(NextResponse.json({ values }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}

export async function PUT(
  request: NextRequest,
  context: RouteContext<'/api/applets/[appletId]/state'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ appletId }, input] = await Promise.all([
      context.params,
      parseJson(request, writeAppletValueSchema, 70_000),
    ])
    const value = await writeAppletValue(session.workspaceId, appletId, input.key, input.value)
    return attachWorkspaceSession(NextResponse.json({ value }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
