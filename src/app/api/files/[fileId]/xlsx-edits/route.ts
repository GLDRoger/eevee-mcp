import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { officeFileVersionIdSchema } from '@/domain/office-file'
import { workbookSaveRequestSchema } from '@/office/sheets/shared/desktop-api'
import { ensureWorkspace } from '@/server/applets'
import { errorResponse, parseJson, requireSameOrigin } from '@/server/http'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'
import { editSpreadsheetFile } from '@/server/spreadsheet-edits'

const requestSchema = z
  .object({
    baseVersionId: officeFileVersionIdSchema,
    request: workbookSaveRequestSchema,
  })
  .strict()

const MAX_SPREADSHEET_EDIT_BYTES = 32_000_000

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/files/[fileId]/xlsx-edits'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const [{ fileId }, input] = await Promise.all([
      context.params,
      parseJson(request, requestSchema, MAX_SPREADSHEET_EDIT_BYTES),
    ])
    const result = await editSpreadsheetFile(
      session.workspaceId,
      fileId,
      input.baseVersionId,
      input.request,
    )
    return attachWorkspaceSession(NextResponse.json(result, { status: 201 }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
