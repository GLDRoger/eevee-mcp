import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { officeFileVersionIdSchema } from '@/domain/office-file'
import { ensureWorkspace } from '@/server/applets'
import { errorResponse, readBodyBytes, requireSameOrigin, RequestFailure } from '@/server/http'
import { saveOfficeFile } from '@/server/office-files'
import { MAX_OFFICE_FILE_BYTES } from '@/server/office-file-validation'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/files/[fileId]/versions'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    requireSameOrigin(request)
    await ensureWorkspace(session.workspaceId)
    const baseVersion = officeFileVersionIdSchema.safeParse(
      request.headers.get('x-eevee-base-version-id'),
    )
    if (!baseVersion.success) {
      throw new RequestFailure(
        400,
        'base_version_required',
        'Reload the file before saving this edit',
      )
    }
    const [{ fileId }, bytes] = await Promise.all([
      context.params,
      readBodyBytes(request, MAX_OFFICE_FILE_BYTES, 'Office files must be 25 MB or smaller'),
    ])
    const file = await saveOfficeFile(session.workspaceId, fileId, baseVersion.data, bytes)
    return attachWorkspaceSession(NextResponse.json({ file }, { status: 201 }), session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
