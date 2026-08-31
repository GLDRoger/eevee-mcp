import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWorkspace } from '@/server/applets'
import { errorResponse } from '@/server/http'
import { getOfficeFile } from '@/server/office-files'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/files/[fileId]'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    const { fileId } = await context.params
    return attachWorkspaceSession(
      NextResponse.json({ detail: await getOfficeFile(session.workspaceId, fileId) }),
      session,
    )
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
