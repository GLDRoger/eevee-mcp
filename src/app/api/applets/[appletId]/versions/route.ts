import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createVersionSchema } from '@/domain/applet'
import { createVersion, ensureWorkspace } from '@/server/applets'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/applets/[appletId]/versions'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ appletId }, input] = await Promise.all([
      context.params,
      parseJson(request, createVersionSchema),
    ])
    const result = await createVersion(session.workspaceId, appletId, input)
    return attachWorkspaceSession(NextResponse.json(result, { status: 201 }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
