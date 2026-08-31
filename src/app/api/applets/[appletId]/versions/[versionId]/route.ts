import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWorkspace, getAppletVersion } from '@/server/applets'
import { errorResponse } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/applets/[appletId]/versions/[versionId]'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    const { appletId, versionId } = await context.params
    return attachWorkspaceSession(
      NextResponse.json(await getAppletVersion(session.workspaceId, appletId, versionId)),
      session,
    )
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
