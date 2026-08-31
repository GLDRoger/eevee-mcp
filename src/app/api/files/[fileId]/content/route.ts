import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ownedArrayBuffer } from '@/domain/bytes'
import { officeFileMediaType, officeFileVersionIdSchema } from '@/domain/office-file'
import { ensureWorkspace } from '@/server/applets'
import { errorResponse, RequestFailure } from '@/server/http'
import { readOfficeFileBytes } from '@/server/office-files'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/files/[fileId]/content'>,
): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    const { fileId } = await context.params
    const unsafeVersionId = request.nextUrl.searchParams.get('versionId')
    const parsedVersionId = unsafeVersionId
      ? officeFileVersionIdSchema.safeParse(unsafeVersionId)
      : null
    if (parsedVersionId && !parsedVersionId.success) {
      throw new RequestFailure(400, 'invalid_version_id', 'The file version id is not valid')
    }
    const { file, bytes } = await readOfficeFileBytes(
      session.workspaceId,
      fileId,
      parsedVersionId?.data,
    )
    const response = new NextResponse(ownedArrayBuffer(bytes), {
      headers: {
        'cache-control': 'private, no-store',
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'content-length': String(bytes.length),
        'content-type': officeFileMediaType(file.medium),
        'x-content-type-options': 'nosniff',
      },
    })
    return attachWorkspaceSession(response, session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
