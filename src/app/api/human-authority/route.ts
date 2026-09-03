import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWorkspace } from '@/server/applets'
import { getHumanAuthorityStatus } from '@/server/human-authority'
import { errorResponse } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    return attachWorkspaceSession(
      NextResponse.json(await getHumanAuthorityStatus(session.workspaceId)),
      session,
    )
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
