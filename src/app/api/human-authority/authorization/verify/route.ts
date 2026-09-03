import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { humanAuthorityAuthorizationVerifySchema } from '@/domain/human-authority'
import { ensureWorkspace } from '@/server/applets'
import { completeHumanAuthorization } from '@/server/human-authority'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const input = await parseJson(request, humanAuthorityAuthorizationVerifySchema, 64_000)
    const result = await completeHumanAuthorization(
      session.workspaceId,
      input.challengeId,
      input.response,
    )
    return attachWorkspaceSession(NextResponse.json(result), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
