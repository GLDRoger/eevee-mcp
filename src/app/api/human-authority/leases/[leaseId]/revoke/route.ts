import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWorkspace } from '@/server/applets'
import { revokeHumanAuthorityLease } from '@/server/human-authority'
import { errorResponse, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/human-authority/leases/[leaseId]/revoke'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const { leaseId } = await context.params
    await revokeHumanAuthorityLease(session.workspaceId, leaseId)
    return attachWorkspaceSession(NextResponse.json({ revoked: true }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
