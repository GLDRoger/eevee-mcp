import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWorkspace } from '@/server/applets'
import { beginHumanAuthorityRegistration } from '@/server/human-authority'
import { errorResponse, requireSameOrigin } from '@/server/http'
import { publicOrigin } from '@/server/public-origin'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    const origin = publicOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const result = await beginHumanAuthorityRegistration(
      session.workspaceId,
      origin.hostname,
      origin.origin,
    )
    return attachWorkspaceSession(NextResponse.json(result), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
