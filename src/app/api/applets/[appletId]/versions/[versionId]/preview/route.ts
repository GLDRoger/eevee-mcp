import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWorkspace, previewVersion } from '@/server/applets'
import { errorResponse } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/applets/[appletId]/versions/[versionId]/preview'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    const { appletId, versionId } = await context.params
    const preview = await previewVersion(session.workspaceId, appletId, versionId)
    return attachWorkspaceSession(NextResponse.json({ preview }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
