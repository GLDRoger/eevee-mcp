import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { completeRunSchema } from '@/domain/applet'
import { ensureWorkspace } from '@/server/applets'
import { completeRun } from '@/server/applet-runs'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/runs/[runId]/complete'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ runId }, input] = await Promise.all([
      context.params,
      parseJson(request, completeRunSchema),
    ])
    const run = await completeRun(session.workspaceId, runId, input)
    return attachWorkspaceSession(NextResponse.json({ run }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
