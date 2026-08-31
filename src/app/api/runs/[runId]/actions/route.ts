import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createAppletActionRequestSchema } from '@/domain/applet-action'
import { ensureWorkspace } from '@/server/applets'
import {
  createAppletActionRequest,
  listAppletActionRequests,
} from '@/server/applet-actions'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/runs/[runId]/actions'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    const { runId } = await context.params
    return attachWorkspaceSession(
      NextResponse.json({ requests: await listAppletActionRequests(session.workspaceId, runId) }),
      session,
    )
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/runs/[runId]/actions'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ runId }, input] = await Promise.all([
      context.params,
      parseJson(request, createAppletActionRequestSchema),
    ])
    return attachWorkspaceSession(
      NextResponse.json({
        request: await createAppletActionRequest(session.workspaceId, runId, input),
      }),
      session,
    )
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
