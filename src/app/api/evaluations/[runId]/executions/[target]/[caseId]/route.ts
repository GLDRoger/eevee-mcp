import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { evaluationTargetSchema } from '@/domain/evaluation'
import { ensureWorkspace } from '@/server/applets'
import { getEvaluationExecution } from '@/server/evaluations'
import { errorResponse, RequestFailure } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/evaluations/[runId]/executions/[target]/[caseId]'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    const { runId, target, caseId } = await context.params
    const parsedTarget = evaluationTargetSchema.safeParse(target)
    if (!parsedTarget.success) {
      throw new RequestFailure(400, 'invalid_evaluation_target', 'Use candidate or baseline')
    }
    const execution = await getEvaluationExecution(
      session.workspaceId,
      runId,
      parsedTarget.data,
      caseId,
    )
    return attachWorkspaceSession(NextResponse.json({ execution }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
