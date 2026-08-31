import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { dismissCorrection, ensureWorkspace } from '@/server/applets'
import { errorResponse, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/corrections/[correctionId]/dismiss'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const { correctionId } = await context.params
    const correction = await dismissCorrection(session.workspaceId, correctionId)
    return attachWorkspaceSession(NextResponse.json({ correction }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
