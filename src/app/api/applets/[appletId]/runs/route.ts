import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createRunSchema } from '@/domain/applet'
import { ensureWorkspace } from '@/server/applets'
import { runApplet } from '@/server/applet-runs'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/applets/[appletId]/runs'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ appletId }, input] = await Promise.all([
      context.params,
      parseJson(request, createRunSchema),
    ])
    const run = await runApplet(session.workspaceId, appletId, input)
    return attachWorkspaceSession(NextResponse.json({ run }, { status: 201 }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
