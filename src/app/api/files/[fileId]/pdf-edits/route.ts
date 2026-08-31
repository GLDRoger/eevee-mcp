import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { pdfEditRequestSchema } from '@/domain/pdf'
import { ensureWorkspace } from '@/server/applets'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { editPdfFile } from '@/server/office-files'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/files/[fileId]/pdf-edits'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ fileId }, input] = await Promise.all([
      context.params,
      parseJson(request, pdfEditRequestSchema),
    ])
    const file = await editPdfFile(
      session.workspaceId,
      fileId,
      input.baseVersionId,
      input.edit,
    )
    return attachWorkspaceSession(NextResponse.json({ file }, { status: 201 }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
