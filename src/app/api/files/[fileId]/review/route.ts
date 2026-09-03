import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { applyDocumentRedactionsSchema } from '@/domain/document-review'
import { ensureWorkspace } from '@/server/applets'
import { scanDocumentReview } from '@/server/document-review'
import { requireHumanAuthority } from '@/server/human-authority'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/files/[fileId]/review'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    const { fileId } = await context.params
    return attachWorkspaceSession(
      NextResponse.json({ review: await scanDocumentReview(session.workspaceId, fileId) }),
      session,
    )
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/files/[fileId]/review'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    await Promise.all([
      context.params,
      parseJson(request, applyDocumentRedactionsSchema),
    ])
    return requireHumanAuthority()
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
