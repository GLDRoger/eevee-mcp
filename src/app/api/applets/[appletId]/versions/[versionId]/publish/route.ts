import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWorkspace, publishVersion } from '@/server/applets'
import { errorResponse, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/applets/[appletId]/versions/[versionId]/publish'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const { appletId, versionId } = await context.params
    await publishVersion(session.workspaceId, appletId, versionId)
    return attachWorkspaceSession(NextResponse.json({ published: true }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
