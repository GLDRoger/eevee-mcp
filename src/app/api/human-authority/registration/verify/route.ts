import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { humanAuthorityRegistrationVerifySchema } from '@/domain/human-authority'
import { ensureWorkspace } from '@/server/applets'
import { completeHumanAuthorityRegistration } from '@/server/human-authority'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const input = await parseJson(request, humanAuthorityRegistrationVerifySchema, 64_000)
    const status = await completeHumanAuthorityRegistration(
      session.workspaceId,
      input.challengeId,
      input.response,
    )
    return attachWorkspaceSession(NextResponse.json(status), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
