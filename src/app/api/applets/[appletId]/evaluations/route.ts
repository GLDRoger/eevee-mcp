import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { startEvaluationSchema } from '@/domain/evaluation'
import { ensureWorkspace } from '@/server/applets'
import { startEvaluation } from '@/server/evaluations'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/applets/[appletId]/evaluations'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ appletId }, input] = await Promise.all([
      context.params,
      parseJson(request, startEvaluationSchema),
    ])
    const plan = await startEvaluation(session.workspaceId, appletId, input)
    return attachWorkspaceSession(NextResponse.json({ plan }, { status: 201 }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
