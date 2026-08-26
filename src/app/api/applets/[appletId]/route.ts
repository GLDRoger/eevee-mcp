import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWorkspace, getApplet } from '@/server/applets'
import { errorResponse } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/applets/[appletId]'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    const { appletId } = await context.params
    return attachWorkspaceSession(
      NextResponse.json({ detail: await getApplet(session.workspaceId, appletId) }),
      session,
    )
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
