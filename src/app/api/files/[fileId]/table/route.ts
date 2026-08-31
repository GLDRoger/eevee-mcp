import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { readOfficeFileBytes } from '@/server/office-files'
import { xlsxTable } from '@/server/office-file-content'
import { RequestFailure, errorResponse, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/files/[fileId]/table'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    const { fileId } = await context.params
    const versionId = request.nextUrl.searchParams.get('versionId') ?? undefined
    const { file, bytes } = await readOfficeFileBytes(session.workspaceId, fileId, versionId)
    if (file.medium !== 'spreadsheet') {
      throw new RequestFailure(409, 'file_medium_mismatch', 'Tables are read from spreadsheets')
    }
    return attachWorkspaceSession(NextResponse.json({ sheets: xlsxTable(bytes) }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
