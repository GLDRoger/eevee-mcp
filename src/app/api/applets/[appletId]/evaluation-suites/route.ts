import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createEvaluationSuiteSchema } from '@/domain/evaluation'
import { ensureWorkspace } from '@/server/applets'
import { createEvaluationSuite } from '@/server/evaluation-suites'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/applets/[appletId]/evaluation-suites'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ appletId }, input] = await Promise.all([
      context.params,
      parseJson(request, createEvaluationSuiteSchema),
    ])
    const suite = await createEvaluationSuite(session.workspaceId, appletId, input)
    return attachWorkspaceSession(NextResponse.json({ suite }, { status: 201 }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
