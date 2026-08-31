import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { appletActionRequestOperationSchema } from '@/domain/applet-action'
import { ensureWorkspace } from '@/server/applets'
import {
  approveAppletActionRequest,
  completeAppletActionRequest,
  failAppletActionRequest,
  getAppletActionRequest,
  rejectAppletActionRequest,
  startAppletActionRequest,
} from '@/server/applet-actions'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/action-requests/[requestId]'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    const { requestId } = await context.params
    return attachWorkspaceSession(
      NextResponse.json({
        request: await getAppletActionRequest(session.workspaceId, requestId),
      }),
      session,
    )
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/action-requests/[requestId]'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ requestId }, input] = await Promise.all([
      context.params,
      parseJson(request, appletActionRequestOperationSchema),
    ])
    const actionRequest = await (async () => {
      switch (input.operation) {
        case 'approve':
          return approveAppletActionRequest(session.workspaceId, requestId)
        case 'reject':
          return rejectAppletActionRequest(session.workspaceId, requestId)
        case 'start':
          return startAppletActionRequest(session.workspaceId, requestId)
        case 'complete':
          return completeAppletActionRequest(session.workspaceId, requestId, input.result)
        case 'fail':
          return failAppletActionRequest(session.workspaceId, requestId, input.error)
        default: {
          const unreachable: never = input
          return unreachable
        }
      }
    })()
    return attachWorkspaceSession(NextResponse.json({ request: actionRequest }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
