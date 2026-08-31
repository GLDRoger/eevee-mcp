import 'server-only'
import { createHash } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  officeFileDetailSchema,
  officeFileIdSchema,
  officeFileSummarySchema,
  officeFileVersionIdSchema,
  officeFileVersionSchema,
  type OfficeFileDetail,
  type OfficeFileSummary,
} from '@/domain/office-file'
import { applyPdfEdit, type PdfEdit } from '@/domain/pdf'
import { getDatabase } from './db/client'
import { officeFile, officeFileVersion } from './db/schema'
import { RequestFailure } from './http'
import { validateOfficeFile } from './office-file-validation'

const checksum = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

const fileIdAtBoundary = (value: string): string => {
  const parsed = officeFileIdSchema.safeParse(value)
  if (!parsed.success) throw new RequestFailure(400, 'invalid_file_id', 'The file id is not valid')
  return parsed.data
}

const latestVersionQuery = (workspaceId: string) =>
  getDatabase()
    .selectDistinctOn([officeFileVersion.fileId], {
      id: officeFileVersion.id,
      fileId: officeFileVersion.fileId,
      version: officeFileVersion.version,
      size: officeFileVersion.size,
      sha256: officeFileVersion.sha256,
    })
    .from(officeFileVersion)
    .where(eq(officeFileVersion.workspaceId, workspaceId))
    .orderBy(officeFileVersion.fileId, desc(officeFileVersion.version))
    .as('latest_office_file_version')

const summarySelection = (workspaceId: string) => {
  const latest = latestVersionQuery(workspaceId)
  return getDatabase()
    .select({
      id: officeFile.id,
      name: officeFile.name,
      medium: officeFile.medium,
      state: officeFile.state,
      versionId: latest.id,
      version: latest.version,
      size: latest.size,
      sha256: latest.sha256,
      createdAt: officeFile.createdAt,
      updatedAt: officeFile.updatedAt,
    })
    .from(officeFile)
    .innerJoin(
      latest,
      and(eq(latest.fileId, officeFile.id), eq(officeFile.workspaceId, workspaceId)),
    )
}

const serializedSummary = (row: {
  id: string
  name: string
  medium: 'document' | 'spreadsheet' | 'presentation' | 'pdf'
  state: 'active' | 'archived'
  versionId: string
  version: number
  size: number
  sha256: string
  createdAt: Date
  updatedAt: Date
}): OfficeFileSummary =>
  officeFileSummarySchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })

export const listOfficeFiles = async (workspaceId: string): Promise<OfficeFileSummary[]> => {
  const rows = await summarySelection(workspaceId)
    .where(and(eq(officeFile.workspaceId, workspaceId), eq(officeFile.state, 'active')))
    .orderBy(desc(officeFile.updatedAt), officeFile.name)
  return rows.map(serializedSummary)
}

export const getOfficeFileSummary = async (
  workspaceId: string,
  fileId: string,
): Promise<OfficeFileSummary> => {
  const validatedFileId = fileIdAtBoundary(fileId)
  const [row] = await summarySelection(workspaceId)
    .where(and(eq(officeFile.workspaceId, workspaceId), eq(officeFile.id, validatedFileId)))
    .limit(1)
  if (!row) throw new RequestFailure(404, 'file_not_found', 'This Office file does not exist')
  return serializedSummary(row)
}

export const getOfficeFile = async (
  workspaceId: string,
  fileId: string,
): Promise<OfficeFileDetail> => {
  const [file, rows] = await Promise.all([
    getOfficeFileSummary(workspaceId, fileId),
    getDatabase()
      .select({
        id: officeFileVersion.id,
        fileId: officeFileVersion.fileId,
        version: officeFileVersion.version,
        size: officeFileVersion.size,
        sha256: officeFileVersion.sha256,
        note: officeFileVersion.note,
        createdAt: officeFileVersion.createdAt,
      })
      .from(officeFileVersion)
      .where(
        and(
          eq(officeFileVersion.workspaceId, workspaceId),
          eq(officeFileVersion.fileId, fileId),
        ),
      )
      .orderBy(desc(officeFileVersion.version)),
  ])
  return officeFileDetailSchema.parse({
    file,
    versions: rows.map((row) =>
      officeFileVersionSchema.parse({ ...row, createdAt: row.createdAt.toISOString() }),
    ),
  })
}

