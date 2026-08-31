import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { readOfficeFileBytes } from '@/server/office-files'
import { officeFileText } from '@/server/office-file-content'
import { errorResponse, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/files/[fileId]/text'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    const { fileId } = await context.params
    const versionId = request.nextUrl.searchParams.get('versionId') ?? undefined
    const { file, bytes } = await readOfficeFileBytes(session.workspaceId, fileId, versionId)
    const text = await officeFileText(file.medium, bytes)
    return attachWorkspaceSession(NextResponse.json({ text }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
