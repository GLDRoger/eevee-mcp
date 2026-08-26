import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createAppletSchema } from '@/domain/applet'
import { createApplet, ensureWorkspace, listApplets } from '@/server/applets'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    return attachWorkspaceSession(
      NextResponse.json({ applets: await listApplets(session.workspaceId) }),
      session,
    )
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const input = await parseJson(request, createAppletSchema)
    const response = NextResponse.json(
      { applet: await createApplet(session.workspaceId, input) },
      { status: 201 },
    )
    return attachWorkspaceSession(response, session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
