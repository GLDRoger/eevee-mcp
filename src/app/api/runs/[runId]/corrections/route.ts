import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createCorrectionSchema } from '@/domain/applet'
import { createCorrection, ensureWorkspace } from '@/server/applets'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/runs/[runId]/corrections'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ runId }, input] = await Promise.all([
      context.params,
      parseJson(request, createCorrectionSchema),
    ])
    const correction = await createCorrection(session.workspaceId, runId, input)
    return attachWorkspaceSession(NextResponse.json({ correction }, { status: 201 }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
