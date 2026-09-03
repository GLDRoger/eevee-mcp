import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureWorkspace } from '@/server/applets'
import { spendHumanAuthorityLease } from '@/server/applet-actions'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

const inputSchema = z.strictObject({ leaseId: z.uuid() })

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/action-requests/[requestId]/lease'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ requestId }, { leaseId }] = await Promise.all([
      context.params,
      parseJson(request, inputSchema),
    ])
    const result = await spendHumanAuthorityLease(session.workspaceId, leaseId, requestId)
    return attachWorkspaceSession(NextResponse.json(result), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
