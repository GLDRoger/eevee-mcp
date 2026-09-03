import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ensureWorkspace } from '@/server/applets'
import { errorResponse, readBodyBytes, requireSameOrigin, RequestFailure } from '@/server/http'
import { createOfficeFile, listOfficeFiles } from '@/server/office-files'
import { MAX_OFFICE_FILE_BYTES } from '@/server/office-file-validation'
import { attachWorkspaceSession, workspaceSession } from '@/server/session'

const decodedFileNote = (request: NextRequest): string | undefined => {
  const encoded = request.headers.get('x-eevee-file-note')
  if (!encoded) return undefined
  try {
    const note = decodeURIComponent(encoded).trim()
    return note.length > 0 && note.length <= 120 ? note : undefined
  } catch {
    return undefined
  }
}

const decodedFileName = (request: NextRequest): string => {
  const encoded = request.headers.get('x-eevee-file-name')
  if (!encoded || encoded.length > 600) {
    throw new RequestFailure(400, 'file_name_required', 'Choose a named Office file to upload')
  }
  try {
    return decodeURIComponent(encoded)
  } catch {
    throw new RequestFailure(400, 'invalid_file_name', 'The file name is not valid UTF-8')
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = workspaceSession(request)
  try {
    await ensureWorkspace(session.workspaceId)
    return attachWorkspaceSession(
      NextResponse.json({ files: await listOfficeFiles(session.workspaceId) }),
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
    const [name, bytes] = await Promise.all([
      decodedFileName(request),
      readBodyBytes(request, MAX_OFFICE_FILE_BYTES, 'Office files must be 25 MB or smaller'),
    ])
    const response = NextResponse.json(
      { file: await createOfficeFile(session.workspaceId, name, bytes, decodedFileNote(request)) },
      { status: 201 },
    )
    return attachWorkspaceSession(response, session)
  } catch (error) {
    return attachWorkspaceSession(errorResponse(error), session)
  }
}
