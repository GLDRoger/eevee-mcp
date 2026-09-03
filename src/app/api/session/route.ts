import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWorkspace } from '@/server/applets'
import { errorResponse, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, clearWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    return attachWorkspaceSession(
      NextResponse.json({ workspaceId: session.workspaceId }),
      session,
    )
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}

/**
 * Leave the workspace: the cookie is cleared and the next request starts an
 * empty one. There is no account, so this is the only sign-out there is and
 * it is one way; the passkey, applets, and files stay with the old workspace.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    requireSameOrigin(request)
    return clearWorkspaceSession(NextResponse.json({ left: true }))
  } catch (error) {
    return errorResponse(error)
  }
}
