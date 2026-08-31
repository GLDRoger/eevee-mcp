import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { ensureWorkspace } from './applets'
import { getDatabase } from './db/client'
import { workspace } from './db/schema'
import {
  createOfficeFile,
  editPdfFile,
  getOfficeFile,
  getOfficeFileSummary,
  listOfficeFiles,
  readOfficeFileBytes,
  saveOfficeFile,
} from './office-files'

const runIntegration = Boolean(process.env.DATABASE_URL)
const workspaceId = crypto.randomUUID()
const otherWorkspaceId = crypto.randomUUID()
const pdf = (text: string): Uint8Array =>
  new TextEncoder().encode(`%PDF-1.7\n${text}\n%%EOF`)

describe.runIf(runIntegration)('durable Office files', () => {
  afterAll(async () => {
    await getDatabase().delete(workspace).where(inArray(workspace.id, [workspaceId, otherWorkspaceId]))
  })

  it('imports, versions, reads, deduplicates, and tenant-isolates file bytes', async () => {
    await Promise.all([ensureWorkspace(workspaceId), ensureWorkspace(otherWorkspaceId)])
    const created = await createOfficeFile(workspaceId, 'Board pack.pdf', pdf('version one'))
    expect(created).toMatchObject({ medium: 'pdf', version: 1, size: pdf('version one').length })
    expect(await listOfficeFiles(workspaceId)).toEqual([created])
    expect((await readOfficeFileBytes(workspaceId, created.id)).bytes).toEqual(pdf('version one'))

    const saved = await saveOfficeFile(
      workspaceId,
      created.id,
      created.versionId,
      pdf('version two'),
    )
    expect(saved).toMatchObject({ id: created.id, version: 2 })
    const unchanged = await saveOfficeFile(
      workspaceId,
      created.id,
      saved.versionId,
      pdf('version two'),
    )
    expect(unchanged.versionId).toBe(saved.versionId)
    expect((await getOfficeFile(workspaceId, created.id)).versions).toHaveLength(2)
    expect((await readOfficeFileBytes(workspaceId, created.id, created.versionId)).bytes)
      .toEqual(pdf('version one'))

    await expect(
      saveOfficeFile(workspaceId, created.id, created.versionId, pdf('stale edit')),
    ).rejects.toMatchObject({ status: 409, code: 'file_version_conflict' })
    await expect(getOfficeFileSummary(otherWorkspaceId, created.id)).rejects.toMatchObject({
      status: 404,
      code: 'file_not_found',
    })
    await expect(
      readOfficeFileBytes(otherWorkspaceId, created.id, created.versionId),
    ).rejects.toMatchObject({ status: 404, code: 'file_not_found' })
  })

  it('applies a PDF operation through the same immutable save boundary', async () => {
    await ensureWorkspace(workspaceId)
    const source = await PDFDocument.create()
    source.addPage([300, 400])
    source.addPage([500, 600])
    const created = await createOfficeFile(workspaceId, 'Agent-editable.pdf', await source.save())
    const edited = await editPdfFile(workspaceId, created.id, created.versionId, {
      type: 'rotate',
      pageIndex: 1,
      quarterTurns: 1,
    })
    expect(edited.version).toBe(2)
    const saved = await PDFDocument.load((await readOfficeFileBytes(workspaceId, created.id)).bytes)
    expect(saved.getPage(1).getRotation().angle).toBe(90)
    await expect(
      editPdfFile(workspaceId, created.id, created.versionId, {
        type: 'delete',
        pageIndex: 0,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'file_version_conflict' })
  })
})