export const createOfficeFile = async (
  workspaceId: string,
  unsafeName: string,
  bytes: Uint8Array,
): Promise<OfficeFileSummary> => {
  const identity = validateOfficeFile(unsafeName, bytes)
  const sha256 = checksum(bytes)
  const fileId = await getDatabase().transaction(async (transaction) => {
    const [file] = await transaction
      .insert(officeFile)
      .values({ workspaceId, name: identity.name, medium: identity.medium })
      .returning({ id: officeFile.id })
    if (!file) throw new Error('Office file creation returned no row')
    await transaction.insert(officeFileVersion).values({
      workspaceId,
      fileId: file.id,
      version: 1,
      bytes,
      size: bytes.length,
      sha256,
      note: 'Imported into EEVEE',
    })
    return file.id
  })
  return getOfficeFileSummary(workspaceId, fileId)
}

export const saveOfficeFile = async (
  workspaceId: string,
  fileId: string,
  baseVersionId: string,
  bytes: Uint8Array,
): Promise<OfficeFileSummary> => {
  const current = await getOfficeFileSummary(workspaceId, fileId)
  validateOfficeFile(current.name, bytes)
  const sha256 = checksum(bytes)
  await getDatabase().transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${fileId}, 0))`)
    const [latest] = await transaction
      .select({
        id: officeFileVersion.id,
        version: officeFileVersion.version,
        sha256: officeFileVersion.sha256,
      })
      .from(officeFileVersion)
      .where(
        and(
          eq(officeFileVersion.workspaceId, workspaceId),
          eq(officeFileVersion.fileId, fileId),
        ),
      )
      .orderBy(desc(officeFileVersion.version))
      .limit(1)
    if (!latest) throw new RequestFailure(404, 'file_not_found', 'This Office file does not exist')
    if (latest.id !== baseVersionId) {
      throw new RequestFailure(
        409,
        'file_version_conflict',
        'This file changed after it was opened. Reload before saving your edits.',
      )
    }
    if (latest.sha256 === sha256) return
    await transaction.insert(officeFileVersion).values({
      workspaceId,
      fileId,
      version: latest.version + 1,
      bytes,
      size: bytes.length,
      sha256,
      note: 'Edited in EEVEE',
    })
    await transaction
      .update(officeFile)
      .set({ updatedAt: new Date() })
      .where(and(eq(officeFile.workspaceId, workspaceId), eq(officeFile.id, fileId)))
  })
  return getOfficeFileSummary(workspaceId, fileId)
}

export const readOfficeFileBytes = async (
  workspaceId: string,
  fileId: string,
  versionId?: string,
): Promise<{ file: OfficeFileSummary; bytes: Uint8Array }> => {
  const validatedFileId = fileIdAtBoundary(fileId)
  if (versionId && !officeFileVersionIdSchema.safeParse(versionId).success) {
    throw new RequestFailure(400, 'invalid_version_id', 'The file version id is not valid')
  }
  const file = await getOfficeFileSummary(workspaceId, validatedFileId)
  const targetVersionId = versionId ?? file.versionId
  const [row] = await getDatabase()
    .select({ bytes: officeFileVersion.bytes })
    .from(officeFileVersion)
    .where(
      and(
        eq(officeFileVersion.workspaceId, workspaceId),
        eq(officeFileVersion.fileId, validatedFileId),
        eq(officeFileVersion.id, targetVersionId),
      ),
    )
    .limit(1)
  if (!row) throw new RequestFailure(404, 'file_version_not_found', 'This file version does not exist')
  return { file, bytes: row.bytes }
}

export const editPdfFile = async (
  workspaceId: string,
  fileId: string,
  baseVersionId: string,
  edit: PdfEdit,
): Promise<OfficeFileSummary> => {
  const current = await getOfficeFileSummary(workspaceId, fileId)
  if (current.medium !== 'pdf') {
    throw new RequestFailure(409, 'file_medium_mismatch', 'This operation requires a PDF file')
  }
  if (current.versionId !== baseVersionId) {
    throw new RequestFailure(
      409,
      'file_version_conflict',
      'This file changed after it was inspected. Inspect the current version before editing.',
    )
  }
  const { bytes } = await readOfficeFileBytes(workspaceId, fileId, baseVersionId)
  let edited: Uint8Array
  try {
    edited = await applyPdfEdit(bytes, edit)
  } catch (error) {
    throw new RequestFailure(
      400,
      'invalid_pdf_edit',
      error instanceof Error ? error.message : 'The PDF edit is not valid',
    )
  }
  return saveOfficeFile(workspaceId, fileId, baseVersionId, edited)
}
