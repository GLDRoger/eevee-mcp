import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWorkspace } from '@/server/applets'
import { getEvaluationRun } from '@/server/evaluations'
import { errorResponse } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/evaluations/[runId]'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    const { runId } = await context.params
    const run = await getEvaluationRun(session.workspaceId, runId)
    return attachWorkspaceSession(NextResponse.json({ run }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
