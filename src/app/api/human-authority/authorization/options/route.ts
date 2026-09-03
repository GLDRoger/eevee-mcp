import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { humanAuthorityAuthorizationOptionsSchema } from '@/domain/human-authority'
import { ensureWorkspace } from '@/server/applets'
import { beginHumanAuthorization } from '@/server/human-authority'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { publicOrigin } from '@/server/public-origin'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    const origin = publicOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const { scope } = await parseJson(request, humanAuthorityAuthorizationOptionsSchema, 16_000)
    const result = await beginHumanAuthorization(
      session.workspaceId,
      origin.hostname,
      origin.origin,
      scope,
    )
    return attachWorkspaceSession(NextResponse.json(result), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
