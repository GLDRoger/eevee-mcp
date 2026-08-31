import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { referenceAppletSlugSchema } from '@/domain/reference-applet'
import { ensureWorkspace } from '@/server/applets'
import { errorResponse, requireSameOrigin } from '@/server/http'
import { installReferenceApplet } from '@/server/reference-applets'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/reference-applets/[slug]'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const { slug } = await context.params
    const parsed = referenceAppletSlugSchema.safeParse(slug)
    if (!parsed.success) return attachWorkspaceSession(NextResponse.json({ error: { code: 'reference_not_found', message: 'This reference applet does not exist' } }, { status: 404 }), session)
    return attachWorkspaceSession(
      NextResponse.json({ applet: await installReferenceApplet(session.workspaceId, parsed.data) }),
      session,
    )
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
