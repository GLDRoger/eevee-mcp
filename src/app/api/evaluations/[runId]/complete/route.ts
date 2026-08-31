import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { completeEvaluationSchema } from '@/domain/evaluation'
import { ensureWorkspace } from '@/server/applets'
import { completeEvaluation } from '@/server/evaluations'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/evaluations/[runId]/complete'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ runId }, input] = await Promise.all([
      context.params,
      parseJson(request, completeEvaluationSchema, 300_000),
    ])
    const run = await completeEvaluation(session.workspaceId, runId, input)
    return attachWorkspaceSession(NextResponse.json({ run }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
